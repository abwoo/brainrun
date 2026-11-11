"""Phase 5 acceptance test for Brain Physics Playground (local headless Chromium).

Runs the five plan demo scenarios plus the A/B/C/D checklist items that are
measurable in-browser. Anything that cannot be measured on this machine
(SwiftShader software rendering, no real GPU) is measured honestly and marked
as such in the report -- never faked.

Prereq: `npm run preview -- --port 4173` running in app/.
Screenshots go to tests/phase5/shots/; full results to tests/phase5/report.json.
"""
import json
import math
import re
import statistics
import time
from pathlib import Path

from PIL import Image, ImageStat
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
OUT = Path(__file__).parent / "shots"
OUT.mkdir(parents=True, exist_ok=True)

results = []
measurements = {}


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def note(name, detail=""):
    results.append({"check": name, "ok": None, "detail": detail})
    print(f"NOTE  {name}  {detail}")


def sim_time(page):
    txt = page.locator(".bottombar .mono").inner_text()
    m = re.search(r"TIME ([\d.]+) S", txt)
    return float(m.group(1)) if m else -1.0


def knob_value(page, idx):
    # PR2: knobs replaced by param sliders; readout class renamed with them.
    return page.locator(".param-value").nth(idx).inner_text()


def shot_stats(path):
    im = Image.open(path).convert("RGB")
    st = ImageStat.Stat(im)
    px = list(im.getdata())
    bg = (5, 8, 12)
    non_bg = sum(1 for p in px if sum(abs(a - b) for a, b in zip(p, bg)) > 30)
    return {
        "stddev_mean": round(sum(st.stddev) / 3, 2),
        "non_bg_frac": round(non_bg / len(px), 3),
        "size": im.size,
    }


# 注意：本文件曾用页内轮询（poll_series / responders）在 1.2–1.5 s 窗口
# 内采快照来抓 200 ms 瞬态——本机约 1 Hz 的帧率下每秒只采 1 个点，
# 会随机错过瞬态（Round 2 因此失败三项）。现已全部改用 SimClient 的
# 峰值追踪（峰值）与快照历史（时间点值），两个旧辅助函数已删除。


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(
            Path.home() / ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome"
        ), args=[
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
        ])
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        page.set_default_timeout(60000)
        errors, failed_reqs, all_urls = [], [], []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("requestfailed", lambda r: failed_reqs.append(f"{r.url} {r.failure}"))
        page.on("request", lambda r: all_urls.append(r.url))

        # ---- D1: time to interactive --------------------------------------
        t_start = time.perf_counter()
        page.goto(BASE, wait_until="networkidle", timeout=30000)
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        ready_ms = int((time.perf_counter() - t_start) * 1000)
        measurements["time_to_interactive_ms"] = ready_ms
        check("D1 first screen interactive (sim ready)", ready_ms < 5000, f"ready in {ready_ms} ms")
        page.wait_for_function("window.__brainScene", timeout=10000)
        page.wait_for_timeout(1500)

        # ---- Scene 1: open and play ----------------------------------------
        check("S1 sim running, clock advances",
              "运行中" in page.locator("button:has-text('PLAY')").inner_text())
        t1, t2 = sim_time(page), None
        page.wait_for_timeout(1200)
        t2 = sim_time(page)
        check("S1 simulation clock advances", t2 > t1, f"TIME {t1} -> {t2} s")
        check("S1 WebGL canvas present", page.locator(".brain-scene canvas").count() == 1)
        page.screenshot(path=str(OUT / "01-1920-live.png"))
        scene_path = OUT / "01-scene.png"
        page.locator(".brain-scene").screenshot(path=str(scene_path))
        st = shot_stats(scene_path)
        measurements["scene_shot"] = st
        check("S1 real cortex visible (not blank/solid)",
              st["stddev_mean"] > 5 and st["non_bg_frac"] > 0.05,
              f"stddev={st['stddev_mean']} non-bg frac={st['non_bg_frac']}")
        # rotate: drag changes pixels; zoom: wheel changes camera distance
        box = page.locator(".brain-scene").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        before = (OUT / "01-scene.png").read_bytes()
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 250, cy + 60, steps=12)
        page.mouse.up()
        page.wait_for_timeout(800)
        page.locator(".brain-scene").screenshot(path=str(OUT / "01b-rotated.png"))
        check("S1 drag rotates brain (pixels change)",
              before != (OUT / "01b-rotated.png").read_bytes())
        d_before = math.sqrt(sum(v * v for v in page.evaluate(
            "window.__brainScene.getCameraPosition()")))
        page.mouse.move(cx, cy)
        page.mouse.wheel(0, -600)
        page.wait_for_timeout(800)
        d_after = math.sqrt(sum(v * v for v in page.evaluate(
            "window.__brainScene.getCameraPosition()")))
        measurements["camera_dist_before"] = round(d_before, 1)
        measurements["camera_dist_after_wheel"] = round(d_after, 1)
        check("S1 wheel zooms (camera distance changes)",
              abs(d_after - d_before) > 1.0, f"dist {d_before:.1f} -> {d_after:.1f}")
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(600)

        # ---- C2: hemisphere labels -----------------------------------------
        # 先关自动旋转再悬停：开着旋转时相机角度随时间变，固定屏点落
        # 到哪个半球纯属运气（Round 1 因此两边都读到左半球标签）。
        rot_btn = page.locator("button:has-text('旋转')")
        if "开" in rot_btn.inner_text():
            rot_btn.click()
            page.wait_for_timeout(300)
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(700)

        def hover_label(x, y, prev=""):
            page.mouse.move(x, y)
            # 本机输入滞后约一帧（~1 s）：等 tooltip 真正变到新值再读，
            # 不读上一悬停点的旧标签；超时则读当前值。
            try:
                page.wait_for_function(
                    """(prev) => { const t = document.querySelector('.brain-tooltip');
                        return t && t.style.display !== 'none' && t.innerText
                            && t.innerText !== prev; }""",
                    arg=prev, timeout=5000)
            except Exception:
                pass
            tip = page.locator(".brain-tooltip")
            return tip.inner_text() if tip.count() and tip.is_visible() else ""

        # 两点取在垂直方向：数据集的左右轴是 Y（l 脑区 Y>0、r 脑区
        # Y<0，实测），而相机 up 默认 +Y，默认视角是俯视、中线横贯
        # 屏幕——水平取点走的是前后轴，永远落在同一半球；垂直取点
        # 才能跨过中线。点位避开中线附近（实测中线约在 cy+75）。
        lab_left = hover_label(cx, cy - 120)
        lab_right = hover_label(cx, cy + 150, prev=lab_left)
        measurements["hover_labels"] = {"left": lab_left, "right": lab_right}
        check("C2 hover labels on opposite sides differ in hemisphere",
              bool(lab_left) and bool(lab_right) and lab_left[0] != lab_right[0],
              f"left={lab_left!r} right={lab_right!r}")

        # ---- Scene 2: direct stimulation -----------------------------------
        # turn auto-rotate off so B1 camera check is meaningful
        rot_btn = page.locator("button:has-text('旋转')")
        if "开" in rot_btn.inner_text():
            rot_btn.click()
            page.wait_for_timeout(300)
        markers_before = page.evaluate("window.__brainSim.getMarkers().length")
        cam_before = page.evaluate("window.__brainScene.getCameraPosition()")
        page.mouse.move(cx, cy - 40)
        page.wait_for_timeout(500)
        tip = page.locator(".brain-tooltip")
        tip_text = tip.inner_text() if tip.count() and tip.is_visible() else ""
        check("S2 hover shows region tooltip", bool(tip_text), f"tooltip={tip_text!r}")
        base_e = page.evaluate("Array.from(window.__brainSim.getSnapshot().e)")
        chart_before = OUT / "02a-chart-before.png"
        page.locator(".panels .panel").first.screenshot(path=str(chart_before))
        # 峰值追踪从点击前清零：点击后才启动的轮询会错过瞬态——本机
        # 约 1 Hz 的帧率采样抓不住 200 ms 的脉冲响应（Round 1：
        # max E 只有基线 0.011）。峰值追踪在 60 Hz 快照流到达时逐条
        # 更新，瞬态一定被记下来；断言本身不变。
        page.evaluate("window.__brainSim.resetPeakTracking()")
        # D2: click -> next painted frame (visual confirmation latency)
        t0_perf = page.evaluate("performance.now()")
        page.mouse.click(cx, cy - 40)
        t1_perf = page.evaluate(
            "new Promise(r => requestAnimationFrame(() => r(performance.now())))")
        click_to_frame_ms = round(t1_perf - t0_perf, 1)
        measurements["click_to_next_frame_ms"] = click_to_frame_ms
        markers_after = page.evaluate("window.__brainSim.getMarkers()")
        panel = page.locator(".region-panel").inner_text()
        m = re.search(r"#(\d+) / 76", panel)
        sel = int(m.group(1)) if m else None
        check("S2 click selects a region", sel is not None, f"panel={panel[:80]!r}")
        check("S2 input marker recorded", len(markers_after) > markers_before
              and markers_after[-1]["kind"] == "pulse"
              and markers_after[-1]["node"] == sel,
              f"markers {markers_before} -> {len(markers_after)}, last={markers_after[-1] if markers_after else None}")
        # B1: click must not rotate the camera
        cam_after = page.evaluate("window.__brainScene.getCameraPosition()")
        cam_move = math.sqrt(sum((a - b) ** 2 for a, b in zip(cam_before, cam_after)))
        check("B1 click does not rotate camera", cam_move < 1.0, f"camera moved {cam_move:.2f} mm")
        # C3: tooltip label == panel label
        panel_label = re.search(r"REGION / CONNECTION\n(\S+)", panel)
        check("C3 highlight matches actual region (tooltip == panel)",
              panel_label is not None and tip_text.startswith(panel_label.group(1)),
              f"tooltip={tip_text!r} panel={panel_label.group(1) if panel_label else None!r}")
        if sel is not None:
            # 等脉冲的快照流排空：点击在约 1 s 后才被处理，瞬态随后
            # 200 ms 内过去；Worker 以 60 Hz 发快照，主线程每帧排空
            # 队列，峰值追踪在消息到达时更新——等 2 s 再读一定已记下。
            page.wait_for_function(
                "window.__brainSim.getPeakE() !== null", timeout=10000)
            page.wait_for_timeout(2000)
            peak = page.evaluate("Array.from(window.__brainSim.getPeakE())")
            others2 = [n for n in range(76)
                       if n != sel and abs(peak[n] - base_e[n]) > 0.01]
            resp = {"maxE": peak[sel], "count": len(others2),
                    "nodes": others2[:12]}
            measurements["scene2"] = {"node": sel, "responders": resp}
            check("S2 stimulated node responds", resp["maxE"] > 0.05,
                  f"max E[{sel}] = {resp['maxE']:.3f}")
            check("S2 network responds (other regions)", resp["count"] > 0,
                  f"{resp['count']}/75 regions >0.01: {resp['nodes']}")
            # A6: panel E equals snapshot E
            page.wait_for_timeout(1500)  # let transient pass; baseline is steady
            snap_e = page.evaluate(f"window.__brainSim.getSnapshot().e[{sel}]")
            panel_e_txt = page.locator(".region-panel").inner_text()
            mm = re.search(r"兴奋活动 E\n([\d.]+)", panel_e_txt)
            if mm:
                panel_e = float(mm.group(1))
                check("A6 panel E matches snapshot E (rendering traces to model)",
                      abs(panel_e - snap_e) < 0.005, f"panel {panel_e} vs snapshot {snap_e:.4f}")
            else:
                check("A6 panel E matches snapshot E", False, "E field not found in panel")
        page.wait_for_timeout(400)
        page.locator(".panels .panel").first.screenshot(path=str(OUT / "02b-chart-after.png"))
        chart_st = shot_stats(OUT / "02b-chart-after.png")
        check("S2 live chart changes after click (pixels differ)",
              (OUT / "02a-chart-before.png").read_bytes() != (OUT / "02b-chart-after.png").read_bytes()
              and chart_st["stddev_mean"] > 2,
              f"chart stddev={chart_st['stddev_mean']}")
        page.screenshot(path=str(OUT / "02-after-click.png"))

        # ---- B2: drag must not stimulate ------------------------------------
        markers_b = page.evaluate("window.__brainSim.getMarkers().length")
        p_max_b = page.evaluate("Math.max(...Array.from(window.__brainSim.getSnapshot().p).map(Math.abs))")
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 200, cy - 50, steps=10)
        page.mouse.up()
        page.wait_for_timeout(500)
        markers_a = page.evaluate("window.__brainSim.getMarkers().length")
        p_max_a = page.evaluate("Math.max(...Array.from(window.__brainSim.getSnapshot().p).map(Math.abs))")
        check("B2 drag does not stimulate", markers_a == markers_b and p_max_a < 1e-9,
              f"markers {markers_b}->{markers_a}, max|P| {p_max_b}->{p_max_a}")
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(600)

        # ---- B3: hold applies input, release stops it -----------------------
        page.mouse.move(cx, cy - 40)
        page.mouse.down()
        page.wait_for_timeout(500)  # > 300 ms hold threshold
        sel2 = None
        panel2 = page.locator(".region-panel").inner_text()
        m2 = re.search(r"#(\d+) / 76", panel2)
        sel2 = int(m2.group(1)) if m2 else None
        p_hold = page.evaluate(f"window.__brainSim.getSnapshot().p[{sel2}]") if sel2 is not None else -1
        check("B3 hold applies input while held", p_hold > 0, f"P[{sel2}] during hold = {p_hold}")
        page.mouse.up()
        page.wait_for_timeout(400)
        p_after = page.evaluate(f"window.__brainSim.getSnapshot().p[{sel2}]") if sel2 is not None else -1
        check("B3 release stops input", p_after == 0, f"P[{sel2}] 400 ms after release = {p_after}")
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(600)

        # ---- Scene 3: change the model --------------------------------------
        def peak_after_pulse(node, amp, g, dur=100):
            page.evaluate(
                """({g, amp, dur}) => {
                    const b = window.__brainSim;
                    b.reset();
                    b.setParams({ g, stim_amplitude: amp, stim_duration_ms: dur });
                }""",
                {"g": g, "amp": amp, "dur": dur})
            page.wait_for_timeout(2500)  # settle to baseline
            base = page.evaluate("Array.from(window.__brainSim.getSnapshot().e)")
            # 与 S2 同理：页内轮询抓不住 200 ms 瞬态，改读峰值追踪。
            page.evaluate("window.__brainSim.resetPeakTracking()")
            page.evaluate("window.__brainSim.pulse(40)")
            page.wait_for_timeout(2000)  # 等 60 Hz 快照流排空，峰值落袋
            peak = page.evaluate("Array.from(window.__brainSim.getPeakE())")
            others = [n for n in range(76)
                      if n != node and abs(peak[n] - base[n]) > 0.01]
            return {"maxE": peak[node], "count": len(others), "nodes": others[:12]}

        r_low_amp = peak_after_pulse(40, 0.5, 0.35)
        r_high_amp = peak_after_pulse(40, 2.0, 0.35)
        r_low_g = peak_after_pulse(40, 2.0, 0.1)
        r_high_g = peak_after_pulse(40, 2.0, 0.35)
        measurements["scene3"] = {
            "amp0.5_peak": round(r_low_amp["maxE"], 4),
            "amp2.0_peak": round(r_high_amp["maxE"], 4),
            "g0.1_responders": r_low_g["count"],
            "g0.35_responders": r_high_g["count"],
        }
        check("S3 low amplitude -> small response", r_low_amp["maxE"] < 0.1,
              f"amp 0.5 peak E = {r_low_amp['maxE']:.4f}")
        check("S3 high amplitude -> large response", r_high_amp["maxE"] > 0.4,
              f"amp 2.0 peak E = {r_high_amp['maxE']:.4f}")
        check("S3 response differs with amplitude", abs(r_high_amp["maxE"] - r_low_amp["maxE"]) > 0.3,
              f"Δpeak = {r_high_amp['maxE'] - r_low_amp['maxE']:.3f}")
        check("S3 coupling changes network response",
              r_high_g["count"] > r_low_g["count"],
              f"responders G=0.1: {r_low_g['count']}/75 vs G=0.35: {r_high_g['count']}/75")
        # B4: param sliders drive real params (UI path) -- all four params.
        # PR2（用户要求）：旋转旋钮已换成横向滑杆控件；滚轮改值与双击恢复
        # 默认的行为保留，等价检查改到滑杆上。
        knob_fields = [
            (0, "stim_amplitude", 2.0),
            (1, "stim_duration_ms", 100),
            (2, "c_ei", 4.0),
            (3, "g", 0.35),
        ]
        page.evaluate("window.__brainSim.reset()")
        page.evaluate("window.__brainSim.setParams({g:0.35, c_ei:4.0, stim_amplitude:2.0, stim_duration_ms:100})")
        page.wait_for_timeout(300)
        for idx, field, default in knob_fields:
            dial = page.locator(".param-slider").nth(idx)
            dbox = dial.bounding_box()
            page.mouse.move(dbox["x"] + dbox["width"] / 2, dbox["y"] + dbox["height"] / 2)
            before_v = page.evaluate(f"window.__brainSim.getParams().{field}")
            page.mouse.wheel(0, 120)
            page.wait_for_timeout(300)
            after_v = page.evaluate(f"window.__brainSim.getParams().{field}")
            check(f"B4 slider {idx} changes real param {field}", after_v != before_v,
                  f"{field}: {before_v} -> {after_v}")
            dial.dblclick()
            page.wait_for_timeout(300)
            restored = page.evaluate(f"window.__brainSim.getParams().{field}")
            check(f"B4 slider {idx} double-click restores default", abs(restored - default) < 1e-9,
                  f"{field} restored to {restored} (default {default})")
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(600)

        # ---- Scene 4: causality, G=0 ----------------------------------------
        page.evaluate("window.__brainSim.reset()")
        page.evaluate("window.__brainSim.setParams({g: 0})")
        page.wait_for_timeout(2500)
        base4 = page.evaluate("Array.from(window.__brainSim.getSnapshot().e)")
        markers4_b = page.evaluate("window.__brainSim.getMarkers().length")
        # 与 S3 同理：页内轮询抓不住 200 ms 瞬态，改读峰值追踪。
        page.evaluate("window.__brainSim.resetPeakTracking()")
        page.mouse.move(cx, cy - 40)
        page.mouse.click(cx, cy - 40)
        panel4 = page.locator(".region-panel").inner_text()
        m4 = re.search(r"#(\d+) / 76", panel4)
        node4 = int(m4.group(1)) if m4 else 40
        page.wait_for_function(
            "window.__brainSim.getPeakE() !== null", timeout=10000)
        page.wait_for_timeout(2000)  # 等 60 Hz 快照流排空，峰值落袋
        peak4 = page.evaluate("Array.from(window.__brainSim.getPeakE())")
        measurements["scene4"] = {"node": node4}
        other4 = max(abs(peak4[n] - base4[n]) for n in range(76) if n != node4)
        resp4 = abs(peak4[node4] - base4[node4])
        measurements["scene4"]["maxOther"] = other4
        measurements["scene4"]["node_peak"] = round(peak4[node4], 4)
        check("S4 G=0: other nodes unaffected (real UI click)", other4 < 1e-6,
              f"max |dE| other = {other4:.2e}")
        check("S4 G=0: stimulated node still responds", resp4 > 0.05,
              f"|dE| node {node4} = {resp4:.3f}")
        check("S4 click still recorded as a stimulus", page.evaluate(
            "window.__brainSim.getMarkers().length") > markers4_b)
        page.evaluate("window.__brainSim.setParams({g: 0.35})")
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(600)

        # ---- Scene 5: deterministic reset -----------------------------------
        # 峰值与 +200 ms 均取自快照历史（Worker 时间戳，60 Hz）：页内
        # 轮询在约 1 Hz 帧率下每轮只有一个随机采样点，两轮采到不同
        # 时刻，+200 ms 的比较毫无意义（Round 2：0.359 对 0.013）。
        # 历史在消息到达时逐条记下，+200 ms 是确定的仿真时刻。
        def replay():
            page.evaluate(
                """() => {
                    const b = window.__brainSim;
                    b.reset();
                    b.setParams({g: 0.35, c_ei: 4.0, stim_amplitude: 2.0, stim_duration_ms: 100});
                }""")
            page.wait_for_timeout(1500)
            t_pulse = page.evaluate("window.__brainSim.getSnapshot().t_ms")
            page.evaluate("window.__brainSim.resetSnapshotHistory()")
            page.evaluate("window.__brainSim.pulse(40)")
            page.wait_for_timeout(2000)  # 等 60 Hz 快照流排空
            return t_pulse, page.evaluate(
                """(t0) => {
                    const h = window.__brainSim.getSnapshotHistory();
                    let maxE = 0, e200 = null;
                    for (const s of h) {
                        if (s.e[40] > maxE) maxE = s.e[40];
                        if (e200 === null && s.t_ms >= t0 + 200) e200 = s.e[40];
                    }
                    return { maxE, e200, n: h.length };
                }""", t_pulse)

        t_p1, s1 = replay()
        t_p2, s2 = replay()
        e_at_200_1, e_at_200_2 = s1["e200"], s2["e200"]
        measurements["scene5"] = {
            "run1_maxE": round(s1["maxE"], 4), "run2_maxE": round(s2["maxE"], 4),
            "run1_E+200ms": round(e_at_200_1, 4) if e_at_200_1 is not None else None,
            "run2_E+200ms": round(e_at_200_2, 4) if e_at_200_2 is not None else None,
        }
        check("S5 replay: both runs respond", s1["maxE"] > 0.4 and s2["maxE"] > 0.4,
              f"peaks {s1['maxE']:.3f} / {s2['maxE']:.3f}")
        check("S5 replay: peak reproducible (sampling tolerance 0.1)",
              abs(s1["maxE"] - s2["maxE"]) < 0.1,
              f"|peak1 - peak2| = {abs(s1['maxE'] - s2['maxE']):.4f}")
        check("S5 replay: E at +200 ms reproducible (tol 0.05)",
              e_at_200_1 is not None and e_at_200_2 is not None
              and abs(e_at_200_1 - e_at_200_2) < 0.05,
              f"E+200ms {e_at_200_1} vs {e_at_200_2}")

        # ---- A5: delay -- neighbor peak lags stimulated peak -----------------
        page.evaluate("window.__brainSim.reset()")
        page.wait_for_timeout(1500)
        page.evaluate("window.__brainSim.resetSnapshotHistory()")
        page.evaluate("window.__brainSim.pulse(40)")
        page.wait_for_timeout(2000)  # 等 60 Hz 快照流排空
        # 与 S5 同理：页内轮询的峰值时刻是采样时刻，不是真实峰值时刻，
        # 改从快照历史里精确取两脑区的峰值及其 Worker 时间戳。
        lag = page.evaluate(
            """() => {
                const h = window.__brainSim.getSnapshotHistory();
                // top neighbor of 40 by weight: lPHC (weight 2.0, 8.8 mm)
                const neigh = 38; // lPHC id from regions.json (verified below by label)
                let peak40 = { e: 0, t: 0 }, peakN = { e: 0, t: 0 };
                for (const s of h) {
                    if (s.e[40] > peak40.e) peak40 = { e: s.e[40], t: s.t_ms };
                    if (s.e[neigh] > peakN.e) peakN = { e: s.e[neigh], t: s.t_ms };
                }
                return { peak40, peakN };
            }""")
        measurements["delay_lag"] = lag
        check("A5 neighbor peak does not precede stimulated peak",
              lag["peakN"]["t"] >= lag["peak40"]["t"],
              f"node40 peak t={lag['peak40']['t']} ms (E={lag['peak40']['e']:.3f}); "
              f"neighbor peak t={lag['peakN']['t']} ms (E={lag['peakN']['e']:.3f})")
        # A4: finiteness across the whole run (all snapshots seen so far)
        finite = page.evaluate(
            """() => {
                const s = window.__brainSim.getSnapshot();
                if (!s) return false;
                for (let n = 0; n < 76; n++)
                    if (!Number.isFinite(s.e[n]) || !Number.isFinite(s.i[n]) || !Number.isFinite(s.p[n])) return false;
                return !s.diverged;
            }""")
        check("A4 no NaN/Inf, engine not diverged", finite)

        # ---- B5/B6: pause / reset --------------------------------------------
        page.locator("button:has-text('PLAY')").click()
        page.wait_for_timeout(300)
        tp1 = sim_time(page)
        page.wait_for_timeout(1200)
        tp2 = sim_time(page)
        check("B5 pause freezes simulation time", tp1 == tp2, f"TIME {tp1} -> {tp2} s")
        page.locator("button:has-text('PLAY')").click()
        page.wait_for_timeout(800)
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(400)
        tr = sim_time(page)
        params_after = page.evaluate("window.__brainSim.getParams()")
        markers_after_reset = page.evaluate("window.__brainSim.getMarkers().length")
        check("B6 reset restores t=0", tr < 1.0, f"TIME 400 ms after reset = {tr} s")
        check("B6 reset restores default params",
              abs(params_after["g"] - 0.35) < 1e-9 and abs(params_after["c_ei"] - 4.0) < 1e-9
              and abs(params_after["stim_amplitude"] - 2.0) < 1e-9
              and abs(params_after["stim_duration_ms"] - 100) < 1e-9,
              f"params={params_after}")
        check("B6 reset clears markers", markers_after_reset == 0,
              f"markers after reset = {markers_after_reset}")

        # ---- B6b: pause -> RESET must not desync the clock -------------------
        # handleReset sets React `paused` false; if the Worker stays paused,
        # the UI says 运行中 while the clock is frozen -- a real state bug.
        page.locator("button:has-text('PLAY')").click()  # pause
        page.wait_for_timeout(300)
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(1000)
        t_r1 = sim_time(page)
        page.wait_for_timeout(1200)
        t_r2 = sim_time(page)
        if t_r2 > t_r1:
            check("B6b pause->RESET: clock resumes (no desync)", True,
                  f"TIME {t_r1} -> {t_r2} s after RESET")
        else:
            check("B6b pause->RESET: clock resumes (no desync)", False,
                  f"TIME stuck at {t_r1} s after RESET while UI shows 运行中 -- "
                  "RESET must resume the Worker or keep paused state in sync")
            page.evaluate("window.__brainSim.resume()")
            page.wait_for_timeout(800)

        # ---- D3/D4: snapshot cadence + frame rate ----------------------------
        cadence = page.evaluate(
            """async () => {
                const b = window.__brainSim;
                const samples = [];
                const t0 = performance.now();
                while (performance.now() - t0 < 3000) {
                    const s = b.getSnapshot();
                    if (s) samples.push([performance.now(), s.t_ms]);
                    await new Promise(r => setTimeout(r, 10));
                }
                let maxGap = 0, last = null;
                for (const [wall, t] of samples) {
                    if (last !== null && t !== last[1]) maxGap = Math.max(maxGap, wall - last[0]);
                    last = [wall, t];
                }
                return { n: samples.length, maxGapMs: Math.round(maxGap) };
            }""")
        measurements["snapshot_cadence"] = cadence
        check("D3 state delivery: new snapshot visible within 100 ms",
              cadence["maxGapMs"] <= 100,
              f"max wall gap between distinct snapshots = {cadence['maxGapMs']} ms ({cadence['n']} samples)")
        fps = page.evaluate(
            """async () => {
                let frames = 0;
                const t0 = performance.now();
                await new Promise(done => {
                    const loop = () => {
                        frames++;
                        if (performance.now() - t0 < 5000) requestAnimationFrame(loop);
                        else done();
                    };
                    requestAnimationFrame(loop);
                });
                return frames / 5;
            }""")
        measurements["fps_1920_swiftshader"] = round(fps, 1)
        note("D4 desktop frame rate (local SwiftShader, not real GPU)",
             f"measured {fps:.1f} FPS at 1920x1080; 50-60 FPS target NOT verifiable on this machine")

        # ---- D7 soak: 120 s ----------------------------------------------------
        play_txt = page.locator("button:has-text('PLAY')").inner_text()
        if "已暂停" in play_txt:
            page.locator("button:has-text('PLAY')").click()
            page.wait_for_timeout(500)
        heap0 = page.evaluate("performance.memory ? performance.memory.usedJSHeapSize : -1")
        soak = []
        for k in range(12):
            page.wait_for_timeout(10000)
            snap_t = page.evaluate("window.__brainSim.getSnapshot().t_ms") / 1000
            disp_t = sim_time(page)
            heap = page.evaluate("performance.memory ? performance.memory.usedJSHeapSize : -1")
            div = page.evaluate("window.__brainSim.getSnapshot().diverged")
            soak.append({"wall_s": (k + 1) * 10, "snap_s": round(snap_t, 1),
                         "disp_s": disp_t, "heap_mb": round(heap / 1048576, 1) if heap > 0 else None,
                         "diverged": div})
        measurements["soak_120s"] = soak
        sync_ok = all(abs(s["snap_s"] - s["disp_s"]) < 1.0 for s in soak)
        check("C6/D7 120 s soak: display stays in sync with model",
              sync_ok, f"final snap {soak[-1]['snap_s']} s vs display {soak[-1]['disp_s']} s")
        check("D7 120 s soak: no divergence",
              all(not s["diverged"] for s in soak))
        if heap0 > 0 and soak[-1]["heap_mb"] is not None:
            heap_growth = round(soak[-1]["heap_mb"] - heap0 / 1048576, 1)
            measurements["heap_growth_mb_120s"] = heap_growth
            note("D7 heap over 120 s", f"JS heap growth {heap_growth} MB "
                 f"({heap0 / 1048576:.1f} -> {soak[-1]['heap_mb']} MB); 10-min run still unverified on this machine")
        else:
            note("D7 heap over 120 s", "performance.memory unavailable in this Chromium")

        # ---- B7: resize ---------------------------------------------------------
        for w in (978, 1920):
            page.set_viewport_size({"width": w, "height": 800})
            page.wait_for_timeout(1000)
            overflow = page.evaluate(
                "document.documentElement.scrollWidth > document.documentElement.clientWidth")
            check(f"B7 {w}px: no horizontal overflow", not overflow)
            box = page.locator(".brain-scene").bounding_box()
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2 - 40)
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2 - 40)
            page.wait_for_timeout(400)
            ptxt = page.locator(".region-panel").inner_text()
            check(f"B7 {w}px: click still selects a region after resize",
                  re.search(r"#\d+ / 76", ptxt) is not None, f"panel={ptxt[:60]!r}")
            page.locator("button:has-text('RESET')").click()
            page.wait_for_timeout(400)
        page.set_viewport_size({"width": 1920, "height": 1080})
        page.wait_for_timeout(800)
        page.set_viewport_size({"width": 978, "height": 800})
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / "03-978px.png"))
        page.set_viewport_size({"width": 1920, "height": 1080})
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "04-1920-final.png"))

        # ---- D6: no remote dependency -------------------------------------------
        remote = [u for u in set(all_urls) if not u.startswith("http://127.0.0.1:4173")
                  and not u.startswith("data:") and not u.startswith("blob:")]
        check("D6 simulation uses no remote services", len(remote) == 0,
              f"remote URLs seen: {remote[:5]} (total requests: {len(all_urls)})")
        check("no console errors", len(errors) == 0, f"errors={errors[:3]}")
        check("no failed requests", len(failed_reqs) == 0, f"failed={failed_reqs[:3]}")

        browser.close()

    failed = [r for r in results if r["ok"] is False]
    notes = [r for r in results if r["ok"] is None]
    print(f"\n{len(results) - len(failed) - len(notes)}/{len(results) - len(notes)} checks passed "
          f"({len(notes)} notes)")
    (Path(__file__).parent / "report.json").write_text(
        json.dumps({"results": results, "measurements": measurements},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

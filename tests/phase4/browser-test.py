"""Phase 4 browser test for Brain Physics Playground (local headless Chromium).

Covers the Phase 4 polish on top of the Phase 3 loop:
- param slider wheel / drag / double-click-reset (PR2: knobs replaced by sliders)
- E/I/BOTH chart toggles
- touch tap selects a region; two-finger pinch zooms (CDP touch events)
- smooth camera fly-to on double-click background (via __brainScene bridge)
- TIME display stays in sync with the snapshot clock
- 1920px + 978px layout, no console errors

Also re-checks the core Phase 3 causal assertions in abbreviated form
(click -> E rise; G=0 isolation; pause freezes clock; reset restores t=0),
so a Phase 4 regression is caught here too.

Prereq: `npm run preview -- --port 4173` running in app/.
Screenshots go to tests/phase4/shots/.
"""
import json
import math
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
OUT = Path(__file__).parent / "shots"
OUT.mkdir(parents=True, exist_ok=True)

results = []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def sim_time(page):
    txt = page.locator(".bottombar .mono").inner_text()
    m = re.search(r"TIME ([\d.]+) S", txt)
    return float(m.group(1)) if m else -1.0


def param_value(page, idx):
    return page.locator(".param-value").nth(idx).inner_text()


def cam_pos(page):
    return page.evaluate("window.__brainScene.getCameraPosition()")


def cam_dist(pos):
    return math.sqrt(sum(v * v for v in pos))


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(
            Path.home() / ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome"
        ), args=[
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
        ])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, has_touch=True)
        page.set_default_timeout(60000)
        errors = []
        failed_reqs = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("requestfailed", lambda r: failed_reqs.append(f"{r.url} {r.failure}"))

        page.goto(BASE, wait_until="networkidle", timeout=30000)
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        page.wait_for_function("window.__brainScene", timeout=10000)
        page.wait_for_timeout(1500)

        check("sim ready, PLAY running",
              "运行中" in page.locator("button:has-text('PLAY')").inner_text())
        t1 = sim_time(page)
        page.wait_for_timeout(1200)
        t2 = sim_time(page)
        check("simulation clock advances", t2 > t1, f"TIME {t1} -> {t2} s")
        page.screenshot(path=str(OUT / "01-1920-live.png"))

        # --- core loop regression: click -> E rise -------------------------
        box = page.locator(".brain-scene").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy - 40)
        page.wait_for_timeout(500)
        # 与 Phase 3 同理：页内轮询抓不住 200 ms 瞬态，改读峰值追踪。
        page.evaluate("window.__brainSim.resetPeakTracking()")
        page.mouse.click(cx, cy - 40)
        panel = page.locator(".region-panel").inner_text()
        m = re.search(r"#(\d+) / 76", panel)
        sel = int(m.group(1)) if m else None
        check("click selects a region", sel is not None, f"panel={panel[:80]!r}")
        if sel is not None:
            page.wait_for_function(
                "window.__brainSim.getPeakE() !== null", timeout=10000)
            page.wait_for_timeout(2000)  # 等 60 Hz 快照流排空，峰值落袋
            max_e = page.evaluate(
                f"Array.from(window.__brainSim.getPeakE())[{sel}]")
            check("click raises selected E (Phase 3 regression)", max_e > 0.05,
                  f"max E[{sel}] (peak tracker) = {max_e:.3f}")
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / "02-after-click.png"))

        # --- param slider: wheel --------------------------------------------
        # PR2（用户要求）：旋转旋钮已换成横向滑杆控件（ParamControl）。
        # 滚轮、拖动、双击恢复默认的行为保留，等价检查改到滑杆上；
        # 与旋钮无关的其余检查一字未动。
        slider = page.locator(".param-slider").first
        slider_box = slider.bounding_box()
        v0 = param_value(page, 0)
        page.mouse.move(slider_box["x"] + slider_box["width"] / 2,
                        slider_box["y"] + slider_box["height"] / 2)
        # STIMULUS 默认已在量程顶（2.00）：先向下滚，再向上滚。
        page.mouse.wheel(0, 120)
        page.wait_for_timeout(300)
        v1 = param_value(page, 0)
        check("slider wheel decreases value", v1 != v0, f"STIMULUS {v0} -> {v1}")
        page.mouse.wheel(0, -120)
        page.wait_for_timeout(300)
        v2 = param_value(page, 0)
        check("slider wheel increases value", v2 != v1, f"STIMULUS {v1} -> {v2}")

        # --- param slider: drag + double-click reset -------------------------
        # 先向下滚 5 格留出量程空间（此时滑杆在顶，向右拖会被钳制，看不出变化）。
        for _ in range(5):
            page.mouse.wheel(0, 120)
            page.wait_for_timeout(120)
        v_pre = param_value(page, 0)
        # 滑杆值 k = value/1000；拇指中心 x 按 k 在轨道上的位置算。
        k_pre = float(page.locator(".param-slider").first.input_value()) / 1000
        thumb_x = slider_box["x"] + 11 + k_pre * (slider_box["width"] - 22)
        thumb_y = slider_box["y"] + slider_box["height"] / 2
        page.mouse.move(thumb_x, thumb_y)
        page.mouse.down()
        page.mouse.move(thumb_x + 60, thumb_y, steps=8)
        page.mouse.up()
        page.wait_for_timeout(300)
        v3 = param_value(page, 0)
        check("slider drag increases value", float(v3) > float(v_pre),
              f"STIMULUS {v_pre} -> {v3}")
        slider.dblclick()
        page.wait_for_timeout(300)
        v4 = param_value(page, 0)
        check("slider double-click restores default", v4 == "2.00",
              f"STIMULUS after dblclick = {v4} (default 2.00)")

        # --- chart toggles ----------------------------------------------------
        # PR2: `.chart-toggle` is now also used by the response-panel view
        # toggle and the replay speed buttons, so scope to the chart's own
        # toggle group instead of assuming the class is unique on the page.
        toggles = page.locator(".chart-toggles .chart-toggle")
        check("E/I/BOTH toggles present", toggles.count() == 3)
        toggles.nth(1).click()  # I
        page.wait_for_timeout(300)
        on = page.locator(".chart-toggles .chart-toggle-on").inner_text()
        check("chart toggle switches to I", on == "I", f"active={on!r}")
        toggles.nth(2).click()  # BOTH
        page.wait_for_timeout(300)
        on = page.locator(".chart-toggles .chart-toggle-on").inner_text()
        check("chart toggle switches to BOTH", on == "BOTH", f"active={on!r}")
        toggles.nth(0).click()  # back to E
        page.wait_for_timeout(200)

        # --- TIME display in sync with snapshot clock ------------------------
        snap_t = page.evaluate("window.__brainSim.getSnapshot().t_ms") / 1000
        disp_t = sim_time(page)
        check("TIME display matches snapshot clock", abs(snap_t - disp_t) < 0.6,
              f"snapshot {snap_t:.1f} s vs display {disp_t:.1f} s")

        # --- smooth camera fly-to ---------------------------------------------
        # SwiftShader 下一帧偶尔超过 600 ms，整段飞行可能只渲染一帧，
        # 采样不到中间进度；飞行段改在 1280px 下测（帧快得多），测完恢复 1920px。
        # 若一次飞行只采到 [1.0]（帧太慢），重飞一次再采；两次都只有 [1.0]
        # 才判失败——断言本身不放宽。
        page.set_viewport_size({"width": 1280, "height": 800})
        page.wait_for_timeout(800)
        box = page.locator(".brain-scene").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        # Stop auto-rotate first so it does not fight the flight.
        rot_btn = page.locator("button:has-text('旋转')")
        if "开" in rot_btn.inner_text():
            rot_btn.click()
            page.wait_for_timeout(300)

        def do_fly():
            # 拖离默认视角，再双击背景触发飞行，返回（起飞位置，进度采样）。
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.move(cx + 300, cy - 100, steps=12)
            page.mouse.up()
            page.wait_for_timeout(500)
            moved = cam_pos(page)
            page.mouse.dblclick(box["x"] + 30, box["y"] + 30)
            page.wait_for_timeout(1500)
            samples = page.evaluate("window.__brainScene.getFlySamples()")
            return moved, samples

        moved_pos, samples = do_fly()
        intermediate = [s for s in samples if 0.05 < s < 0.95]
        if not intermediate:
            moved_pos, samples = do_fly()
            intermediate = [s for s in samples if 0.05 < s < 0.95]
        dflt = page.evaluate("window.__brainScene.getDefaultCameraPosition()")
        dist_moved = math.sqrt(sum((a - b) ** 2 for a, b in zip(moved_pos, dflt)))
        check("fly-to is gradual, not a snap",
              len(intermediate) > 0,
              f"moved {dist_moved:.1f} from default; fly progress samples = {[round(s, 2) for s in samples]}")
        # SwiftShader 下一帧偶尔超过 1 s：飞行本身按墙钟推进，但相机位置
        # 只有渲染帧跑起来才会更新，固定等 1.5 s 可能采到飞行中途。
        # 改为轮询等落点（最长 5 s），断言本身不放宽（仍要求 <2 mm）。
        dist_end = None
        for _ in range(20):
            end_pos = cam_pos(page)
            dist_end = math.sqrt(sum((a - b) ** 2 for a, b in zip(end_pos, dflt)))
            if dist_end < 2.0:
                break
            page.wait_for_timeout(250)
        check("fly-to lands on default view", dist_end is not None and dist_end < 2.0,
              f"dist to default after flight = {dist_end:.2f}")
        page.screenshot(path=str(OUT / "03-after-flyto.png"))

        # --- touch: tap selects a region ---------------------------------------
        page.evaluate("window.__brainSim.reset()")
        page.wait_for_timeout(400)
        page.touchscreen.tap(cx, cy - 40)
        page.wait_for_timeout(500)
        panel2 = page.locator(".region-panel").inner_text()
        check("touch tap selects a region",
              re.search(r"#\d+ / 76", panel2) is not None, f"panel={panel2[:80]!r}")

        # --- touch: two-finger pinch zooms (CDP) -------------------------------
        d_before = cam_dist(cam_pos(page))
        cdp = page.context.new_cdp_session(page)
        await_touch = [
            {"x": cx - 60, "y": cy, "id": 1},
            {"x": cx + 60, "y": cy, "id": 2},
        ]
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": await_touch})
        spread = [
            {"x": cx - 140, "y": cy, "id": 1},
            {"x": cx + 140, "y": cy, "id": 2},
        ]
        for _ in range(5):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": spread})
            page.wait_for_timeout(60)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_timeout(800)
        d_after = cam_dist(cam_pos(page))
        check("two-finger pinch changes camera distance",
              abs(d_after - d_before) > 1.0,
              f"camera distance {d_before:.1f} -> {d_after:.1f}")

        # --- G=0 isolation (abbreviated Phase 3 regression) --------------------
        page.evaluate("() => { const b = window.__brainSim; b.reset(); b.setParams({ g: 0 }); }")
        page.wait_for_timeout(2500)
        e_before = page.evaluate("Array.from(window.__brainSim.getSnapshot().e)")
        # 与上面同理：页内轮询抓不住 200 ms 瞬态，改读峰值追踪。
        page.evaluate("window.__brainSim.resetPeakTracking()")
        page.evaluate("window.__brainSim.pulse(40)")
        page.wait_for_timeout(2000)  # 等 60 Hz 快照流排空，峰值落袋
        peak = page.evaluate("Array.from(window.__brainSim.getPeakE())")
        max_other = max(abs(peak[n] - e_before[n]) for n in range(76) if n != 40)
        resp40 = abs(peak[40] - e_before[40])
        check("G=0: other nodes unaffected", max_other < 1e-6,
              f"max |dE| other = {max_other:.2e}")
        check("G=0: stimulated node responds", resp40 > 0.05,
              f"|dE| node 40 = {resp40:.3f}")
        page.evaluate("window.__brainSim.setParams({ g: 0.35 })")

        # --- pause / reset (abbreviated) ----------------------------------------
        page.locator("button:has-text('PLAY')").click()
        page.wait_for_timeout(300)
        tp1 = sim_time(page)
        page.wait_for_timeout(1200)
        tp2 = sim_time(page)
        check("pause freezes simulation time", tp1 == tp2, f"TIME {tp1} -> {tp2} s")
        page.locator("button:has-text('PLAY')").click()
        page.wait_for_timeout(1000)
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(400)
        tr = sim_time(page)
        check("reset restores t=0", tr < 1.0, f"TIME 400 ms after reset = {tr} s")

        # --- narrow layout --------------------------------------------------------
        page.set_viewport_size({"width": 978, "height": 800})
        page.wait_for_timeout(1000)
        overflow = page.evaluate(
            "document.documentElement.scrollWidth > document.documentElement.clientWidth")
        check("978px: no horizontal overflow", not overflow)
        page.screenshot(path=str(OUT / "04-978px.png"))

        check("no console errors", len(errors) == 0, f"errors={errors[:3]}")
        check("no failed requests", len(failed_reqs) == 0, f"failed={failed_reqs[:3]}")

        browser.close()

    failed = [r for r in results if not r["ok"]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    (Path(__file__).parent / "report.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

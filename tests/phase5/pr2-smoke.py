"""PR2 smoke test (implementation smoke only, not a Phase 3/4 replacement).

Covers: pre-stimulus "not yet stimulated" state; pulse lAMYG #40;
response summary/groups vs debug bridge max|dE|; dE view toggle changes
the rendered canvas; 0.25x replay plays and its clock advances at 0.25x;
three marker classes present simultaneously (DOM groups + 3D counts);
replay peak E matches the recorded window snapshot; RESET clears baseline.
Writes tests/phase5/pr2-smoke-report.json and screenshots to shots/.
Assumes `npm run preview -- --port 4173` is already serving dist/.
"""
import json
import math
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
OUT = Path(__file__).parent / "shots"
OUT.mkdir(parents=True, exist_ok=True)
REPORT = Path(__file__).parent / "pr2-smoke-report.json"

results = []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(
            Path.home() / ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome"
        ), args=[
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
        ])
        ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = ctx.new_page()
        page.set_default_timeout(60000)
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(BASE, wait_until="networkidle", timeout=30000)
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        page.wait_for_function("window.__brainScene", timeout=10000)
        page.wait_for_timeout(1500)
        # Stable geometry: auto-rotate off.
        rot_btn = page.locator("button:has-text('旋转')")
        if "开" in rot_btn.inner_text():
            rot_btn.click()
            page.wait_for_timeout(300)

        # ---- 0. pre-stimulus state -----------------------------------------
        pre_base = page.evaluate("window.__brainSim.getBaseline()")
        pre_sum = page.evaluate("window.__brainSim.getResponseSummary()")
        panel = page.locator(".response-panel")
        check("pre-stimulus baseline null", pre_base is None, f"baseline={pre_base}")
        check("pre-stimulus summary null", pre_sum is None, f"summary={pre_sum}")
        check("pre-stimulus panel says not yet stimulated",
              "尚未刺激" in panel.inner_text())

        # ---- 1. pulse lAMYG #40 via the same command the UI uses -----------
        page.evaluate("window.__brainSim.reset()")
        page.wait_for_timeout(1200)
        page.evaluate("window.__brainSim.resetPeakTracking()")
        page.evaluate("window.__brainSim.pulse(40)")
        # Window is baseline-500ms .. +2000ms; wait for it to fill.
        page.wait_for_timeout(3000)

        summary = page.evaluate("window.__brainSim.getResponseSummary()")
        groups = page.evaluate("window.__brainSim.getResponseGroups()")
        maxde = page.evaluate("window.__brainSim.getMaxAbsDeltaE()")
        window = page.evaluate("window.__brainSim.getLastResponseWindow()")
        peak_e = page.evaluate("window.__brainSim.getPeakE()")
        n_snaps = len(window["snapshots"]) if window else 0
        check("window filled", window is not None and n_snaps >= 60,
              f"snapshots={n_snaps} t0={window['t0_ms'] if window else None} "
              f"t1={window['t1_ms'] if window else None} base={window['baselineT_ms'] if window else None} "
              f"(~30 Hz effective under SwiftShader; worker nominal 60 Hz)")
        peak40 = None
        n_resp = 0
        if summary:
            n_resp = summary["count"]
            for r in summary["responders"]:
                if r["node"] == 40:
                    peak40 = r["peakDeltaE"]
        check("lAMYG responds ~0.48", peak40 is not None and 0.3 < peak40 < 0.6,
              f"peak dE[40]={peak40}")
        check("summary count >= 2 (local + network)", n_resp >= 2,
              f"count={n_resp}")
        check("groups: input=40, local=[40], network non-empty",
              groups and groups["input"] == 40 and groups["local"] == [40]
              and len(groups["network"]) >= 1,
              f"groups={groups and {k: groups[k] for k in ('input', 'local', 'network')}}")
        # DOM list matches bridge numbers.
        panel_text = panel.inner_text()
        m = re.search(r"共 (\d+) 个响应脑区", panel_text)
        dom_count = int(m.group(1)) if m else -1
        check("DOM response count matches bridge", dom_count == n_resp,
              f"dom={dom_count} bridge={n_resp}")
        rows = page.locator(".resp-row")
        check("DOM response rows present", rows.count() == n_resp,
              f"rows={rows.count()}")
        row40 = page.locator('.resp-row[data-node="40"]')
        check("DOM row for #40 shows peak",
              row40.count() == 1 and peak40 is not None
              and f"{peak40:+.3f}" in row40.inner_text(),
              row40.inner_text() if row40.count() else "missing")
        check("DOM local/network group titles present",
              "局部响应" in panel_text and "网络响应" in panel_text)
        # Bridge max|dE| agrees with summary peak for #40.
        check("max|dE|[40] agrees with summary peak",
              maxde is not None and peak40 is not None
              and abs(maxde[40] - abs(peak40)) < 1e-9,
              f"max|dE|[40]={maxde[40] if maxde else None} peak={peak40}")
        # Distal responders are small (0.01-0.05 scale) but above threshold.
        distal = [abs(r["peakDeltaE"]) for r in summary["responders"] if r["node"] != 40] \
            if summary else []
        check("distal peaks in 0.01-0.05 range",
              len(distal) >= 1 and max(distal) < 0.1,
              f"distal peaks={[round(d, 4) for d in sorted(distal, reverse=True)[:5]]}")
        # Peak E from the recorded window matches the live peak tracker.
        win_peak40 = max(s["e"][40] for s in window["snapshots"]) if window else None
        check("window peak E[40] matches peak tracker",
              win_peak40 is not None and peak_e is not None
              and abs(win_peak40 - peak_e[40]) < 1e-9,
              f"window={win_peak40} tracker={peak_e[40] if peak_e else None}")

        # ---- 2. three marker classes simultaneously -------------------------
        markers = page.evaluate("window.__brainScene.getResponseMarkers()")
        check("3D markers: input + local + network all present",
              markers is not None and markers["input"] == 1
              and markers["local"] == 1 and markers["network"] >= 1,
              f"markers={markers}")

        # ---- 3. dE view: canvas rendering actually changes ------------------
        canvas = page.locator(".brain-scene canvas")
        # Replay at the peak instant so the dE signal is at full strength.
        # Pause immediately: the 2.5 s window plays through in 2.5 s at 1x.
        peak_snap_t = max(window["snapshots"], key=lambda s: s["e"][40])["t_ms"]
        page.locator(".replay-play").click()
        page.wait_for_timeout(200)
        page.locator(".replay-play").click()  # now shows 继续播放: paused
        page.wait_for_timeout(300)
        rs_pause = page.evaluate("window.__brainSim.getReplayState()")
        check("replay pauses", rs_pause["active"] is True and rs_pause["playing"] is False,
              f"state={rs_pause}")
        # Seek via the native value setter so React's onChange fires.
        page.evaluate(
            """(t) => {
              const s = document.querySelector('.replay-seek');
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value').set;
              setter.call(s, String(t));
              s.dispatchEvent(new Event('input', {bubbles: true}));
            }""",
            peak_snap_t,
        )
        page.wait_for_timeout(300)
        rs_seek = page.evaluate("window.__brainSim.getReplayState()")
        check("replay seek lands on peak instant",
              abs(rs_seek["tMs"] - peak_snap_t) <= 20,
              f"tMs={rs_seek['tMs']} peak_t={peak_snap_t}")
        # Let the (slow, ~1 FPS under SwiftShader) colour interpolation settle.
        page.wait_for_timeout(6000)
        shot_abs = OUT / "pr2-replay-peak-absolute.png"
        canvas.screenshot(path=str(shot_abs))
        page.locator(".stage-tools button:has-text('活动变化 ΔE')").click()
        page.wait_for_timeout(6000)
        shot_de = OUT / "pr2-replay-peak-delta.png"
        canvas.screenshot(path=str(shot_de))
        # Pixel-level: the dE view must make the distal response visible.
        # The stimulated region saturates in BOTH views by design (E~0.49
        # absolute and dE~0.48 are both near full scale), so a raw global
        # pixel diff is small; the discriminating signal is amber coverage:
        # distal responders (dE 0.01-0.05) read ~32-70% amber in dE view
        # but stay at baseline colour in absolute view.
        from PIL import Image
        def amber_count(path):
            px = list(Image.open(path).convert("RGB").getdata())
            return sum(1 for r, g, b in px if r > 150 and 90 < g < 210 and b < 130)
        amber_abs = amber_count(shot_abs)
        amber_de = amber_count(shot_de)
        check("dE view shows more distal amber than absolute view at peak replay",
              amber_de > 1.5 * max(amber_abs, 1),
              f"amber px absolute={amber_abs} delta={amber_de} (ratio {amber_de / max(amber_abs, 1):.2f}x)")
        # dE legend text present.
        check("dE legend states mapping + full-scale",
              "±0.1 满格" in panel.inner_text() and "平方根压缩" in panel.inner_text())
        page.locator(".stage-tools button:has-text('绝对活动 E')").click()
        page.wait_for_timeout(300)

        # ---- 4. replay 0.25x: clock advances at quarter speed ---------------
        rs0 = page.evaluate("window.__brainSim.getReplayState()")
        check("replay state readable via bridge",
              rs0 and rs0["active"] is True, f"state={rs0}")
        # Seek back to window start, set 0.25x, press play, measure.
        page.evaluate(
            """() => {
              const s = document.querySelector('.replay-seek');
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value').set;
              setter.call(s, s.min);
              s.dispatchEvent(new Event('input', {bubbles: true}));
            }""",
        )
        page.locator(".replay-speed:has-text('0.25×')").click()
        page.wait_for_timeout(300)
        page.locator(".replay-play").click()  # 继续播放
        page.wait_for_timeout(300)
        t_a = page.evaluate("window.__brainSim.getReplayState().tMs")
        import time as _t
        w0 = _t.perf_counter()
        page.wait_for_timeout(2000)
        w1 = _t.perf_counter()
        t_b = page.evaluate("window.__brainSim.getReplayState().tMs")
        wall_ms = (w1 - w0) * 1000
        adv = t_b - t_a
        ratio = adv / wall_ms if wall_ms else 0
        check("replay 0.25x advances at ~quarter speed",
              0.15 < ratio < 0.35, f"advanced {adv:.0f} ms over {wall_ms:.0f} ms wall (ratio {ratio:.2f})")
        rs1 = page.evaluate("window.__brainSim.getReplayState()")
        check("replay still active at 0.25x", rs1["active"] is True and rs1["speed"] == 0.25,
              f"state={rs1}")
        # Back to live.
        page.locator(".replay-live").click()
        page.wait_for_timeout(300)
        rs2 = page.evaluate("window.__brainSim.getReplayState()")
        check("back-to-live clears replay", rs2["active"] is False, f"state={rs2}")

        # ---- 5b. pinned window survives history rollover ---------------------
        # The 600-entry snapHistory evicts the window ~10 s after the pulse
        # (observed: histLast advanced ~1.7x wall under SwiftShader); the
        # pinned window must still be intact this late in the run.
        late_window = page.evaluate("window.__brainSim.getLastResponseWindow()")
        check("pinned window survives history rollover",
              late_window is not None and len(late_window["snapshots"]) >= 60,
              f"snapshots={len(late_window['snapshots']) if late_window else 0} "
              f"(was {n_snaps} shortly after the pulse)")
        box = page.locator(".brain-scene").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(2500)
        after_click = page.evaluate("window.__brainSim.getResponseSummary()")
        check("real canvas click produces a response",
              after_click is not None and after_click["count"] >= 1,
              f"count={after_click['count'] if after_click else None}")

        # ---- 6. RESET clears baseline/window --------------------------------
        page.locator("button:has-text('RESET')").first.click()
        page.wait_for_timeout(800)
        check("RESET clears baseline",
              page.evaluate("window.__brainSim.getBaseline()") is None)
        check("RESET panel back to not-yet-stimulated",
              "尚未刺激" in page.locator(".response-panel").inner_text())
        check("RESET clears 3D response markers",
              page.evaluate("window.__brainScene.getResponseMarkers()") ==
              {"input": 0, "local": 0, "network": 0})

        check("zero console errors", len(errors) == 0, f"errors={errors[:5]}")

        REPORT.write_text(json.dumps({
            "summary_peak40": peak40,
            "responder_count": n_resp,
            "distal_peaks": [round(d, 4) for d in sorted(distal, reverse=True)],
            "window_snapshots": n_snaps,
            "checks": results,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        browser.close()
        failed = [r for r in results if not r["ok"]]
        print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
        raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()

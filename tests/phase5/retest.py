"""Phase 5 focused retest: re-check the 6 first-run failures with corrected methods.

- S2: poll concurrently IN the page (poller starts before the click), so the
  ~70 ms transient cannot be missed by slow Playwright round-trips.
- B2: slow deliberate drag + record marker kinds.
- C2: rotate the brain ~180 deg, then hover both sides; also data-level check.
- D1: warm second load (same browser context) time-to-ready.
- B6b: confirm pause -> RESET desync.
- C4: chart spike visible shortly after a click (element screenshot).

Writes tests/phase5/retest-report.json.
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

        # ---- D1 warm load ---------------------------------------------------
        import time as _t
        page.goto(BASE, wait_until="networkidle", timeout=30000)
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        t0 = _t.perf_counter()
        page.goto(BASE, wait_until="networkidle", timeout=30000)
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        warm_ms = int((_t.perf_counter() - t0) * 1000)
        check("D1 warm reload interactive", warm_ms < 5000, f"warm ready in {warm_ms} ms")
        page.wait_for_function("window.__brainScene", timeout=10000)
        page.wait_for_timeout(1500)

        box = page.locator(".brain-scene").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        # auto-rotate off for stable geometry
        rot_btn = page.locator("button:has-text('旋转')")
        if "开" in rot_btn.inner_text():
            rot_btn.click()
            page.wait_for_timeout(300)

        # ---- S2 retest: peak tracker ----------------------------------------
        # 与 acceptance S2 同理：帧率采样抓不住 200 ms 瞬态，改用
        # SimClient 的峰值追踪（60 Hz 快照流逐条更新）。
        page.evaluate("window.__brainSim.reset()")
        page.wait_for_timeout(1500)
        page.mouse.move(cx, cy - 40)
        page.wait_for_timeout(300)
        base = page.evaluate("Array.from(window.__brainSim.getSnapshot().e)")
        page.evaluate("window.__brainSim.resetPeakTracking()")
        page.mouse.click(cx, cy - 40)
        page.wait_for_timeout(200)
        # chart spike: element screenshot as soon as possible after the click
        page.locator(".panels .panel").first.screenshot(path=str(OUT / "05-chart-spike.png"))
        page.wait_for_function(
            "window.__brainSim.getPeakE() !== null", timeout=10000)
        page.wait_for_timeout(2000)
        peak = page.evaluate("Array.from(window.__brainSim.getPeakE())")
        panel = page.locator(".region-panel").inner_text()
        m = re.search(r"#(\d+) / 76", panel)
        sel = int(m.group(1)) if m else None
        others = [n for n in range(76)
                  if n != sel and abs(peak[n] - base[n]) > 0.01]
        check("S2-retest stimulated node responds (peak tracker)",
              sel is not None and peak[sel] > 0.05,
              f"max E[{sel}] = {peak[sel]:.3f}" if sel is not None else "no selection")
        check("S2-retest network responds (peak tracker)",
              len(others) > 0, f"{len(others)}/75 regions >0.01: {others[:10]}")
        page.screenshot(path=str(OUT / "05-after-click-retest.png"))

        # ---- B2 retest: slow drag -------------------------------------------
        page.evaluate("window.__brainSim.reset()")
        page.wait_for_timeout(500)
        for label, steps, pause_ms in (("slow drag (600 ms, 20 steps)", 20, 30),
                                       ("normal drag (10 steps)", 10, 0)):
            before = page.evaluate("window.__brainSim.getMarkers()")
            page.mouse.move(cx, cy)
            page.mouse.down()
            for i in range(1, steps + 1):
                page.mouse.move(cx + 200 * i / steps, cy - 50 * i / steps)
                if pause_ms:
                    page.wait_for_timeout(pause_ms)
            page.mouse.up()
            page.wait_for_timeout(400)
            after = page.evaluate("window.__brainSim.getMarkers()")
            new = after[len(before):]
            check(f"B2-retest {label}: no stimulus from drag", len(new) == 0,
                  f"new markers: {new}")
            # 回归（B2 修复后新增）：拖动不仅不能产生标记，也不能让引擎
            # 进入持续输入或锁定——锁定横幅与全脑变亮是此前误判的后果。
            snap_after = page.evaluate("window.__brainSim.getSnapshot()")
            p_max_after = max(abs(v) for v in snap_after["p"])
            check(f"B2-retest {label}: no sustained input, no lock",
                  p_max_after == 0 and not snap_after["locked"],
                  f"max|P|={p_max_after}, locked={snap_after['locked']}")

        # ---- C2 retest: rotate ~180 deg, hover both sides -------------------
        # drag in stages to turn the brain around
        for _ in range(3):
            page.mouse.move(cx, cy)
            page.mouse.down()
            for i in range(1, 13):
                page.mouse.move(cx + 260 * i / 12, cy)
                page.wait_for_timeout(40)
            page.mouse.up()
            page.wait_for_timeout(600)

        def hover_label(x, y):
            page.mouse.move(x, y)
            page.wait_for_timeout(700)
            tip = page.locator(".brain-tooltip")
            return tip.inner_text() if tip.count() and tip.is_visible() else ""

        seen = {}
        for (x, y) in ((cx - 180, cy - 20), (cx + 180, cy - 20),
                       (cx - 60, cy - 100), (cx + 60, cy + 80),
                       (cx - 220, cy + 60), (cx + 220, cy - 60)):
            lab = hover_label(x, y)
            if lab:
                seen[lab.split(" ")[0]] = lab
        prefixes = {k[0] for k in seen}
        check("C2-retest both hemispheres reachable after rotation",
              "l" in prefixes and "r" in prefixes,
              f"labels seen: {sorted(seen)}")
        page.screenshot(path=str(OUT / "06-rotated-180.png"))

        # ---- B6b regression: pause -> RESET -> pause -> resume -------------
        # 回归（B6b 修复后扩展为完整循环）：RESET 必须让 Worker 的 paused
        # 清零、时钟从 0 推进且界面显示运行中；此后再次暂停/恢复也必须
        # 全程与界面一致，不许再出现“显示运行中、时钟不动”。
        page.locator("button:has-text('PLAY')").click()  # pause
        page.wait_for_timeout(300)
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(1000)
        t_r1 = sim_time(page)
        page.wait_for_timeout(1200)
        t_r2 = sim_time(page)
        check("B6b-retest pause->RESET clock resumes", t_r2 > t_r1,
              f"TIME {t_r1} -> {t_r2} s after RESET")
        play_label = page.locator("button:has-text('PLAY')").inner_text()
        check("B6b-retest UI shows running after RESET", "运行中" in play_label,
              f"PLAY button = {play_label!r}")
        if t_r2 <= t_r1:
            page.evaluate("window.__brainSim.resume()")
            page.wait_for_timeout(500)
        # 再暂停一次：时钟必须冻结
        page.locator("button:has-text('PLAY')").click()  # pause again
        page.wait_for_timeout(300)
        t_p1 = sim_time(page)
        page.wait_for_timeout(1000)
        t_p2 = sim_time(page)
        check("B6b-retest pause again freezes clock", t_p1 == t_p2,
              f"TIME {t_p1} -> {t_p2} s while paused")
        # 再恢复：时钟必须重新推进
        page.locator("button:has-text('PLAY')").click()  # resume again
        page.wait_for_timeout(1200)
        t_r3 = sim_time(page)
        check("B6b-retest resume restarts clock", t_r3 > t_p2,
              f"TIME {t_p2} -> {t_r3} s after resume")

        check("no console errors in retest", len(errors) == 0, f"errors={errors[:3]}")
        browser.close()

    failed = [r for r in results if not r["ok"]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    (Path(__file__).parent / "retest-report.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

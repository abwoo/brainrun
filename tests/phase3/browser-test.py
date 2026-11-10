"""Phase 3 browser test for Brain Physics Playground (local headless Chromium).

Drives the real app at http://127.0.0.1:4173/ (Vite preview of the Phase 3
build) and checks the live loop: click -> model response -> 3D colour +
waveform change; G=0 isolation; hold release stops input; pause freezes the
simulation clock; reset restores t=0.  Uses the window.__brainSim test
bridge (read-only state + the same commands the UI uses) for the causal
assertions, and real mouse clicks for the interaction assertions.

Prereq: `npm run preview -- --port 4173` running in app/.
Screenshots go to tests/phase3/shots/.
"""
import json
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
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.set_default_timeout(60000)
        errors = []
        failed_reqs = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("requestfailed", lambda r: failed_reqs.append(f"{r.url} {r.failure}"))

        page.goto(BASE, wait_until="networkidle", timeout=30000)
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        page.wait_for_timeout(1500)

        check("sim ready, PLAY running",
              "运行中" in page.locator("button:has-text('PLAY')").inner_text())
        t1 = sim_time(page)
        page.wait_for_timeout(1200)
        t2 = sim_time(page)
        check("simulation clock advances", t2 > t1, f"TIME {t1} -> {t2} s")
        page.screenshot(path=str(OUT / "01-live.png"))

        # --- click a region: waveform + 3D colour must change -------------
        box = page.locator(".brain-scene").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy - 40)
        page.wait_for_timeout(500)
        before = (OUT / "01-live.png").read_bytes()
        # 响应是瞬态的（峰值约在刺激后 100 ms，72 ms 内恢复）：页内轮询
        # 在约 1 Hz 的帧率下每秒只采 1 个点，会随机错过瞬态（Round 2
        # 因此失败）。改用峰值追踪：点击前清零，点后等快照流排空再读
        # 峰值——60 Hz 快照流逐条更新，瞬态一定被记下。断言本身不变。
        page.evaluate("window.__brainSim.resetPeakTracking()")
        page.mouse.click(cx, cy - 40)
        panel = page.locator(".region-panel").inner_text()
        m = re.search(r"#(\d+) / 76", panel)
        sel = int(m.group(1)) if m else None
        check("click selects a region", sel is not None, f"panel={panel[:80]!r}")
        max_e = 0.0
        if sel is not None:
            page.wait_for_function(
                "window.__brainSim.getPeakE() !== null", timeout=10000)
            page.wait_for_timeout(2000)  # 等 60 Hz 快照流排空，峰值落袋
            max_e = page.evaluate(
                f"Array.from(window.__brainSim.getPeakE())[{sel}]")
            check("selected region E rose after click", max_e > 0.05,
                  f"max E[{sel}] (peak tracker) = {max_e:.3f} (baseline ~0.011)")
            e_text = page.locator(".region-facts").inner_text()
            check("E readout visible in panel", "兴奋活动 E" in e_text)
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / "02-after-click.png"))
        after = (OUT / "02-after-click.png").read_bytes()
        check("click changes the picture (3D + waveform)", before != after)

        # --- G=0 isolation (via debug bridge, same commands as UI) -------
        page.evaluate("""() => {
            const b = window.__brainSim;
            b.reset();
            b.setParams({ g: 0 });
        }""")
        page.wait_for_timeout(2500)  # let every node settle to baseline
        e_before = page.evaluate("Array.from(window.__brainSim.getSnapshot().e)")
        # 与上面同理：页内轮询抓不住 200 ms 瞬态，改读峰值追踪。
        page.evaluate("window.__brainSim.resetPeakTracking()")
        page.evaluate("window.__brainSim.pulse(40)")
        page.wait_for_timeout(2000)  # 等 60 Hz 快照流排空，峰值落袋
        peak = page.evaluate("Array.from(window.__brainSim.getPeakE())")
        max_other = max(abs(peak[n] - e_before[n]) for n in range(76) if n != 40)
        resp40 = abs(peak[40] - e_before[40])
        check("G=0: other nodes unaffected", max_other < 1e-6,
              f"max |dE| on other 75 nodes = {max_other:.2e}")
        check("G=0: stimulated node still responds", resp40 > 0.05,
              f"|dE| node 40 = {resp40:.3f}")
        page.evaluate("window.__brainSim.setParams({ g: 0.35 })")

        # --- hold: input while held, stops on release ----------------------
        page.evaluate("window.__brainSim.holdStart(40)")
        page.wait_for_timeout(600)
        p_held = page.evaluate("window.__brainSim.getSnapshot().p[40]")
        page.evaluate("window.__brainSim.holdEnd(40)")
        page.wait_for_timeout(300)
        p_after = page.evaluate("window.__brainSim.getSnapshot().p[40]")
        check("hold applies input", p_held > 0, f"P[40] while held = {p_held}")
        check("release stops input", p_after == 0, f"P[40] after release = {p_after}")

        # --- pause freezes the clock ---------------------------------------
        page.locator("button:has-text('PLAY')").click()
        page.wait_for_timeout(300)
        tp1 = sim_time(page)
        page.wait_for_timeout(1200)
        tp2 = sim_time(page)
        check("pause freezes simulation time", tp1 == tp2, f"TIME {tp1} -> {tp2} s")
        page.locator("button:has-text('PLAY')").click()
        page.wait_for_timeout(1000)
        tp3 = sim_time(page)
        check("resume restarts the clock", tp3 > tp2, f"TIME {tp2} -> {tp3} s")

        # --- reset restores t=0 --------------------------------------------
        # RESET 后时钟从 0 重新走：400 ms 后读数应在 1 s 以内（且远小于重置前）。
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(400)
        tr = sim_time(page)
        check("reset restores t=0", tr < 1.0, f"TIME 400 ms after reset = {tr} s (was ~7.8 s)")

        # --- narrow layout ---------------------------------------------------
        page.set_viewport_size({"width": 978, "height": 800})
        page.wait_for_timeout(1000)
        overflow = page.evaluate(
            "document.documentElement.scrollWidth > document.documentElement.clientWidth")
        check("978px: no horizontal overflow", not overflow)
        page.screenshot(path=str(OUT / "03-978px.png"))

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

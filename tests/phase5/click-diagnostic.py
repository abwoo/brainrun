"""Diagnostic: why does a real UI click sometimes produce no response?

For each of 3 clicks, record in-page (10 ms sampling, 3 s window):
- markers recorded for the click (kind / node / t_ms)
- P[node] and E[node] series with wall timestamps
- snapshot t_ms progression (worker tick health)

Prints the raw series summaries. Run: .venv/bin/python tests/phase5/click-diagnostic.py
"""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
OUT = Path(__file__).parent


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(
            Path.home() / ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome"
        ), args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        page.set_default_timeout(60000)
        page.goto(BASE, wait_until="networkidle", timeout=30000)
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        page.wait_for_function("window.__brainScene", timeout=10000)
        page.wait_for_timeout(1500)
        box = page.locator(".brain-scene").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        rot_btn = page.locator("button:has-text('旋转')")
        if "开" in rot_btn.inner_text():
            rot_btn.click()
            page.wait_for_timeout(300)

        for trial in range(3):
            page.evaluate("window.__brainSim.reset()")
            page.wait_for_timeout(1200)
            # arm an in-page recorder BEFORE the click
            page.evaluate(
                """() => {
                    window.__rec = { markers0: window.__brainSim.getMarkers().length, series: [] };
                    window.__recDone = false;
                    (async () => {
                        const b = window.__brainSim;
                        const t0 = performance.now();
                        while (performance.now() - t0 < 3000) {
                            const s = b.getSnapshot();
                            if (s) window.__rec.series.push([Math.round(performance.now() - t0), s.t_ms, s.e[47], s.p[47]]);
                            await new Promise(r => setTimeout(r, 10));
                        }
                        window.__recDone = true;
                    })();
                    return 'armed';
                }""")
            t_click = page.evaluate("performance.now()")
            page.mouse.move(cx, cy - 40)
            page.wait_for_timeout(200)
            page.mouse.click(cx, cy - 40)
            t_after = page.evaluate("performance.now()")
            page.wait_for_function("window.__recDone", timeout=15000)
            rec = page.evaluate("window.__rec")
            markers = page.evaluate("window.__brainSim.getMarkers()")
            new_markers = markers[rec["markers0"]:]
            series = rec["series"]
            max_e = max(s[2] for s in series)
            max_p = max(s[3] for s in series)
            # sim-time advance per wall second (worker tick health)
            t_first = series[0][1] if series else None
            t_last = series[-1][1] if series else None
            wall_span = series[-1][0] - series[0][0] if len(series) > 1 else 0
            print(f"--- trial {trial + 1} ---")
            print(f"  click dispatch took {t_after - t_click:.0f} ms (wall, incl. Playwright round-trip)")
            print(f"  new markers: {new_markers}")
            print(f"  max E[47] in 3 s window: {max_e:.4f}; max P[47]: {max_p}")
            print(f"  samples: {len(series)}; sim time {t_first} -> {t_last} ms over {wall_span} ms wall")
            # first time E exceeds 0.05, if ever
            above = next((s for s in series if s[2] > 0.05), None)
            print(f"  first E>0.05 at: {above}")
            page.wait_for_timeout(500)
        browser.close()


if __name__ == "__main__":
    main()

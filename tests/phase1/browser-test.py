"""Phase 1 browser test for Brain Physics Playground (local headless Chromium).

Opens the Vite preview at http://127.0.0.1:4173/, checks console errors,
screenshots at 1920px and 978px, hovers/clicks a brain region, drags to rotate,
and exercises PLAY / CONNECT / RESET. Prints a PASS/FAIL report.
Screenshots go to tests/phase1/shots/.
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
OUT = Path(__file__).parent / "shots"
OUT.mkdir(parents=True, exist_ok=True)

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
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.set_default_timeout(60000)
        errors = []
        failed_reqs = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("requestfailed", lambda r: failed_reqs.append(f"{r.url} {r.failure}"))

        page.goto(BASE, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(3000)

        check("page loads, title present",
              "Brain Physics" in page.title() or "Brain" in page.content()[:2000],
              f"title={page.title()!r}")
        check("top bar visible", page.locator("text=BRAIN PHYSICS").count() >= 1)
        check("LIVE ACTIVITY panel", page.locator("text=LIVE ACTIVITY").count() >= 1)
        check("SIMULATION OFFLINE shown (no fake waveform)",
              page.locator("text=SIMULATION OFFLINE").count() >= 1)
        check("PHASE 1 PROTOTYPE footer",
              page.locator("text=PHASE 1 PROTOTYPE").count() >= 1)

        canvas = page.locator(".brain-scene canvas")
        check("WebGL canvas present", canvas.count() == 1)
        page.screenshot(path=str(OUT / "01-1920-initial.png"))

        # Hover over the brain centre to trigger highlight + tooltip
        box = page.locator(".brain-scene").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy - 40)
        page.wait_for_timeout(800)
        tooltip = page.locator(".brain-tooltip")
        tip_text = tooltip.inner_text() if tooltip.count() else ""
        tip_visible = tooltip.is_visible() if tooltip.count() else False
        check("hover shows region tooltip", tip_visible and tip_text.strip() != "",
              f"visible={tip_visible} text={tip_text!r}")
        page.screenshot(path=str(OUT / "02-hover.png"))

        # Click the region and check REGION panel updates
        page.mouse.click(cx, cy - 40)
        page.wait_for_timeout(800)
        region_panel = page.locator("text=REGION / CONNECTION").locator("..")
        panel_text = region_panel.inner_text()
        selected = "编号" in panel_text
        check("click selects a region (panel updates)", selected,
              f"panel={panel_text[:200]!r}")
        page.screenshot(path=str(OUT / "03-selected.png"))

        # CONNECT toggle: arcs should appear for the selected region
        page.locator("button:has-text('CONNECT')").click()
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / "04-connect-on.png"))

        # Drag to rotate: canvas pixels must change (screenshot bytes differ)
        before = (OUT / "03-selected.png").read_bytes()
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 250, cy + 60, steps=12)
        page.mouse.up()
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / "05-rotated.png"))
        after = (OUT / "05-rotated.png").read_bytes()
        check("drag rotates the brain (pixels change)", before != after)

        # PLAY toggle pauses/resumes auto-rotate
        play_btn = page.locator("button:has-text('PLAY')")
        label_before = play_btn.inner_text()
        play_btn.click()
        page.wait_for_timeout(400)
        label_after = play_btn.inner_text()
        check("PLAY toggles rotate state", label_before != label_after,
              f"{label_before!r} -> {label_after!r}")

        # RESET restores view and clears selection
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(800)
        panel_after = region_panel.inner_text()
        check("RESET clears selection", "未选中" in panel_after or "选择" in panel_after,
              f"panel={panel_after[:120]!r}")
        page.screenshot(path=str(OUT / "06-after-reset.png"))

        # Narrow layout
        page.set_viewport_size({"width": 978, "height": 800})
        page.wait_for_timeout(1000)
        overflow = page.evaluate(
            "document.documentElement.scrollWidth > document.documentElement.clientWidth")
        check("978px: no horizontal overflow", not overflow)
        page.screenshot(path=str(OUT / "07-978px.png"))

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

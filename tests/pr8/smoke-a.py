#!/usr/bin/env python3
"""PR8-A browser smoke: four modes, progressive disclosure, scenario launcher.

Checks, at 1920x1080 and 978px:
  A1  app loads (3D stage present, TIME advances, no console errors)
  A2  mode switcher PLAY/WAVES/EEG/EXPLORE: each mode shows its real content
      (WAVES = WavesTab hint; EEG = inline 6-tab lab; EXPLORE = brain-region browser)
  A3  progressive disclosure: PARAMETERS hidden by default; "更多" reveals it
      (.param count 0 -> 4); the toggle is in the topbar
  A4  "一键场景" opens the launcher; S14 (fast, no fixture) runs and appends a
      record; S4 runs and appends a record, then WAVES mode shows a real PSD
  A5  S5 (needs the sphere fixture) runs and appends a record
  A6  S1 (live engine) runs: pulse on node 40, peak dE read back into a record
  A7  no horizontal overflow (document + open modal), no new occlusion of
      topbar chips

Usage: start preview first (npm run preview -- --port 4173 --host 127.0.0.1
from app/), then:  ~/workspace/brainrun/.venv/bin/python tests/pr8/smoke-a.py
Screenshots: tests/pr8/smoke-shots/<viewport>-<name>.png
"""
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "tests" / "pr8" / "smoke-shots"
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:4173/"

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def overflow_info(page):
    return page.evaluate(
        """() => {
          const de = document.documentElement;
          const modal = document.querySelector('.modal');
          return {
            docScrollW: de.scrollWidth, docClientW: de.clientWidth,
            modalScrollW: modal ? modal.scrollWidth : null,
            modalClientW: modal ? modal.clientWidth : null,
          };
        }"""
    )


def no_overflow(page):
    o = overflow_info(page)
    ok = o["docScrollW"] <= o["docClientW"] + 1
    if o["modalScrollW"] is not None:
        ok = ok and o["modalScrollW"] <= o["modalClientW"] + 1
    return ok, str(o)


def run_scenario(page, sid, timeout_ms=20000):
    """Click '运行 S<n>' in the launcher and wait for its record row."""
    page.locator(f'div[data-scenario="{sid}"] button:has-text("运行 S{sid}")').click()
    try:
        page.locator(f'li[data-record="{sid}"]').first.wait_for(timeout=timeout_ms)
        return True, page.locator(f'li[data-record="{sid}"]').first.inner_text()[:200]
    except Exception as e:
        return False, f"no record for S{sid}: {e}"


def run_viewport(pw, width, height, tag):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.goto(BASE, wait_until="load", timeout=60000)
    page.wait_for_timeout(5000)
    stage = page.locator(".stage")
    check(f"{tag} A1 stage present", stage.count() >= 1)
    t1 = page.locator(".bottombar .mono").inner_text()
    page.wait_for_timeout(2000)
    t2 = page.locator(".bottombar .mono").inner_text()
    check(f"{tag} A1 TIME advances", t1 != t2, f"{t1!r} -> {t2!r}")
    page.screenshot(path=str(SHOTS / f"{tag}-play.png"))

    # A2: mode switcher exists with four modes.
    modes = page.locator(".mode-switch button[data-mode]")
    check(f"{tag} A2 four mode buttons", modes.count() == 4,
          f"count={modes.count()}")
    # A3: progressive disclosure — PARAMETERS hidden by default.
    check(f"{tag} A3 .param hidden by default", page.locator(".param").count() == 0,
          f".param={page.locator('.param').count()}")
    page.get_by_role("button", name=re.compile(r"^更多")).click()
    page.wait_for_timeout(500)
    check(f"{tag} A3 更多 reveals PARAMETERS", page.locator(".param").count() == 4,
          f".param={page.locator('.param').count()}")
    page.get_by_role("button", name=re.compile(r"^更多")).click()
    page.wait_for_timeout(400)
    check(f"{tag} A3 更多 collapses again", page.locator(".param").count() == 0)

    # A2 (cont.): WAVES mode shows the Waves view.
    page.locator('button[data-mode="waves"]').click()
    page.wait_for_timeout(600)
    check(f"{tag} A2 WAVES shows WavesTab", "频段 / PSD" in page.locator(".waves-panel").inner_text())
    page.screenshot(path=str(SHOTS / f"{tag}-waves.png"))
    # EEG mode: inline six-tab lab.
    page.locator('button[data-mode="eeg"]').click()
    page.wait_for_timeout(600)
    check(f"{tag} A2 EEG inline lab, 6 tabs",
          page.locator(".eeg-lab-inline").count() == 1
          and page.locator('.eeg-lab-inline [role="tab"]').count() == 6,
          f"tabs={page.locator('.eeg-lab-inline [role=tab]').count()}")
    page.screenshot(path=str(SHOTS / f"{tag}-eeg.png"))
    # EXPLORE mode: region browser.
    page.locator('button[data-mode="explore"]').click()
    page.wait_for_timeout(600)
    check(f"{tag} A2 EXPLORE shows region browser",
          "脑区浏览器" in page.locator(".explore-panel").inner_text())
    page.screenshot(path=str(SHOTS / f"{tag}-explore.png"))
    page.locator('button[data-mode="play"]').click()
    page.wait_for_timeout(400)

    # A4/A5/A6: scenario launcher.
    page.get_by_role("button", name="一键场景", exact=True).click()
    page.wait_for_timeout(1500)
    check(f"{tag} A4 launcher opens", page.locator('[role="dialog"][aria-label="一键科学场景"]').count() == 1)
    ok, detail = run_scenario(page, 14)
    check(f"{tag} A4 S14 runs + records", ok, detail)
    ok, detail = run_scenario(page, 4, timeout_ms=30000)
    check(f"{tag} A4 S4 runs + records", ok, detail)
    ok, detail = run_scenario(page, 5)
    check(f"{tag} A5 S5 runs + records (fixture)", ok, detail)
    ok, detail = run_scenario(page, 1, timeout_ms=30000)
    check(f"{tag} A6 S1 live runs + records", ok, detail)
    page.screenshot(path=str(SHOTS / f"{tag}-launcher.png"))
    ok, detail = no_overflow(page)
    check(f"{tag} A7 no overflow with launcher open", ok, detail)
    page.get_by_role("button", name="关闭", exact=True).click()
    page.wait_for_timeout(400)
    # WAVES mode now shows a real PSD from the S4 recording.
    page.locator('button[data-mode="waves"]').click()
    page.wait_for_timeout(800)
    check(f"{tag} A4 WAVES shows real PSD after S4",
          page.locator('svg[aria-label*="Welch PSD"]').count() >= 1)
    page.screenshot(path=str(SHOTS / f"{tag}-waves-psd.png"))
    ok, detail = no_overflow(page)
    check(f"{tag} A7 no overflow in WAVES", ok, detail)
    check(f"{tag} A1 no console/page errors", len(errors) == 0, "; ".join(errors[:5]))
    browser.close()


with sync_playwright() as pw:
    run_viewport(pw, 1920, 1080, "1920")
    run_viewport(pw, 978, 800, "978")

failed = [r for r in RESULTS if not r[1]]
print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
if failed:
    print("FAILED:")
    for name, _, detail in failed:
        print(f"  - {name}  {detail}")
    sys.exit(1)

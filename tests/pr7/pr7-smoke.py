#!/usr/bin/env python3
"""PR7 browser smoke: the three new labs open, render, and run (no full regression).

Checks, at 1920x1080 and 978px:
  S1  app loads (3D stage present, TIME advances)
  S2  chip "细胞实验" opens CellularLab modal; run a HH sim; no horizontal overflow
  S3  chip "刺激实验" opens StimLab modal; TES field value renders; no overflow
  S4  chip "对照实验" opens ExperimentLab modal; run A/B; no overflow
  S5  modal closes; topbar chips all visible (no occlusion by overflow)

Usage: start preview first (npm run preview -- --port 4173 --host 127.0.0.1
from app/), then:  ~/workspace/brainrun/.venv/bin/python tests/pr7/pr7-smoke.py
Screenshots: tests/pr7/smoke-shots/<viewport>-<lab>.png
"""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "tests" / "pr7" / "smoke-shots"
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
    # modal content wider than the modal box = clipped content (fail);
    # document-level horizontal scroll = layout break (fail).
    ok = o["docScrollW"] <= o["docClientW"] + 1
    if o["modalScrollW"] is not None:
        ok = ok and o["modalScrollW"] <= o["modalClientW"] + 1
    return ok, str(o)


def open_lab(page, chip_text, modal_text):
    page.get_by_role("button", name=chip_text, exact=True).click()
    page.wait_for_timeout(800)
    modal = page.locator(".modal")
    ok = modal.count() >= 1 and modal_text in (modal.first.inner_text() or "")
    return ok


def close_lab(page):
    btn = page.get_by_role("button", name="关闭", exact=True)
    if btn.count():
        btn.first.click()
        page.wait_for_timeout(400)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)


def run_viewport(pw, width, height, tag):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": width, "height": height})
    page.goto(BASE, wait_until="load", timeout=60000)
    page.wait_for_timeout(4000)
    stage = page.locator(".stage")
    check(f"[{tag}] S1 app loads", stage.count() >= 1)
    t1 = page.locator("text=TIME").first.inner_text() if page.locator("text=TIME").count() else ""
    page.wait_for_timeout(3000)
    t2 = page.locator("text=TIME").first.inner_text() if page.locator("text=TIME").count() else ""
    check(f"[{tag}] S1 TIME advances", t1 != t2, f"{t1!r} -> {t2!r}")

    # S2 CellularLab
    ok = open_lab(page, "细胞实验", "CELLULAR LAB")
    check(f"[{tag}] S2 CellularLab opens", ok)
    if ok:
        # run the default HH sim (button text contains 运行)
        run_btn = page.get_by_role("button", name="运行")
        if run_btn.count():
            run_btn.first.click()
            page.wait_for_timeout(1500)
        body = page.locator(".modal").first.inner_text()
        check(f"[{tag}] S2 CellularLab shows result", "mV" in body, "V_m curve rendered")
        ok2, info = no_overflow(page)
        check(f"[{tag}] S2 no overflow", ok2, info)
        page.screenshot(path=str(SHOTS / f"{tag}-cellular.png"))
    close_lab(page)

    # S3 StimLab
    ok = open_lab(page, "刺激实验", "STIMULATION LAB")
    check(f"[{tag}] S3 StimLab opens", ok)
    if ok:
        body = page.locator(".modal").first.inner_text()
        check(f"[{tag}] S3 StimLab shows field", "V/m" in body, "field readout rendered")
        ok2, info = no_overflow(page)
        check(f"[{tag}] S3 no overflow", ok2, info)
        page.screenshot(path=str(SHOTS / f"{tag}-stim.png"))
    close_lab(page)

    # S4 ExperimentLab
    ok = open_lab(page, "对照实验", "EXPERIMENT LAB")
    check(f"[{tag}] S4 ExperimentLab opens", ok)
    if ok:
        run_ab = page.get_by_role("button", name="运行对照")
        if run_ab.count():
            run_ab.first.click()
            page.wait_for_timeout(2500)
        body = page.locator(".modal").first.inner_text()
        check(f"[{tag}] S4 A/B comparison renders", ("差" in body) or ("比较" in body))
        ok2, info = no_overflow(page)
        check(f"[{tag}] S4 no overflow", ok2, info)
        page.screenshot(path=str(SHOTS / f"{tag}-experiment.png"))
    close_lab(page)

    # S5 topbar chips visible (none pushed out of the viewport by wrapping overflow)
    chips = page.locator(".topbar-controls .chip")
    box = page.locator(".topbar-controls").bounding_box()
    vis = 0
    for i in range(chips.count()):
        b = chips.nth(i).bounding_box()
        if b and b["x"] >= 0 and b["x"] + b["width"] <= width + 1:
            vis += 1
    check(f"[{tag}] S5 topbar chips visible", vis == chips.count(), f"{vis}/{chips.count()}")
    browser.close()


def main():
    with sync_playwright() as pw:
        run_viewport(pw, 1920, 1080, "1920")
        run_viewport(pw, 978, 800, "978")
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

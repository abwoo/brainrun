#!/usr/bin/env python3
"""PR8-D browser smoke: StimLab new controls + WavesTab noise toggle.

Checks, at 1920x1080 and 978px (preview port 4175):
  D1  app loads, no console errors on load
  D2  chip "刺激实验" opens StimLab; coil-shape select switches to figure-8
      and the field value updates; biphasic period slider moves; E(t) renders
  D3  Level B/C "显示场箭头" checkbox renders the arrow SVG; no console errors
  D4  EEG lab opens; Waves tab noise-background checkbox toggles; no console errors

Usage: start preview first (npm run preview -- --port 4175 --host 127.0.0.1
from app/), then:  ~/workspace/brainrun/.venv/bin/python tests/pr8/pr8d-smoke.py
Screenshots: tests/pr8/smoke-shots/<viewport>-<lab>.png
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "tests" / "pr8" / "smoke-shots"
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:4175/"

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def run_viewport(pw, width, height, tag):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until="load", timeout=60000)
    page.wait_for_timeout(4000)
    check(f"{tag} D1 app loads, no console errors", len(errors) == 0, "; ".join(errors[:3]))

    # D2: StimLab, figure-8 + biphasic.
    page.get_by_role("button", name="刺激实验", exact=True).click()
    page.wait_for_timeout(800)
    modal = page.locator(".modal").first
    ok = "STIMULATION LAB" in (modal.inner_text() or "")
    check(f"{tag} D2a StimLab opens", ok)
    # Default level is B (TES); switch to Level C for TMS controls.
    page.get_by_label("刺激级别").select_option("C")
    page.wait_for_timeout(500)
    before = modal.inner_text()
    page.get_by_label("线圈形状").select_option("figure8")
    page.wait_for_timeout(800)
    after = modal.inner_text()
    # Figure-8 field at the default target [0,0,70] (on the circular coil's
    # axis, where circular is 0): 178.496 V/m under the figure-8 junction.
    check(f"{tag} D2b figure-8 field updates", "178.496" in after,
          "field text changed: " + str(before != after))
    biphasic = page.locator('svg[aria-label^="双相脉冲"]')
    check(f"{tag} D2c biphasic E(t) renders", biphasic.count() >= 1)
    slider = page.get_by_label("双相脉冲周期")
    slider.fill("0.5")
    page.wait_for_timeout(400)
    check(f"{tag} D2d biphasic period slider moves",
          "0.50 ms" in (modal.inner_text() or ""), "period label updated")
    page.screenshot(path=str(SHOTS / f"{tag}-stimlab.png"))

    # D3: field arrows (still Level C).
    page.get_by_label("显示场箭头").check()
    page.wait_for_timeout(600)
    arrows = page.locator('svg[aria-label^="中央 y 切片场箭头"]')
    check(f"{tag} D3 field arrows render", arrows.count() >= 1)
    page.screenshot(path=str(SHOTS / f"{tag}-stimlab-arrows.png"))
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(400)

    # D4: EEG lab -> Waves tab -> noise background toggle.
    page.get_by_role("button", name="EEG 分析", exact=True).click()
    page.wait_for_timeout(800)
    # Run an experiment first so Waves has a recording (button label from EegAnalysisLab).
    run_btn = page.get_by_role("button", name="运行实验")
    if run_btn.count():
        run_btn.first.click()
        page.wait_for_timeout(3000)
    page.get_by_role("tab", name="频谱", exact=True).click()
    page.wait_for_timeout(800)
    toggle = page.get_by_label("叠加噪声背景")
    check(f"{tag} D4a Waves noise toggle present", toggle.count() >= 1)
    if toggle.count():
        toggle.check()
        page.wait_for_timeout(800)
        body = page.locator("body").inner_text()
        check(f"{tag} D4b Waves with background shows comparison",
              "未叠加时 alpha 占比" in body)
        page.screenshot(path=str(SHOTS / f"{tag}-waves-bg.png"))
    check(f"{tag} D4c no console errors after all interactions", len(errors) == 0,
          "; ".join(errors[:3]))
    browser.close()


def main():
    with sync_playwright() as pw:
        run_viewport(pw, 1920, 1080, "1920")
        run_viewport(pw, 978, 800, "978")
    bad = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} checks passed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

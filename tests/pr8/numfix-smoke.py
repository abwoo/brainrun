#!/usr/bin/env python3
"""PR8-NUMFIX browser smoke: 5 项数值异常修复的界面验证。

Checks, at 1920x1080 and 978px (preview port 4173):
  N1  app loads, no console errors on load
  N2  EEG lab: run experiment; ERP tab shell path shows 0.000 peaks + honest
      note "窗内基本无响应"; late button shows 0.174 @352 + "模型峰约 0.17"
  N3  TFR tab shows the degenerate-ITC note (ITC 恒为 1.000 是退化值)
  N4  Topo tab auto-seeks to max-response time (1028 ms) instead of blank 400 ms
  N5  StimLab Level B (default) target |E| = 0.793 V/m (TES, not 0.000)
  N6  no horizontal overflow, no console errors after all interactions

Usage: start preview first (npm run preview -- --port 4173 --host 127.0.0.1
from app/), then:  ~/workspace/brainrun/.venv/bin/python tests/pr8/numfix-smoke.py
Screenshots: tests/pr8/smoke-shots/<viewport>-numfix-<tab>.png
"""
import sys
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


def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")


def run_viewport(pw, width, height, tag):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until="load", timeout=60000)
    page.wait_for_timeout(4000)
    check(f"{tag} N1 app loads, no console errors", len(errors) == 0, "; ".join(errors[:3]))
    check(f"{tag} N1b no horizontal overflow on load", overflow(page) <= 0, f"overflow={overflow(page)}px")

    # EEG lab: run the shell experiment (default WC, 10 s).
    page.get_by_role("button", name="EEG 分析", exact=True).click()
    page.wait_for_timeout(800)
    run_btn = page.get_by_role("button", name="运行实验")
    if run_btn.count():
        run_btn.first.click()
        page.wait_for_timeout(3000)

    # N2: ERP tab — shell path first (degenerate but honest), then late button.
    page.get_by_role("tab", name="ERP", exact=True).click()
    page.wait_for_timeout(800)
    page.get_by_role("button", name="切分试次（MNE 口径）").click()
    page.wait_for_timeout(800)
    body = page.locator("body").inner_text()
    check(f"{tag} N2a ERP shell path shows honest note", "窗内基本无响应" in body)
    check(f"{tag} N2b ERP shell path peak 0.000 @252", "0.000" in body and "252" in body)
    # 壳路径文案会提及 0.17 作对照（“要点 late 按钮才会出现”），但 late 分支
    # 的“本表 oddball 行实测 …”那句只许在 late 数据下出现。
    check(f"{tag} N2c ERP shell path has no late-branch sentence", "本表 oddball 行实测" not in body)

    # N3: TFR tab on the SHELL epochs (identical trials) — degenerate-ITC note.
    # Must run before the late button: late epochs mix conditions (diff 0.166 µV)
    # and their ITC mean 0.77 is a genuine measurement, not degenerate.
    page.get_by_role("tab", name="时频", exact=True).click()
    page.wait_for_timeout(800)
    body = page.locator("body").inner_text()
    check(f"{tag} N3 TFR degenerate-ITC note", "ITC 恒为 1.000 是退化值" in body)
    check(f"{tag} N3b TFR does not show mean ITC 1.000", "平均 ITC 1.000" not in body)
    page.screenshot(path=str(SHOTS / f"{tag}-numfix-tfr.png"))
    check(f"{tag} N3c no overflow on TFR tab", overflow(page) <= 0, f"overflow={overflow(page)}px")

    # Back to ERP: late button.
    page.get_by_role("tab", name="ERP", exact=True).click()
    page.wait_for_timeout(800)
    page.get_by_role("button", name="运行 oddball 实验（late 机制）并切分").click()
    page.wait_for_timeout(1500)
    body = page.locator("body").inner_text()
    check(f"{tag} N2d ERP late path peak 0.174 @352", "0.174" in body and "352" in body)
    check(f"{tag} N2e ERP late path claims 0.17", "模型峰约 0.17" in body)
    page.screenshot(path=str(SHOTS / f"{tag}-numfix-erp.png"))
    check(f"{tag} N2f no overflow on ERP tab", overflow(page) <= 0, f"overflow={overflow(page)}px")

    # N4: Topo tab — auto-seek to 1028 ms.
    page.get_by_role("tab", name="地形", exact=True).click()
    page.wait_for_timeout(800)
    body = page.locator("body").inner_text()
    check(f"{tag} N4 Topo auto-seeks to 1028 ms", "1028 ms" in body)
    check(f"{tag} N4b Topo max-response button present", "跳到最大响应时刻" in body)
    page.screenshot(path=str(SHOTS / f"{tag}-numfix-topo.png"))
    check(f"{tag} N4c no overflow on Topo tab", overflow(page) <= 0, f"overflow={overflow(page)}px")

    # N5: StimLab Level B default — TES target field 0.793 V/m.
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(400)
    page.get_by_role("button", name="刺激实验", exact=True).click()
    page.wait_for_timeout(800)
    modal = page.locator(".modal").first
    text = modal.inner_text() or ""
    check(f"{tag} N5 StimLab Level B target |E| 0.793", "0.793" in text, text[:200].replace("\n", " | "))
    check(f"{tag} N5b StimLab Level B grid max 2.164", "2.164" in text)
    page.screenshot(path=str(SHOTS / f"{tag}-numfix-stimlab.png"))
    check(f"{tag} N5c no overflow in StimLab", overflow(page) <= 0, f"overflow={overflow(page)}px")

    check(f"{tag} N6 no console errors after all interactions", len(errors) == 0,
          "; ".join(errors[:3]))
    browser.close()


def main():
    with sync_playwright() as pw:
        run_viewport(pw, 1920, 1080, "1920")
        run_viewport(pw, 978, 800, "978")
    bad = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} passed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

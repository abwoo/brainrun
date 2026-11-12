#!/usr/bin/env python3
"""PR8-B 第一阶段收尾探针（只读）：补三个小问题。
1. 978px 下底栏 TIME 是否真的存在、是否前进（瘦身跑里 locator 超时）。
2. 978px 下 HEAD EEG 关后再点是否不稳定（瘦身跑里 LocalBEM 路径点击超时）。
3. 源定位 tab 里 +66px 的是哪个 number input（值 + 宽）。
跑法：~/workspace/brainrun/.venv/bin/python tests/pr8/probe-followups.py
"""
import json

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4174/"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=[
        "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"])
    pg = b.new_page(viewport={"width": 978, "height": 800})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE, wait_until="domcontentloaded")
    pg.get_by_role("button", name="PLAY — 运行中", exact=True).wait_for(timeout=90000)
    # 1. TIME：直接读 DOM，不走 has_text locator
    time_info = pg.evaluate("""() => {
      const el = document.querySelector('.bottombar .mono');
      if (!el) return {found: false};
      const r = el.getBoundingClientRect();
      return {found: true, text: el.textContent.trim(),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width),
        visible: r.width > 0 && r.height > 0,
        fonts: document.fonts ? document.fonts.status : 'n/a'};
    }""")
    print("TIME@978:", json.dumps(time_info, ensure_ascii=False))
    pg.wait_for_timeout(3000)
    t2 = pg.evaluate("() => (document.querySelector('.bottombar .mono')||{}).textContent")
    print("TIME@978 +3s:", (t2 or "").strip())
    # 2. HEAD EEG 开→关→再点
    pg.get_by_role("button", name="HEAD EEG", exact=True).click(timeout=30000)
    pg.locator('[role="dialog"]').first.wait_for(timeout=30000)
    pg.wait_for_timeout(1000)
    pg.locator('[role="dialog"]').get_by_role("button", name="关闭", exact=True).first.click(timeout=10000)
    pg.wait_for_timeout(1500)
    try:
        pg.get_by_role("button", name="HEAD EEG", exact=True).click(timeout=30000)
        pg.locator('[role="dialog"]').first.wait_for(timeout=30000)
        print("HEAD EEG reopen@978: ok")
        # 顺手进 LocalBEM
        pg.get_by_role("button", name="打开本地真实 MRI BEM", exact=True).click(timeout=30000)
        pg.wait_for_timeout(1500)
        dlg = pg.locator('[role="dialog"]').first
        print("LocalBEM@978 dialog:", pg.evaluate(
            "() => { const d = document.querySelector('[role=dialog]'); const r = d.getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height)}; }"))
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(500)
        pg.locator('[role="dialog"]').get_by_role("button", name="关闭", exact=True).first.click(timeout=10000)
        pg.wait_for_timeout(500)
    except Exception as e:
        print("HEAD EEG reopen@978 FAILED:", str(e)[:300])
    # 3. 源定位 number inputs
    pg.get_by_role("button", name="EEG 分析", exact=True).click(timeout=30000)
    pg.locator('[role="dialog"]').first.wait_for(timeout=30000)
    pg.wait_for_timeout(1000)
    pg.get_by_role("button", name="运行实验", exact=True).click(timeout=30000)
    pg.get_by_test_id("eeg-waveform").wait_for(timeout=60000)
    pg.get_by_role("tab", name="源定位", exact=True).click(timeout=30000)
    pg.wait_for_timeout(1500)
    inputs = pg.evaluate("""() => [...document.querySelectorAll('[role=dialog] input[type=number]')].map(el => ({
      value: el.value, w: el.clientWidth, sw: el.scrollWidth,
      dx: el.scrollWidth - el.clientWidth,
      style_w: el.style.width || '',
      label: (el.closest('div')||{}).textContent?.slice(0,40) || ''
    }))""")
    print("inverse number inputs:", json.dumps(inputs, ensure_ascii=False, indent=1))
    print("page errors:", errs)
    b.close()

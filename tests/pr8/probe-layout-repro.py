#!/usr/bin/env python3
"""PR8-LAYOUT 复现探针（只读量测，不改产品代码）。

跑法：~/workspace/brainrun/.venv/bin/python tests/pr8/probe-layout-repro.py
前置：vite preview 在 127.0.0.1:4173 服务 dist。
输出：tests/pr8/layout-repro.json（修复前后对照用）。

量测：右列总高/各 panel 高/滚动到尽头时 CONNECTION 各部分视口位置、
第二屏空地、390px 顶栏与侧栏、弹窗尺寸与关闭按钮可见性、L-01/L-02。
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "tests", "pr8", "layout-repro.json")

MEASURE_MAIN = r"""
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const q = (s) => document.querySelector(s);
  const r = (el) => el ? {x: Math.round(el.getBoundingClientRect().x),
    y: Math.round(el.getBoundingClientRect().y),
    w: Math.round(el.getBoundingClientRect().width),
    h: Math.round(el.getBoundingClientRect().height),
    top: Math.round(el.getBoundingClientRect().top),
    bottom: Math.round(el.getBoundingClientRect().bottom)} : null;
  const panels = q('.panels');
  const kids = panels ? [...panels.children].map(el => ({
    title: (el.querySelector('.screen-title')||{}).textContent || el.className,
    cls: el.className, h: el.offsetHeight, scrollH: el.scrollHeight,
    rect: r(el)})) : [];
  const region = q('.region-panel');
  const conn = {};
  if (region) {
    const find = (txt) => [...region.querySelectorAll('*')].find(
      el => el.children.length === 0 && (el.textContent||'').includes(txt));
    // CONNECTION 各关键元素：选区名、坐标行、E/I/P 行、权重滑杆、BIAS 开关
    const slider = region.querySelector('.weight-list input[type=range], .edge-slider');
    const biasBtn = [...region.querySelectorAll('button')].find(
      b => (b.textContent||'').includes('偏置'));
    const biasTitle = [...region.querySelectorAll('.conn-title')].find(
      el => (el.textContent||'').includes('BIAS'));
    const connTitle = [...region.querySelectorAll('.conn-title')].find(
      el => (el.textContent||'').includes('主要连接'));
    conn.regionRect = r(region);
    conn.regionScrollH = region.scrollHeight;
    conn.regionClientH = region.clientHeight;
    conn.regionScrollTopMax = region.scrollHeight - region.clientHeight;
    conn.connTitle = r(connTitle);
    conn.firstSlider = r(slider);
    conn.biasTitle = r(biasTitle);
    conn.biasBtn = r(biasBtn);
  }
  // 第二屏空地：页面滚动到底后，stage 区域下方左列取点
  const stage = q('.stage');
  return { vw, vh,
    docScrollW: document.documentElement.scrollWidth - vw,
    docScrollH: document.documentElement.scrollHeight,
    docScrollHMinusVh: document.documentElement.scrollHeight - vh,
    bodyScrollH: document.body.scrollHeight,
    appH: q('.app') ? q('.app').offsetHeight : null,
    mainRect: r(q('.main')),
    stageRect: r(stage),
    panelsRect: r(panels),
    panelsScrollH: panels ? panels.scrollHeight : null,
    panelsClientH: panels ? panels.clientHeight : null,
    panelsScrollTop: panels ? panels.scrollTop : null,
    panelsOverflowY: panels ? getComputedStyle(panels).overflowY : null,
    topbarH: q('.topbar') ? q('.topbar').offsetHeight : null,
    topbarRect: r(q('.topbar')),
    bottombarRect: r(q('.bottombar')),
    kids, conn };
}
"""

SCROLL_END = r"""
() => {
  const panels = document.querySelector('.panels');
  const region = document.querySelector('.region-panel');
  if (panels) panels.scrollTop = panels.scrollHeight;
  if (region) region.scrollTop = region.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
  return { panelsScrollTop: panels ? panels.scrollTop : null,
    panelsMax: panels ? panels.scrollHeight - panels.clientHeight : null,
    regionScrollTop: region ? region.scrollTop : null,
    regionMax: region ? region.scrollHeight - region.clientHeight : null,
    winScrollY: window.scrollY,
    docScrollH: document.documentElement.scrollHeight };
}
"""

AFTER_SCROLL = r"""
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const q = (s) => document.querySelector(s);
  const r = (el) => el ? {x: Math.round(el.getBoundingClientRect().x),
    y: Math.round(el.getBoundingClientRect().y),
    w: Math.round(el.getBoundingClientRect().width),
    h: Math.round(el.getBoundingClientRect().height),
    top: Math.round(el.getBoundingClientRect().top),
    bottom: Math.round(el.getBoundingClientRect().bottom)} : null;
  const region = q('.region-panel');
  const out = { vh };
  if (region) {
    const slider = region.querySelector('.weight-list input[type=range], .edge-slider');
    const biasBtn = [...region.querySelectorAll('button')].find(
      b => (b.textContent||'').includes('偏置'));
    const biasTitle = [...region.querySelectorAll('.conn-title')].find(
      el => (el.textContent||'').includes('BIAS'));
    const connTitle = [...region.querySelectorAll('.conn-title')].find(
      el => (el.textContent||'').includes('主要连接'));
    const regionName = region.querySelector('.region-name');
    const facts = region.querySelector('.region-facts');
    const vis = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const inView = b.bottom > 0 && b.top < vh;
      return { ...r(el), inViewport: inView,
        visiblePart: Math.max(0, Math.min(b.bottom, vh) - Math.max(b.top, 0)) };
    };
    out.regionName = vis(regionName);
    out.facts = vis(facts);
    out.connTitle = vis(connTitle);
    out.firstSlider = vis(slider);
    out.biasTitle = vis(biasTitle);
    out.biasBtn = vis(biasBtn);
    // BIAS 开关可点吗（元素中心点命中检测）
    if (biasBtn) {
      const b = biasBtn.getBoundingClientRect();
      const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      out.biasBtnHit = el === biasBtn || (el ? el.contains(biasBtn) || biasBtn.contains(el) : false);
      out.biasBtnHitTag = el ? el.tagName + '.' + String(el.className).split(' ')[0] : null;
    }
    if (slider) {
      const b = slider.getBoundingClientRect();
      const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      out.sliderHit = el === slider || (el ? slider.contains(el) : false);
    }
  }
  // 左列第二屏：stage 底部以下、x=左列中点的元素是什么
  const stage = q('.stage');
  if (stage) {
    const sb = stage.getBoundingClientRect();
    const y = Math.min(sb.bottom + 100, vh - 10);
    const el = document.elementFromPoint(Math.round(sb.width / 2), Math.round(y));
    out.belowStageProbe = { y: Math.round(y), stageBottom: Math.round(sb.bottom),
      hit: el ? el.tagName + '.' + String(el.className).split(' ')[0] : null,
      hitText: (el && el.textContent || '').trim().slice(0, 40) };
  }
  return out;
}
"""

MEASURE_MODAL = r"""
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const dlg = document.querySelector('.modal-backdrop .modal');
  if (!dlg) return { open: false };
  const b = dlg.getBoundingClientRect();
  const btns = [...dlg.querySelectorAll('button')].filter(
    x => /关闭|知道了|close/i.test(x.textContent || ''));
  const info = btns.map(x => {
    const r = x.getBoundingClientRect();
    return { text: (x.textContent || '').trim().slice(0, 12),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      inViewport: r.bottom <= vh + 1 && r.top >= -1 };
  });
  const clipped = [];
  dlg.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
    const dx = el.scrollWidth - el.clientWidth;
    if (dx > 2 && el.children.length <= 3) {
      clipped.push({ el: el.tagName + '.' + String(el.className).split(' ')[0] +
        ' :: ' + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50),
        dx, overflowX: cs.overflowX });
    }
  });
  const drill = [];
  clipped.slice(0, 3).forEach((c) => {});
  dlg.querySelectorAll('div').forEach((el) => {
    const dx = el.scrollWidth - el.clientWidth;
    if (dx > 0 && el.children.length > 0) {
      drill.push({ el: el.tagName + '.' + String(el.className).split(' ')[0] +
        ' :: ' + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        dx, clientW: el.clientWidth, scrollW: el.scrollWidth,
        kids: [...el.children].slice(0, 8).map(k => ({
          tag: k.tagName + '.' + String(k.className).split(' ')[0],
          sw: k.scrollWidth, cw: k.clientWidth,
          w: Math.round(k.getBoundingClientRect().width),
          txt: (k.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) })) });
    }
  });
  const overhang = [];
  dlg.querySelectorAll('div').forEach((el) => {
    if (el.scrollWidth - el.clientWidth <= 0) return;
    const pr = el.getBoundingClientRect();
    [...el.querySelectorAll('*')].forEach((k) => {
      const kr = k.getBoundingClientRect();
      const over = Math.round(kr.right - pr.right);
      if (over > 0) overhang.push({ parent: el.tagName + '.' + String(el.className).split(' ')[0],
        kid: k.tagName + '.' + String(k.className).split(' ')[0] +
          ' :: ' + (k.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        over, kidW: Math.round(kr.width) });
    });
  });
  return { open: true, vw, vh, drill: drill.slice(0, 6), overhang: overhang.slice(0, 8),
    modal: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width),
      h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom),
      exceedsVh: b.height > vh, bottomBeyondVh: Math.round(b.bottom - vh) },
    closeBtns: info, clipped: clipped.slice(0, 10) };
}
"""

MEASURE_L02 = r"""
() => {
  const inputs = [...document.querySelectorAll('input[type=number]')].filter(
    el => { const v = el.value || ''; return v.startsWith('0.111'); });
  return inputs.map(el => {
    const b = el.getBoundingClientRect();
    return { value: el.value, clientW: el.clientWidth, scrollW: el.scrollWidth,
      dx: el.scrollWidth - el.clientWidth,
      styleW: el.style.width, rectW: Math.round(b.width),
      visibleText: el.value.slice(0, 12) };
  });
}
"""


def click_chip(page, text):
    page.evaluate("""(t) => {
      const b = [...document.querySelectorAll('.topbar .chip')].find(
        x => (x.textContent || '').includes(t));
      if (!b) throw new Error('chip not found: ' + t);
      b.click();
    }""", text)


def wait_sim_ready(page):
    page.wait_for_timeout(4000)


def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--disable-gpu"])
        # ---- 1920x1080 主界面 ----
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until="domcontentloaded")
        wait_sim_ready(page)
        # 默认 showMore=false；先量默认，再展开“更多”
        m_default = page.evaluate(MEASURE_MAIN)
        click_chip(page, "更多")
        page.wait_for_timeout(1200)
        # 选一个脑区，让 REGION 面板有 CONNECTION 内容（link-smoke 同款：
        # pulse(40) 后点 RESPONSE 里的响应行；画布 locator 点击在持续重绘下不稳定）
        try:
            page.evaluate("window.__brainSim.pulse(40)")
            page.wait_for_timeout(3000)
            page.evaluate("""() => {
              const b = document.querySelector(".resp-row[data-node='40']");
              if (b) b.click();
            }""")
            page.wait_for_timeout(1200)
        except Exception as e:
            results["select_region_error"] = str(e)
        m_more = page.evaluate(MEASURE_MAIN)
        sc = page.evaluate(SCROLL_END)
        page.wait_for_timeout(500)
        m_scrolled = page.evaluate(AFTER_SCROLL)
        results["1920"] = {"default": m_default, "more": m_more,
                           "scroll": sc, "after_scroll": m_scrolled,
                           "page_errors": errors}
        # ---- 模型信息弹窗 ----
        click_chip(page, "模型信息")
        page.wait_for_timeout(800)
        results["1920_model_modal"] = page.evaluate(MEASURE_MODAL)
        page.evaluate("""() => {
          const b = [...document.querySelectorAll('.modal-backdrop .modal button')].find(
            x => /知道了/.test(x.textContent || ''));
          if (b) b.click();
        }""")
        page.wait_for_timeout(500)
        # ---- HeadSphereLab 弹窗 ----
        click_chip(page, "HEAD EEG")
        page.wait_for_timeout(2500)
        results["1920_headsphere"] = page.evaluate(MEASURE_MODAL)
        page.evaluate("""() => {
          const b = [...document.querySelectorAll('.modal-backdrop .modal button')].find(
            x => (x.textContent || '').trim() === '关闭');
          if (b) b.click();
        }""")
        page.wait_for_timeout(500)
        # ---- DipoleLab 弹窗 ----
        click_chip(page, "DIPOLE LAB")
        page.wait_for_timeout(2000)
        results["1920_dipole"] = page.evaluate(MEASURE_MODAL)
        page.evaluate("""() => {
          const b = [...document.querySelectorAll('.modal-backdrop .modal button')].find(
            x => (x.textContent || '').trim() === '关闭');
          if (b) b.click();
        }""")
        page.wait_for_timeout(500)
        # ---- EEG 分析 → 源定位 L-02 ----
        click_chip(page, "EEG 分析")
        page.wait_for_timeout(2000)
        try:
            page.evaluate("""() => {
              const b = [...document.querySelectorAll('.eeg-tabs button')].find(
                x => (x.textContent || '').includes('源定位'));
              if (!b) throw new Error('源定位 tab not found');
              b.click();
            }""")
            page.wait_for_timeout(1000)
        except Exception as e:
            results["eeg_tab_error"] = str(e)
        results["1920_eeg_modal"] = page.evaluate(MEASURE_MODAL)
        results["L02"] = page.evaluate(MEASURE_L02)
        page.evaluate("""() => {
          const b = [...document.querySelectorAll('.modal-backdrop .modal button')].find(
            x => (x.textContent || '').trim() === '关闭');
          if (b) b.click();
        }""")
        page.wait_for_timeout(500)
        page.close()

        # ---- 978x800 主界面 ----
        page = browser.new_page(viewport={"width": 978, "height": 800})
        page.goto(BASE, wait_until="domcontentloaded")
        wait_sim_ready(page)
        click_chip(page, "更多")
        page.wait_for_timeout(1200)
        try:
            page.evaluate("window.__brainSim.pulse(40)")
            page.wait_for_timeout(3000)
            page.evaluate("""() => {
              const b = document.querySelector(".resp-row[data-node='40']");
              if (b) b.click();
            }""")
            page.wait_for_timeout(1200)
        except Exception as e:
            results["select_region_error_978"] = str(e)
        m978 = page.evaluate(MEASURE_MAIN)
        sc978 = page.evaluate(SCROLL_END)
        page.wait_for_timeout(500)
        m978s = page.evaluate(AFTER_SCROLL)
        results["978"] = {"more": m978, "scroll": sc978, "after_scroll": m978s}
        page.close()

        # ---- 390x844 手机 ----
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.goto(BASE, wait_until="domcontentloaded")
        wait_sim_ready(page)
        m390 = page.evaluate(MEASURE_MAIN)
        # 顶栏 chip 行数：按 y 分组
        chips = page.evaluate("""() => {
          const cs = [...document.querySelectorAll('.topbar .chip')].map(c => {
            const r = c.getBoundingClientRect();
            return { t: (c.textContent||'').trim().slice(0,14), y: Math.round(r.y),
              h: Math.round(r.height), w: Math.round(r.width), right: Math.round(r.right) };
          });
          const rows = [...new Set(cs.map(c => c.y))].length;
          return { rows, vw: window.innerWidth, docOverflowX: document.documentElement.scrollWidth - window.innerWidth,
            topbarH: document.querySelector('.topbar').offsetHeight, chips: cs };
        }""")
        results["390"] = {"main": m390, "topbar": chips}
        page.close()
        browser.close()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("wrote", OUT)
    print(json.dumps({
        "1920_panelsScrollH": results["1920"]["more"]["panelsScrollH"],
        "1920_panelsClientH": results["1920"]["more"]["panelsClientH"],
        "1920_regionClientH": results["1920"]["more"]["conn"].get("regionClientH"),
        "1920_after_scroll": results["1920"]["after_scroll"],
        "1920_docScrollH": results["1920"]["more"]["docScrollH"],
        "978_panelsScrollH": results["978"]["more"]["panelsScrollH"],
        "978_panelsClientH": results["978"]["more"]["panelsClientH"],
        "978_after_scroll": results["978"]["after_scroll"],
        "390_topbar": results["390"]["topbar"],
        "model_modal": results.get("1920_model_modal"),
        "headsphere": results.get("1920_headsphere"),
        "dipole": results.get("1920_dipole"),
        "L02": results.get("L02"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

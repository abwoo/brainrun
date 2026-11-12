#!/usr/bin/env python3
"""PR8-LAYOUT 布局断言测试（Playwright，对预览 dist 做黑盒断言）。

跑法：~/workspace/brainrun/.venv/bin/python tests/pr8/layout-assert.py
前置：vite preview 在 127.0.0.1:4173 服务 dist（改完产品代码后须先 npm run build 再跑）。
通过条件：全部检查通过，exit=0；任一失败 exit=1。

覆盖（每项对应本轮修复项，修前失败、修后通过）：
  LAY-1  右列：文档不滚动（列内滚动兜底）、REGION 面板不再被压扁、
         滚到底后 CONNECTION（权重滑杆、BIAS 开关）可见且可点、LIVE 顶栏置顶。
  LAY-2  第二屏空地：1920 下文档高度等于视口高度、舞台底部在视口内。
  LAY-3  手机断点（390px）：顶栏单行横向滚动、顶栏高度 <= 60px、
         无横向溢出、舞台全宽可用。
  LAY-4  弹窗：模型信息“知道了”初次可见；七个实验台弹窗不出视口、
         关闭按钮初次可见、内部可滚。
  LAY-5  L-01：HeadSphereLab / DipoleLab 控制区横向溢出为 0。
  LAY-6  L-02：源定位 λ² 输入框显示 0.111、内容不溢出。
  LAY-7  全程零页面报错、零控制台报错；各实验台无横向溢出。
  LAY-8  HEAD / DIPOLE 读数区有“最大电极”一行（尖峰时电位读数可跟）。
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "tests", "pr8", "layout-assert.json")

CHECKS = []


def check(name, ok, detail=""):
    CHECKS.append({"name": name, "ok": bool(ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else "FAIL ") + name + ((" — " + str(detail)[:200]) if detail else ""))


def js_click(page, selector, text):
    """在 selector 范围内按文本点按钮（JS click；逐帧重渲染的元素
    Playwright 严格点击等不到 stable，用 JS 点击是测试手段，不动产品代码）。"""
    return page.evaluate(
        """([sel, t]) => {
          const els = [...document.querySelectorAll(sel)];
          const b = els.find(x => (x.textContent || '').includes(t));
          if (!b) return 'NOT-FOUND:' + t;
          b.click(); return 'OK';
        }""",
        [selector, text])


def wait_sim_ready(page, timeout_ms=30000):
    page.wait_for_function(
        "() => window.__brainSim && window.__brainSim.isReady()",
        timeout=timeout_ms)
    page.wait_for_timeout(800)


def select_node_40(page):
    """选 lAMYG #40：pulse 后点 RESPONSE 里的响应行（link-smoke 同款）。"""
    page.evaluate("window.__brainSim.pulse(40)")
    page.wait_for_timeout(3000)
    r = page.evaluate("""() => {
      const b = document.querySelector(".resp-row[data-node='40']");
      if (!b) return 'NO-ROW';
      b.click(); return 'OK';
    }""")
    page.wait_for_timeout(800)
    return r


def measure_main(page):
    return page.evaluate(r"""
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
  const region = q('.region-panel');
  const live = panels ? panels.querySelector('.panel') : null;
  return { vw, vh,
    docScrollW: document.documentElement.scrollWidth - vw,
    docScrollH: document.documentElement.scrollHeight,
    docOverflowY: document.documentElement.scrollHeight - vh,
    appOverflowY: q('.app') ? getComputedStyle(q('.app')).overflowY : null,
    panelsScrollH: panels ? panels.scrollHeight : null,
    panelsClientH: panels ? panels.clientHeight : null,
    panelsOverflowY: panels ? getComputedStyle(panels).overflowY : null,
    panelsRect: r(panels),
    regionH: region ? region.offsetHeight : null,
    regionScrollH: region ? region.scrollHeight : null,
    stageRect: r(q('.stage')),
    topbarH: q('.topbar') ? q('.topbar').offsetHeight : null,
    liveRect: r(live) };
}
""")


def measure_connection_after_scroll(page):
    return page.evaluate(r"""
() => {
  const vh = window.innerHeight;
  const panels = document.querySelector('.panels');
  if (panels) panels.scrollTop = panels.scrollHeight;
  const region = document.querySelector('.region-panel');
  const out = { vh, panelsScrollTop: panels ? panels.scrollTop : null };
  const vis = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom),
      inViewport: b.bottom > 0 && b.top < vh,
      fullyIn: b.top >= 0 && b.bottom <= vh };
  };
  const hit = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return t === el || (t ? el.contains(t) : false);
  };
  if (region) {
    const slider = region.querySelector('.weight-list input[type=range], .edge-slider');
    const biasBtn = [...region.querySelectorAll('button')].find(
      b => (b.textContent || '').includes('偏置'));
    const biasTitle = [...region.querySelectorAll('.conn-title')].find(
      el => (el.textContent || '').includes('BIAS'));
    const connTitle = [...region.querySelectorAll('.conn-title')].find(
      el => (el.textContent || '').includes('主要连接'));
    out.connTitle = vis(connTitle);
    out.firstSlider = vis(slider);
    out.sliderHit = hit(slider);
    out.biasTitle = vis(biasTitle);
    out.biasBtn = vis(biasBtn);
    out.biasBtnHit = hit(biasBtn);
    const live = document.querySelector('.panels .panel');
    out.liveTop = live ? Math.round(live.getBoundingClientRect().top) : null;
    out.liveTitleVisible = (() => {
      if (!live) return false;
      const b = live.getBoundingClientRect();
      return b.bottom > 0 && b.top < vh;
    })();
  }
  return out;
}
""")


def measure_modal(page):
    return page.evaluate(r"""
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const dlg = document.querySelector('.modal-backdrop .modal');
  if (!dlg) return { open: false };
  const b = dlg.getBoundingClientRect();
  const closeBtn = [...dlg.querySelectorAll('button')].find(
    x => (x.textContent || '').trim() === '关闭' || /知道了/.test(x.textContent || ''));
  const cb = closeBtn ? closeBtn.getBoundingClientRect() : null;
  let maxDx = 0, worst = null;
  dlg.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
    const dx = el.scrollWidth - el.clientWidth;
    if (dx > maxDx) { maxDx = dx;
      worst = el.tagName + '.' + String(el.className).split(' ')[0] +
        ' :: ' + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40); }
  });
  return { open: true, vw, vh,
    modal: { w: Math.round(b.width), h: Math.round(b.height),
      top: Math.round(b.top), bottom: Math.round(b.bottom),
      right: Math.round(b.right), left: Math.round(b.left) },
    fitsViewport: b.bottom <= vh + 1 && b.right <= vw + 1 && b.top >= -1 && b.left >= -1,
    closeBtn: cb ? { top: Math.round(cb.top), bottom: Math.round(cb.bottom),
      inViewport: cb.bottom <= vh + 1 && cb.top >= -1,
      text: (closeBtn.textContent || '').trim() } : null,
    maxDx, worst,
    modalScrollH: dlg.scrollHeight, modalClientH: dlg.clientHeight };
}
""")


def close_modal(page):
    page.evaluate("""() => {
      const b = [...document.querySelectorAll('.modal-backdrop .modal button')].find(
        x => (x.textContent || '').trim() === '关闭' || /知道了/.test(x.textContent || ''));
      if (b) b.click();
    }""")
    page.wait_for_timeout(600)


def main():
    results = {"checks": CHECKS}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--disable-gpu"])
        errors = []

        # ---------- 1920x1080 ----------
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console." + m.type + ": " + m.text)
                if m.type == "error" else None)
        page.goto(BASE, wait_until="domcontentloaded")
        wait_sim_ready(page)
        r = js_click(page, ".topbar .chip", "更多")
        page.wait_for_timeout(1000)
        sel = select_node_40(page)
        m = measure_main(page)
        results["1920_main"] = m
        check("LAY-1a 文档不滚动（右列溢出由列内滚动兜底）",
              m["docOverflowY"] == 0,
              f"docScrollH-vh={m['docOverflowY']} docScrollH={m['docScrollH']}")
        check("LAY-1b 右列是内部滚动容器",
              m["panelsOverflowY"] == "auto" and m["panelsScrollH"] > m["panelsClientH"],
              f"overflowY={m['panelsOverflowY']} scrollH={m['panelsScrollH']} clientH={m['panelsClientH']}")
        check("LAY-1c REGION 面板不再被压扁",
              (m["regionH"] or 0) > 400,
              f"regionH={m['regionH']} regionScrollH={m['regionScrollH']} select={sel}")
        c = measure_connection_after_scroll(page)
        results["1920_connection"] = c
        check("LAY-1d CONNECTION 滚到底后可见且可点",
              bool(c.get("firstSlider") and c["firstSlider"]["inViewport"]
                   and c.get("sliderHit") and c.get("biasBtn")
                   and c["biasBtn"]["inViewport"] and c.get("biasBtnHit")),
              f"slider={c.get('firstSlider')} hit={c.get('sliderHit')} "
              f"bias={c.get('biasBtn')} hit={c.get('biasBtnHit')}")
        check("LAY-1e 滚到底后 LIVE ACTIVITY 仍置顶可见",
              bool(c.get("liveTitleVisible")),
              f"liveTop={c.get('liveTop')}")
        check("LAY-2 舞台底部在视口内、无第二屏空地",
              m["stageRect"] is not None and m["stageRect"]["bottom"] <= m["vh"] + 1
              and m["docOverflowY"] == 0,
              f"stageBottom={m['stageRect']['bottom'] if m['stageRect'] else None} vh={m['vh']}")
        check("LAY-3a 主界面无横向溢出",
              m["docScrollW"] == 0, f"docOverflowX={m['docScrollW']}")

        # 模型信息弹窗
        js_click(page, ".topbar .chip", "模型信息")
        page.wait_for_timeout(800)
        mm = measure_modal(page)
        results["1920_model_modal"] = mm
        check("LAY-4a 模型信息弹窗不出视口、“知道了”初次可见",
              bool(mm["open"] and mm["fitsViewport"] and mm["closeBtn"]
                   and mm["closeBtn"]["inViewport"]),
              f"modal={mm.get('modal')} closeBtn={mm.get('closeBtn')}")
        close_modal(page)

        # 七个实验台：HEAD EEG / DIPOLE LAB / EEG 分析 / 细胞实验 / 刺激实验 / 对照实验
        # + LocalBEM（经 HEAD EEG 内“进阶”按钮打开）
        for chip in ["HEAD EEG", "DIPOLE LAB", "EEG 分析", "细胞实验", "刺激实验", "对照实验"]:
            js_click(page, ".topbar .chip", chip)
            page.wait_for_timeout(2500)
            lm = measure_modal(page)
            results["lab_" + chip] = lm
            check(f"LAY-4b {chip} 弹窗不出视口、关闭按钮初次可见、无横向溢出",
                  bool(lm["open"] and lm["fitsViewport"] and lm["closeBtn"]
                       and lm["closeBtn"]["inViewport"] and lm["maxDx"] == 0),
                  f"modal={lm.get('modal')} close={lm.get('closeBtn')} maxDx={lm.get('maxDx')} worst={lm.get('worst')}")
            # L-01 专查：HEAD EEG 与 DIPOLE LAB 控制区
            if chip in ("HEAD EEG", "DIPOLE LAB"):
                check(f"LAY-5 L-01 {chip} 控制区横向溢出为 0",
                      lm["maxDx"] == 0,
                      f"maxDx={lm['maxDx']} worst={lm.get('worst')}")
            # LAY-8 最大电极读数（HEAD EEG 的读数依赖球形 fixture 异步加载，
            # 等“最大电极”出现再断言，最长 15s；不是放宽门槛，是等异步资源）
            if chip in ("HEAD EEG", "DIPOLE LAB"):
                if chip == "HEAD EEG":
                    try:
                        page.wait_for_function(
                            "() => document.querySelector('.modal-backdrop .modal')"
                            " && document.querySelector('.modal-backdrop .modal')"
                            ".textContent.includes('最大电极')",
                            timeout=15000)
                    except Exception:
                        pass
                has_max = page.evaluate(
                    "() => document.querySelector('.modal-backdrop .modal').textContent.includes('最大电极')")
                check(f"LAY-8 {chip} 读数区有“最大电极”一行", has_max)
            # LocalBEM：从 HEAD EEG 内打开
            if chip == "HEAD EEG":
                r2 = js_click(page, ".modal-backdrop .modal button", "进阶")
                page.wait_for_timeout(1500)
                lb = measure_modal(page)
                results["lab_LocalBEM"] = lb
                check("LAY-4b LocalBEM 弹窗不出视口、关闭按钮初次可见、无横向溢出",
                      bool(lb["open"] and lb["fitsViewport"] and lb["closeBtn"]
                           and lb["closeBtn"]["inViewport"] and lb["maxDx"] == 0),
                      f"modal={lb.get('modal')} close={lb.get('closeBtn')} maxDx={lb.get('maxDx')}")
                close_modal(page)
                page.wait_for_timeout(400)
                continue
            # L-02：EEG 分析 → 源定位
            if chip == "EEG 分析":
                js_click(page, ".eeg-tabs button", "源定位")
                page.wait_for_timeout(1200)
                l02 = page.evaluate("""() => {
                  const inp = [...document.querySelectorAll('.modal-backdrop input[type=number]')]
                    .find(el => (el.value || '').startsWith('0.111'));
                  if (!inp) return { found: false };
                  return { found: true, value: inp.value,
                    clientW: inp.clientWidth, scrollW: inp.scrollWidth,
                    dx: inp.scrollWidth - inp.clientWidth };
                }""")
                results["L02"] = l02
                check("LAY-6 L-02 λ² 输入框显示 0.111、内容不溢出",
                      bool(l02.get("found") and l02["value"] == "0.111"
                           and l02["dx"] == 0),
                      f"{l02}")
            close_modal(page)
        check("LAY-7a 1920 全程零页面报错 / 零控制台报错", len(errors) == 0,
              "; ".join(errors[:3]) if errors else "0 errors")
        page.close()

        # ---------- 978x800 ----------
        page = browser.new_page(viewport={"width": 978, "height": 800})
        page.on("pageerror", lambda e: errors.append("978 pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("978 console." + m.type + ": " + m.text)
                if m.type == "error" else None)
        page.goto(BASE, wait_until="domcontentloaded")
        wait_sim_ready(page)
        js_click(page, ".topbar .chip", "更多")
        page.wait_for_timeout(1000)
        select_node_40(page)
        m978 = measure_main(page)
        results["978_main"] = m978
        check("LAY-3b 978 无横向溢出", m978["docScrollW"] == 0,
              f"docOverflowX={m978['docScrollW']}")
        # 978 下纵向长页是既定布局（列式堆叠），CONNECTION 靠文档滚动到达
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(500)
        c978 = page.evaluate("""() => {
          const vh = window.innerHeight;
          const region = document.querySelector('.region-panel');
          if (!region) return { none: true };
          const biasBtn = [...region.querySelectorAll('button')].find(
            b => (b.textContent || '').includes('偏置'));
          const slider = region.querySelector('.weight-list input[type=range]');
          const vis = (el) => {
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { inViewport: b.bottom > 0 && b.top < vh };
          };
          const hit = (el) => {
            if (!el) return null;
            const b = el.getBoundingClientRect();
            const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return t === el || (t ? el.contains(t) : false);
          };
          return { bias: vis(biasBtn), biasHit: hit(biasBtn),
            slider: vis(slider), sliderHit: hit(slider) };
        }""")
        results["978_connection"] = c978
        check("LAY-9 978 滚到底后 CONNECTION 可见且可点",
              bool(c978.get("bias") and c978["bias"]["inViewport"] and c978.get("biasHit")),
              f"{c978}")
        page.close()

        # ---------- 390x844 手机 ----------
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda e: errors.append("390 pageerror: " + str(e)))
        page.goto(BASE, wait_until="domcontentloaded")
        wait_sim_ready(page)
        m390 = page.evaluate("""() => {
          const vw = window.innerWidth, vh = window.innerHeight;
          const q = (s) => document.querySelector(s);
          const chips = [...document.querySelectorAll('.topbar .chip')].map(c => {
            const r = c.getBoundingClientRect();
            return { y: Math.round(r.y), h: Math.round(r.height) };
          });
          const rows = (() => {
            // 行按 y 聚类（容差 3px）：29px 与 30px 高的 chip 垂直居中后
            // y 差 0.5px，仍是同一行；不要用精确相等计数。
            const ys = chips.map(c => c.y).sort((a, b) => a - b);
            let n = 0, last = -1e9;
            for (const y of ys) { if (y - last > 3) { n++; last = y; } }
            return n;
          })();
          const stage = q('.stage');
          const sr = stage ? stage.getBoundingClientRect() : null;
          const panels = q('.panels');
          const pr = panels ? panels.getBoundingClientRect() : null;
          const cs = getComputedStyle(q('.topbar'));
          return { vw, vh, rows, topbarH: q('.topbar').offsetHeight,
            topbarFlexWrap: cs.flexWrap, topbarOverflowX: cs.overflowX,
            docOverflowX: document.documentElement.scrollWidth - vw,
            docScrollH: document.documentElement.scrollHeight,
            stageW: sr ? Math.round(sr.width) : null,
            stageH: sr ? Math.round(sr.height) : null,
            panelsW: pr ? Math.round(pr.width) : null };
        }""")
        results["390_main"] = m390
        check("LAY-3c 390 顶栏单行（横向滚动、不折多行）",
              m390["rows"] == 1 and m390["topbarH"] <= 60,
              f"rows={m390['rows']} topbarH={m390['topbarH']} wrap={m390['topbarFlexWrap']} overflowX={m390['topbarOverflowX']}")
        check("LAY-3d 390 无横向溢出、舞台全宽可用",
              m390["docOverflowX"] == 0 and (m390["stageW"] or 0) >= 340,
              f"docOverflowX={m390['docOverflowX']} stageW={m390['stageW']} panelsW={m390['panelsW']}")
        check("LAY-7b 978/390 全程零页面报错", len(errors) == 0,
              "; ".join(errors[:3]) if errors else "0 errors")
        page.close()
        browser.close()

    results["checks"] = CHECKS
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    n_pass = sum(1 for c in CHECKS if c["ok"])
    print(f"\n{n_pass}/{len(CHECKS)} passed — wrote {OUT}")
    if n_pass != len(CHECKS):
        print("FAILED:")
        for c in CHECKS:
            if not c["ok"]:
                print("  -", c["name"], "—", c["detail"])
        sys.exit(1)


if __name__ == "__main__":
    main()

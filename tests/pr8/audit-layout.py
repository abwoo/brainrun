#!/usr/bin/env python3
"""PR8-B 第一阶段：布局基线审计 + 无教程走查（只读审计，不改产品代码）.

跑法：~/workspace/brainrun/.venv/bin/python tests/pr8/audit-layout.py
前置：vite preview 在 127.0.0.1:4174 服务 dist（含 sphere fixture + wasm 构建产物）。
输出：tests/pr8/layout-shots/*.png + tests/pr8/layout-audit-raw.json
（人工复核后整理进 tests/pr8/layout-audit.md）。

覆盖：主界面（顶栏/3D 舞台/右侧面板）+ 7 个实验台
  DipoleLab / HeadSphereLab / LocalBEMLab（经 HEAD EEG 内按钮打开）/
  EegAnalysisLab（EEG/频谱/ERP/时频/地形/源定位 六 tab）/
  CellularLab / StimLab / ExperimentLab
× 1920x1080 与 978x800。
检查项：横向溢出、对话框出视口、顶栏 chip 相互遮挡、内容被裁（scrollWidth>clientWidth）、
文字截断（ellipsis 且内容溢出）。
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4174/"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.path.join(ROOT, "tests", "pr8", "layout-shots")
VIEWPORTS = [(1920, 1080), (978, 800)]
RESULTS = {"viewports": {}, "walkthrough": {}, "page_errors": [], "notes": []}

MEASURE_JS = r"""
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = { vw, vh, docOverflowX: document.documentElement.scrollWidth - vw,
    bodyOverflowX: document.body.scrollWidth - vw, clipped: [], truncated: [],
    topbar: null, dialog: null };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const label = (el) => {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const al = el.getAttribute && el.getAttribute('aria-label');
    const ty = el.getAttribute && el.getAttribute('type');
    return `${el.tagName.toLowerCase()}.${(el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().split(' ')[0]}${ty ? '[' + ty + ']' : ''}${al ? ' aria=' + al : ''} :: ${t}`;
  };
  // 内容被裁：元素自身内容宽于可视宽（排除 html/body 与故意横向滚动容器）
  document.querySelectorAll('*').forEach((el) => {
    if (!vis(el)) return;
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
    const dx = el.scrollWidth - el.clientWidth;
    if (dx > 2 && el.children.length <= 3) {
      out.clipped.push({ el: label(el), dx, overflowX: cs.overflowX });
    }
    if ((cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden' || cs.overflowX === 'hidden')
        && el.scrollWidth > el.clientWidth + 2 && el.children.length === 0) {
      out.truncated.push({ el: label(el), dx });
    }
  });
  out.clipped = out.clipped.slice(0, 25);
  out.truncated = out.truncated.slice(0, 25);
  // 顶栏：chip 是否相互遮挡 / 顶栏本身是否溢出
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const chips = [...topbar.querySelectorAll('.chip')].map((c) => {
      const r = c.getBoundingClientRect();
      return { text: (c.textContent || '').trim().slice(0, 20), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    });
    const overlaps = [];
    for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
      const a = chips[i], b = chips[j];
      if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom)
        overlaps.push([a.text, b.text]);
    }
    out.topbar = { scrollW: topbar.scrollWidth, clientW: topbar.clientWidth,
      overflow: topbar.scrollWidth - topbar.clientWidth, chips, overlaps,
      offRight: chips.filter((c) => c.right > vw + 1).map((c) => c.text) };
  }
  // 对话框是否出视口
  const dlg = document.querySelector('[role="dialog"]');
  if (dlg) {
    const r = dlg.getBoundingClientRect();
    out.dialog = { w: Math.round(r.width), h: Math.round(r.height),
      right: Math.round(r.right), bottom: Math.round(r.bottom),
      overW: Math.round(r.right - vw), overH: Math.round(r.bottom - vh),
      scrollW: dlg.scrollWidth, clientW: dlg.clientWidth };
  }
  return out;
}
"""


def measure(page, label):
    m = page.evaluate(MEASURE_JS)
    RESULTS.setdefault("measures", {})[label] = m
    print(f"  [{label}] overflowX={m['docOverflowX']} clipped={len(m['clipped'])} "
          f"truncated={len(m['truncated'])} "
          f"topbarOverflow={m['topbar']['overflow'] if m['topbar'] else '-'} "
          f"dialogOver={m['dialog']}")
    for c in m["clipped"][:8]:
        print(f"      CLIP {c['el']} +{c['dx']}px overflowX={c['overflowX']}")
    for t in m["truncated"][:8]:
        print(f"      TRUNC {t['el']} +{t['dx']}px")
    return m


def shot(page, name):
    """截图；超时重试一次，失败只记录不抛（慢机器 SwiftShader 下截图会超时）。"""
    p = os.path.join(SHOTS, name + ".png")
    for attempt in (1, 2):
        try:
            page.screenshot(path=p, timeout=20000, animations="disabled")
            return p
        except Exception as e:
            print(f"  WARN screenshot {name} attempt {attempt}: {str(e)[:150]}")
            if attempt == 2:
                RESULTS.setdefault("shot_failures", []).append(f"{name}: {str(e)[:200]}")
    return None


def wait_sim_ready(page):
    """等 PLAY chip 显示“运行中”（simReady 真就绪），记录耗时；
    再读背景活动段落，确认模式参数 τ/σ 是否仍为 “—”（就绪后仍为 — 即显示问题）。"""
    t0 = time.time()
    try:
        page.get_by_role("button", name="PLAY — 运行中", exact=True).wait_for(timeout=90000)
    except Exception as e:
        print("  WARN sim ready wait failed:", e)
    RESULTS.setdefault("sim_ready_s", round(time.time() - t0, 1))
    try:
        bg = page.locator("text=/相关时间/").first.text_content(timeout=10000)
        RESULTS.setdefault("bg_params_text", (bg or "").strip()[:200])
        print(f"  sim ready in {RESULTS['sim_ready_s']}s; bg params: {(bg or '').strip()[:120]}")
    except Exception as e:
        print("  bg params probe failed:", e)


def close_dialog(page):
    try:
        dlg = page.locator('[role="dialog"]').first
        btn = dlg.get_by_role("button", name="关闭", exact=True)
        if btn.count():
            btn.first.click(timeout=5000)
            page.wait_for_timeout(400)
            return True
    except Exception:
        pass
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    except Exception:
        pass
    return page.locator('[role="dialog"]').count() == 0


def audit_lab(page, w, h, btn_name, tag, extra=None):
    """打开一个实验台，截图 + 测量 + 关闭。返回是否成功打开；任何一步失败只记录、继续。"""
    try:
        page.get_by_role("button", name=btn_name, exact=True).click(timeout=30000)
    except Exception as e:
        print(f"  FAIL open {tag}: {e}")
        RESULTS.setdefault("open_failures", []).append(f"{w}x{h} {tag}: {e}")
        return False
    try:
        page.locator('[role="dialog"]').first.wait_for(timeout=30000)
    except Exception as e:
        print(f"  FAIL dialog {tag}: {e}")
        RESULTS.setdefault("open_failures", []).append(f"{w}x{h} {tag} dialog timeout")
        return False
    page.wait_for_timeout(1500)
    if extra:
        try:
            extra(page)
        except Exception as e:
            print(f"  WARN extra {tag}: {e}")
    shot(page, f"{w}x{h}_{tag}")
    try:
        measure(page, f"{w}x{h}_{tag}")
    except Exception as e:
        print(f"  WARN measure {tag}: {e}")
    ok = close_dialog(page)
    page.wait_for_timeout(300)
    return ok


def eeg_run(page):
    """在 EEG 分析实验台里跑一次实验（供六个 tab 共用同一份记录）。"""
    page.get_by_role("button", name="运行实验", exact=True).click(timeout=30000)
    page.get_by_test_id("eeg-waveform").wait_for(timeout=60000)
    page.wait_for_timeout(500)


def audit_eeg_tabs(page, w, h):
    page.get_by_role("button", name="EEG 分析", exact=True).click(timeout=30000)
    page.locator('[role="dialog"]').first.wait_for(timeout=30000)
    page.wait_for_timeout(1500)
    try:
        eeg_run(page)
        print("  EEG run ok")
    except Exception as e:
        print(f"  WARN EEG run failed: {e}")
        RESULTS.setdefault("open_failures", []).append(f"{w}x{h} EEG run: {e}")
    for tab in ["EEG", "频谱", "ERP", "时频", "地形", "源定位"]:
        try:
            page.get_by_role("tab", name=tab, exact=True).click(timeout=30000)
            page.wait_for_timeout(1200)
            if tab == "ERP":
                try:
                    btn = page.get_by_role("button", name="切分试次（MNE 口径）", exact=True)
                    if btn.is_enabled():
                        btn.click(timeout=5000)
                        page.get_by_text("ERP 波形（µV）").wait_for(timeout=30000)
                except Exception as e:
                    print(f"  WARN ERP epoch: {e}")
            shot(page, f"{w}x{h}_eeglab-{tab}")
            try:
                measure(page, f"{w}x{h}_eeglab-{tab}")
            except Exception as e:
                print(f"  WARN measure eeg {tab}: {e}")
        except Exception as e:
            print(f"  FAIL tab {tab}: {e}")
            RESULTS.setdefault("open_failures", []).append(f"{w}x{h} eeg tab {tab}: {e}")
    close_dialog(page)
    page.wait_for_timeout(300)


def audit_viewport(page, w, h):
    print(f"== viewport {w}x{h} ==")
    page.set_viewport_size({"width": w, "height": h})
    page.goto(BASE, wait_until="domcontentloaded")
    wait_sim_ready(page)
    shot(page, f"{w}x{h}_main")
    measure(page, f"{w}x{h}_main")
    # TIME 探针（仿真运行时测）→ 随后暂停仿真，减轻 SwiftShader 负载，
    # 避免第二轮出现的截图超时；暂停不影响各实验台的布局审计。
    try:
        time_el = page.locator("span.mono", has_text="TIME").first
        t1 = time_el.text_content(timeout=10000)
        page.wait_for_timeout(5000)
        t2 = time_el.text_content(timeout=10000)
        RESULTS.setdefault("time_probe", {})[f"{w}x{h}"] = {"t1": (t1 or "").strip(), "t2": (t2 or "").strip()}
        print(f"  TIME probe: {t1!r} -> {t2!r}")
    except Exception as e:
        print("  TIME probe unavailable:", e)
    try:
        page.get_by_role("button", name="PLAY — 运行中", exact=True).click(timeout=10000)
        page.get_by_role("button", name="PLAY — 已暂停", exact=True).wait_for(timeout=10000)
        print("  sim paused for layout audit")
    except Exception as e:
        print("  WARN pause failed (continuing unpaused):", e)
    audit_lab(page, w, h, "HEAD EEG", "headsphere")
    # LocalBEM：经 HEAD EEG 台内按钮打开
    try:
        page.get_by_role("button", name="HEAD EEG", exact=True).click(timeout=30000)
        page.locator('[role="dialog"]').first.wait_for(timeout=30000)
        page.wait_for_timeout(1000)
        page.get_by_role("button", name="打开本地真实 MRI BEM", exact=True).click(timeout=30000)
        page.wait_for_timeout(2000)
        shot(page, f"{w}x{h}_localbem")
        measure(page, f"{w}x{h}_localbem")
        close_dialog(page)
        page.wait_for_timeout(300)
        close_dialog(page)
    except Exception as e:
        print(f"  FAIL localbem path: {e}")
        RESULTS.setdefault("open_failures", []).append(f"{w}x{h} localbem: {e}")
        close_dialog(page)
    audit_lab(page, w, h, "DIPOLE LAB", "dipole")
    audit_eeg_tabs(page, w, h)
    audit_lab(page, w, h, "细胞实验", "cellular")
    audit_lab(page, w, h, "刺激实验", "stim")
    audit_lab(page, w, h, "对照实验", "experiment")


def walkthrough(page):
    """启发式无教程走查：假装第一次打开的非专业用户，做四项核心操作。"""
    print("== walkthrough (1920x1080, fresh, no tutorial) ==")
    w = {}
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(BASE, wait_until="domcontentloaded")
    wait_sim_ready(page)
    t0 = time.time()
    # 1. 选脑区：先悬停看提示，再点 3D 舞台中央。
    # 注意：页面有多块 canvas（LIVE ACTIVITY 图也是 canvas），必须取
    # section.stage 里的那块才是 3D 大脑；第一轮误点了 activity 图。
    canvas = page.locator("section.stage canvas").first
    canvas.wait_for(timeout=30000)
    box = canvas.bounding_box()
    w["canvas_box"] = box
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(1200)
    # 悬停提示是 BrainScene 里的浮动 div，文本含“点击刺激”
    tip = page.locator("section.stage >> text=/点击刺激/").first
    w["hover_tip_visible"] = tip.is_visible() if tip.count() else False
    w["hover_tip_text"] = (tip.text_content() or "").strip() if tip.count() else ""
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(1500)
    # 选中反馈：REGION / CONNECTION 面板是否出现“已选脑区/脑区名”
    region_panel = page.locator("text=/已选|REGION \\/ CONNECTION/").first
    w["select_feedback"] = region_panel.text_content(timeout=5000) if region_panel.count() else None
    w["t_select_s"] = round(time.time() - t0, 1)
    shot(page, "walkthrough_1_selected")
    # 2. 给刺激：同一次点击是否已触发响应（刺激响应面板出现基线文案）
    resp = page.locator("text=/基线：|尚未刺激/").first
    w["stim_feedback"] = resp.text_content(timeout=5000) if resp.count() else None
    w["t_stim_s"] = round(time.time() - t0, 1)
    shot(page, "walkthrough_2_stimulated")
    # 3. 看 EEG：找 EEG 入口
    t3 = time.time()
    eeg_btns = page.get_by_role("button", name="EEG 分析", exact=True)
    w["eeg_entry_found"] = eeg_btns.count() > 0
    w["eeg_entry_label"] = "EEG 分析（顶栏 chip）"
    if eeg_btns.count():
        eeg_btns.first.click(timeout=10000)
        page.locator('[role="dialog"]').first.wait_for(timeout=30000)
        page.wait_for_timeout(1000)
        try:
            eeg_run(page)
            w["eeg_waveform_visible"] = page.get_by_test_id("eeg-waveform").is_visible()
        except Exception as e:
            w["eeg_waveform_visible"] = False
            w["eeg_run_error"] = str(e)[:200]
        w["t_eeg_s"] = round(time.time() - t3, 1)
        shot(page, "walkthrough_3_eeg")
        close_dialog(page)
    # 4. 换模式：2.0 计划的 PLAY / WAVES / EEG / EXPLORE 模式切换是否存在。
    # 用全部按钮的可见文本逐一比对（exact 匹配）；顶栏 PLAY chip 的完整文本是
    # “PLAY — 运行中”，那是播放/暂停控制，不是模式切换，需区分记录。
    t4 = time.time()
    btn_texts = page.evaluate(
        "() => [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(Boolean)")
    w["all_button_texts"] = btn_texts
    w["mode_buttons_exact"] = {m: (m in btn_texts) for m in ["PLAY", "WAVES", "EEG", "EXPLORE"]}
    w["mode_switch_found"] = any(w["mode_buttons_exact"].values())
    w["play_chip_text"] = next((t for t in btn_texts if t.startswith("PLAY")), None)
    w["t_mode_s"] = round(time.time() - t4, 1)
    w["total_s"] = round(time.time() - t0, 1)
    RESULTS["walkthrough"] = w
    print("  walkthrough:", json.dumps(w, ensure_ascii=False, indent=1))


def main():
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        page.on("pageerror", lambda e: RESULTS["page_errors"].append(str(e)))
        page.on("console", lambda m: RESULTS["page_errors"].append(f"console.error: {m.text}") if m.type == "error" else None)
        try:
            for (w, h) in VIEWPORTS:
                try:
                    audit_viewport(page, w, h)
                except Exception as e:
                    print(f"viewport {w}x{h} aborted: {e}")
                    RESULTS.setdefault("open_failures", []).append(f"{w}x{h} viewport abort: {e}")
            try:
                walkthrough(page)
            except Exception as e:
                print(f"walkthrough aborted: {e}")
                RESULTS.setdefault("open_failures", []).append(f"walkthrough abort: {e}")
        finally:
            browser.close()
    out = os.path.join(ROOT, "tests", "pr8", "layout-audit-raw.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(RESULTS, f, ensure_ascii=False, indent=2)
    print("raw results ->", out)
    print("page errors:", len(RESULTS["page_errors"]))
    for e in RESULTS["page_errors"][:10]:
        print("  ERR", e[:300])


if __name__ == "__main__":
    main()

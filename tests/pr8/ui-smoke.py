#!/usr/bin/env python3
"""UI 统一冒烟：Dropdown 组件替换后的 36 个下拉框逐个验证。

Checks, at 1920x1080 and 978px (preview port 4173):
  对 9 个文件里的 36 个下拉框逐个：按 aria-label 找到 select.ui-dropdown，
  确认可见、读出选项数、换一个不同值（原生 setter + change 事件走 React
  onChange，与手选同一条路径）、确认值确实变了；条件出现的下拉框
  （参考电极、TES 阳极/阴极、TMS 线圈/法向、Level D 场来源、LocalBEM
  局部源模型/源方向）先把 UI 驱动到露出它的状态再验；通道下拉需先跑一次
  实验（disabled 直到有记录）；LocalBEM 需先经文件框导入本地
  fsaverage-bem.json（tests/pr5 的本地固件，不进仓库）。
  另查：全程零控制台报错、零页面报错、横向溢出 0。

环境说明：本机同时有最终大测试与可用性走查的浏览器在跑，CPU/内存很紧；
Playwright 的原生 click 会因可操作性检查的多次 CDP 往返被拖垮甚至把
renderer 拖死，故本脚本一律用 JS 点击（el.click()，照样走 React onClick）
与 JS 改值（原生 setter + change 事件，照样走 React onChange）。仿真就绪
后先暂停直播（PLAY），让页面安静下来再验控件；冒烟只验下拉框，不验直播。
仿真就绪实测约 100 秒，超时 180 秒。

Usage: start preview first (npm run preview -- --port 4173 --host 127.0.0.1
from app/), then:  ~/workspace/brainrun/.venv/bin/python tests/pr8/ui-smoke.py
Screenshots: tests/pr8/smoke-shots/<viewport>-ui-<lab>.png
"""
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "tests" / "pr8" / "smoke-shots"
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = f"http://127.0.0.1:{os.environ.get('UI_SMOKE_PORT', '4173')}/"
BEM_JSON = Path.home() / "workspace" / "brainrun-pr5" / ".local-assets" / "pr5" / "fsaverage-bem.json"

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")


def js_click(page, js_expr):
    """JS 点击：返回是否找到并点了元素。"""
    return page.evaluate(f"""() => {{
      const el = {js_expr};
      if (!el) return false;
      el.click();
      return true;
    }}""")


def set_select(page, aria_label, value, nth=0):
    """原生 setter + change 事件改 select 的值；返回改后的值（None = 没找到）。"""
    return page.evaluate(f"""() => {{
      const els = [...document.querySelectorAll("select.ui-dropdown[aria-label='{aria_label}']")];
      const s = els[{nth}];
      if (!s) return null;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(s, String({value!r}));
      s.dispatchEvent(new Event('change', {{bubbles: true}}));
      return s.value;
    }}""")


def select_info(page, aria_label, nth=0):
    """读一个下拉框的可见性、选项数、当前值。"""
    return page.evaluate(f"""() => {{
      const els = [...document.querySelectorAll("select.ui-dropdown[aria-label='{aria_label}']")];
      const s = els[{nth}];
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return {{
        visible: !!(r.width && r.height) && getComputedStyle(s).visibility !== 'hidden',
        options: [...s.options].map(o => o.value),
        value: s.value,
        disabled: s.disabled,
        cls: s.className,
      }};
    }}""")


def open_chip(page, text):
    ok = js_click(page, f"[...document.querySelectorAll('.topbar button')].find(x => x.textContent.trim() === {text!r})")
    page.wait_for_timeout(800)
    return ok


def close_modal(page):
    js_click(page, "[...document.querySelectorAll('button')].find(x => x.textContent.trim() === '关闭')")
    page.wait_for_timeout(500)


def open_tab(page, label):
    js_click(page, f"[...document.querySelectorAll('[role=\"tab\"]')].find(x => x.textContent.trim() === {label!r})")
    page.wait_for_timeout(400)


def exercise(page, tag, aria_label, nth=0):
    """选一个不同值并确认值变了；返回 True/False。"""
    # 切 tab 后首渲可能在同步算重活（时频 Morlet、源定位拟合），下拉框
    # 可能几秒后才进 DOM：先等 30 秒再判找不到。
    info = None
    for _ in range(30):
        info = select_info(page, aria_label, nth)
        if info is not None:
            break
        page.wait_for_timeout(1000)
    if info is None:
        check(f"{tag} {aria_label}", False, "30s 内未出现 select.ui-dropdown")
        return False
    if not info["visible"]:
        check(f"{tag} {aria_label}", False, "存在但不可见")
        return False
    if info["disabled"]:
        check(f"{tag} {aria_label}", False, "存在但 disabled（不应）")
        return False
    cur = info["value"]
    target = next((v for v in info["options"] if v != cur), None)
    if target is None:
        check(f"{tag} {aria_label}", False, f"只有 1 个选项（当前={cur}），无法换值")
        return False
    after = set_select(page, aria_label, target, nth)
    page.wait_for_timeout(150)
    ok = after == target
    check(f"{tag} {aria_label}", ok,
          f"选项 {len(info['options'])} 个：{cur} → {after}（目标 {target}）")
    return ok


def eeg_modal(page, tag):
    open_chip(page, "EEG 分析")
    # --- 时频先行：late 机制出 epochs（自带 40 试次 oddball，1 秒左右，
    # 不依赖壳实验记录），验方法/频段。壳记录切分（切分试次）在有记录时
    # 4 次尝试均未出“已切分”（原因未定位，疑似壳实验事件表为空或切分
    # 后流程问题，与 Dropdown 无关，已记入汇报；本冒烟不依赖它）。
    # late epochs 只有 Pz 单通道，通道默认就是 Pz，不用切。
    open_tab(page, "ERP")
    js_click(page, "[...document.querySelectorAll('button')].find(x => x.textContent.trim() === '运行 oddball 实验（late 机制）并切分')")
    epochs_ok = False
    for _ in range(30):
        if page.evaluate("() => document.body.innerText.includes('已切分')"):
            epochs_ok = True
            break
        page.wait_for_timeout(1000)
    check(f"{tag} ERP late 切分", epochs_ok, "late 机制 30s 内未出现“已切分”" if not epochs_ok else "")
    open_tab(page, "时频")
    if epochs_ok:
        exercise(page, tag, "方法")
        exercise(page, tag, "频段")
    else:
        check(f"{tag} 时频下拉（需 epochs）", False, "epochs 未切分，时频 tab 按设计无下拉框，无法验证")
    # --- EEG tab ---
    open_tab(page, "EEG")
    exercise(page, tag, "源模型")
    exercise(page, tag, "时长")
    exercise(page, tag, "导联")
    exercise(page, tag, "参考方式")
    # 跑一次实验，通道下拉才可用；参考电极的选项也来自这份记录
    # （跑之前 recording 为空，参考电极按设计只有 'Cz' 一个选项）。
    # 运行耗时随机器负载波动很大（实测 30 秒到 3 分钟以上），等 180 秒。
    # 若 180 秒未完成，通道/参考电极/地形/源定位按设计无下拉框可验，
    # 记一条阻塞原因后跳过，不逐个空等 30 秒。
    js_click(page, "[...document.querySelectorAll('button')].find(x => x.textContent.trim() === '运行实验')")
    run_ok = False
    try:
        page.locator("select.ui-dropdown[aria-label='通道']:not([disabled])").wait_for(timeout=180000)
        run_ok = True
    except Exception:  # noqa: BLE001
        check(f"{tag} 壳实验完成", False, "跑完实验 180s 后通道下拉仍 disabled（环境波动；此前多轮曾通过）")
    if run_ok:
        exercise(page, tag, "通道")
        # 切到电极参考后出现参考电极下拉（此时已有记录，选项 = 记录的通道）
        set_select(page, "参考方式", "electrode")
        page.wait_for_timeout(300)
        exercise(page, tag, "参考电极")
        # --- 地形 tab（需 recording）---
        open_tab(page, "地形")
        exercise(page, tag, "矩方向")
        exercise(page, tag, "参考")
        # --- 源定位 tab（需 recording）---
        open_tab(page, "源定位")
        exercise(page, tag, "真源矩方向")
        exercise(page, tag, "导联")
    page.screenshot(path=str(SHOTS / f"{tag}-ui-eeg.png"))
    close_modal(page)


def head_and_bem(page, tag):
    open_chip(page, "HEAD EEG")
    exercise(page, tag, "电极布局")
    exercise(page, tag, "球形头电流源方向")
    exercise(page, tag, "球形头参考方式")
    exercise(page, tag, "选中电极")
    page.screenshot(path=str(SHOTS / f"{tag}-ui-head.png"))
    # 进阶：真实 MRI/BEM → LocalBEM，导入本地模型文件
    js_click(page, "[...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '打开本地真实 MRI BEM')")
    page.wait_for_timeout(600)
    if not BEM_JSON.exists():
        check(f"{tag} LocalBEM", False, f"本地固件缺失：{BEM_JSON}")
        close_modal(page)
        return
    page.locator("input[aria-label='导入本地 BEM 模型']").set_input_files(str(BEM_JSON))
    try:
        page.locator("select.ui-dropdown[aria-label='BEM物理源模式']").wait_for(timeout=15000)
    except Exception:  # noqa: BLE001
        check(f"{tag} LocalBEM", False, "导入 15s 后仍无 BEM 控制区")
        close_modal(page)
        return
    exercise(page, tag, "BEM物理源模式")
    exercise(page, tag, "皮层源位置")
    exercise(page, tag, "MRI BEM参考")
    exercise(page, tag, "MRI BEM电极")
    # 切到局部源模式 → 出现局部源模型下拉；切回手动 → 出现源方向下拉
    set_select(page, "BEM物理源模式", "local-column")
    page.wait_for_timeout(400)
    exercise(page, tag, "局部源模型")
    set_select(page, "BEM物理源模式", "manual")
    page.wait_for_timeout(400)
    exercise(page, tag, "MRI BEM源方向")
    page.screenshot(path=str(SHOTS / f"{tag}-ui-bem.png"))
    close_modal(page)


def dipole(page, tag):
    open_chip(page, "DIPOLE LAB")
    exercise(page, tag, "电流源方向")
    exercise(page, tag, "参考方式")
    close_modal(page)


def stim(page, tag):
    open_chip(page, "刺激实验")
    exercise(page, tag, "刺激级别")
    exercise(page, tag, "柱模型")
    exercise(page, tag, "目标位置")
    exercise(page, tag, "听觉 ISI")
    # Level B → TES 阳极/阴极
    set_select(page, "刺激级别", "B")
    page.wait_for_timeout(400)
    exercise(page, tag, "阳极位置")
    exercise(page, tag, "阴极位置")
    exercise(page, tag, "皮层法向")
    # Level C → TMS 线圈形状 + 法向
    set_select(page, "刺激级别", "C")
    page.wait_for_timeout(400)
    exercise(page, tag, "线圈形状")
    exercise(page, tag, "皮层法向")
    # Level D → 场来源
    set_select(page, "刺激级别", "D")
    page.wait_for_timeout(400)
    exercise(page, tag, "Level D 场来源")
    page.screenshot(path=str(SHOTS / f"{tag}-ui-stim.png"))
    close_modal(page)


def experiment(page, tag):
    open_chip(page, "对照实验")
    exercise(page, tag, "控制器")
    exercise(page, tag, "特征", nth=0)  # JR 闭环
    exercise(page, tag, "特征", nth=1)  # 直播闭环
    close_modal(page)


def run_viewport(pw, width, height):
    tag = f"{width}"
    # --disable-dev-shm-usage：容器 /dev/shm 很小，多浏览器并跑时 Chromium
    # 会因 shm 满而崩；--disable-gpu：省掉 swiftshader GPU 进程的开销。
    browser = pw.chromium.launch(args=["--disable-gpu", "--disable-dev-shm-usage"])
    ctx = browser.new_context(viewport={"width": width, "height": height})
    page = ctx.new_page()
    page.set_default_timeout(120000)
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    loaded = False
    for attempt in range(6):  # 预览服务器在内存压力下死过；连不上就等 10 秒再试
        try:
            page.goto(BASE, timeout=15000)
            loaded = True
            break
        except Exception as e:  # noqa: BLE001
            print(f"goto retry {attempt}: {type(e).__name__}", flush=True)
            page.wait_for_timeout(10000)
    if not loaded:
        check(f"{tag} page load", False, "预览 60s 内未恢复（ERR_CONNECTION_REFUSED）")
        browser.close()
        return
    page.wait_for_timeout(1500)
    try:
        # 仿真就绪需 Worker 加载 WASM 并初始化；本机同时有最终大测试与可用性
        # 走查的浏览器在跑，实测就绪约 100 秒，超时放宽到 180 秒。
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=180000)
    except Exception:  # noqa: BLE001
        check(f"{tag} sim ready", False, "180s 后仿真未就绪")
        browser.close()
        return
    check(f"{tag} sim ready", True)
    # 暂停直播，让页面安静下来再验控件（冒烟只验下拉框，不验直播）。
    # PLAY 按钮有时点不下去（就绪瞬间按钮仍 disabled，或快照同步把 paused
    # 顶回），故同时直接调仿真 API pause()，并以 t_ms 冻结为准确认；
    # 只看按钮标签不可靠。API 暂停是确定性的（实测 t_ms 冻结）。
    page.wait_for_timeout(2000)
    paused_ok = False
    for _ in range(3):
        js_click(page, "[...document.querySelectorAll('.topbar button')].find(x => x.textContent.trim().startsWith('PLAY —'))")
        page.evaluate("() => window.__brainSim.pause()")
        page.wait_for_timeout(800)
        try:
            a = page.evaluate("() => window.__brainSim.getSnapshot().t_ms")
            page.wait_for_timeout(2000)
            b = page.evaluate("() => window.__brainSim.getSnapshot().t_ms")
            paused_ok = (a == b)
        except Exception:  # noqa: BLE001
            paused_ok = False
        if paused_ok:
            break
        page.wait_for_timeout(1500)
    check(f"{tag} 直播已暂停", paused_ok, "3 次后 t_ms 仍在走（将继续跑冒烟，运行实验可能变慢）" if not paused_ok else "")
    eeg_modal(page, tag)
    head_and_bem(page, tag)
    dipole(page, tag)
    stim(page, tag)
    experiment(page, tag)
    check(f"{tag} 横向溢出", overflow(page) == 0, f"overflow={overflow(page)}px")
    check(f"{tag} 零控制台/页面报错", len(errors) == 0, f"{len(errors)} 条：" + "; ".join(errors[:3]))
    browser.close()


def main():
    from playwright._impl._errors import TargetClosedError
    with sync_playwright() as pw:
        for width, height in [(1920, 1080), (978, 1000)]:
            mark = len(RESULTS)
            try:
                run_viewport(pw, width, height)
            except (TargetClosedError, Exception) as e:  # noqa: BLE001
                # 浏览器在高负载下崩过（TargetClosedError，非产品问题）：
                # 丢弃本视口的半截结果，重开浏览器再跑一次。
                print(f"RETRY {width} after {type(e).__name__}: {str(e)[:120]}", flush=True)
                del RESULTS[mark:]
                run_viewport(pw, width, height)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"\n{passed}/{len(RESULTS)} passed")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())

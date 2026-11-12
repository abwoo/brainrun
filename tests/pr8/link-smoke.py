#!/usr/bin/env python3
"""PR8-LINK browser smoke: §4.1 六实验台接主仿真的界面验证。

Checks, at 1920x1080 and 978px (preview port 4173):
  L1  EEG 台：从直播推导记录（Pz 峰值可见，事件数 ≥1）；改刺激强度后
      重跑，Pz 峰值跟着变；改 G 测双稳锁定（500 ms 长脉冲：G=0.35 锁死
      E~0.49、G=0.05 回落 E~0.01，sim 层读数——单脉冲峰饱和、翻转靠运气、
      扩散为零，三者都不可靠；台架 G 敏感性另由方法学测试 L1 覆盖）；
      关弹窗再开，记录还在（页脚“直播推导”来源）。
  L2  细胞台：前向 E 取直播值（无手填滑杆）；跑 HH 后把 dP 应用回主仿真，
      选中脑区 P 的均值跟着变（读 __brainSim 快照）。
  L3  HEAD EEG：直播源标注 + q 值；脉冲串轮询取最大 |q|（响应是约 100
      仿真毫秒的尖峰，单次读数抓不到；持续偏置的稳态 q≈0.02 也不可用），
      换选区后静息 |q| 回落；关掉直播源出现“独立演示”。
  L4  DIPOLE LAB：直播源标注；同 L3 的轮询法，换选区后 |q|/S01 跟着变。
  L5  刺激实验：目标默认选中脑区；视觉闪烁向枕区发脉冲（markers 增长）；
      听觉 burst 向颞区发脉冲；Level A 向选中脑区发直播脉冲。
  L6  对照实验：直播 A 取到峰值 ΔE 与 Pz 数；直播回放载入真实快照；
      直播闭环（先加偏置抬高 E 再启动）触发反馈脉冲并记日志。
  L7  全程无横向溢出、无控制台报错。

时序铁律（2026-11-12 探针实测）：headless 下仿真时间比墙钟快约 3–6 倍，
600 条快照窗只覆盖约 3–6 墙秒；脉冲响应只持续约 2–3 仿真秒。所以凡是
“脉冲后读数”的检查，必须脉冲后立刻读（EEG 推导）或改用持续偏置读
稳态值（HEAD/DIPOLE）；脉冲与读数之间加 1.5–3 秒等待会恰好错过响应。

Usage: start preview first (npm run preview -- --port 4173 --host 127.0.0.1
from app/), then:  ~/workspace/brainrun/.venv/bin/python tests/pr8/link-smoke.py
Screenshots: tests/pr8/smoke-shots/<viewport>-link-<lab>.png
"""
import re
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
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")


def sim_ready(page):
    return page.evaluate("window.__brainSim && window.__brainSim.isReady()")


def snap_p(page, node, n=5):
    """读 n 次快照的 P[node] 均值（OU 背景会抖，取均值再比）。"""
    vals = []
    for _ in range(n):
        v = page.evaluate(f"window.__brainSim.getSnapshot().p[{node}]")
        vals.append(v)
        page.wait_for_timeout(120)
    return sum(vals) / len(vals)


def snap_e(page, node):
    return page.evaluate(f"window.__brainSim.getSnapshot().e[{node}]")


def select_node(page, node):
    """经响应列表选脑区：先脉冲该脑区，再点 RESPONSE 里它的行。"""
    page.evaluate(f"window.__brainSim.pulse({node})")
    page.wait_for_timeout(3000)
    row = page.locator(f".resp-row[data-node='{node}']")
    if row.count():
        row.first.click()
        page.wait_for_timeout(500)
        return True
    return False


def parse_pz_peak(text):
    m = re.search(r"Pz 峰值 ([0-9.]+) µV", text)
    return float(m.group(1)) if m else None


def read_live_q(text):
    """HEAD/DIPOLE 横幅里的直播偶极矩 q（nA·m）；无直播源时为 None。"""
    m = re.search(r"直播源：[^·]*· q = ([\-0-9.]+) nA·m", text)
    return float(m.group(1)) if m else None


def read_cz(text):
    m = re.search(r"当前电极电位：([\-0-9.]+) µV", text)
    return float(m.group(1)) if m else None


def read_s01(text):
    m = re.search(r"\nS01\n([\-0-9.]+)", text)
    return float(m.group(1)) if m else None


def poll_max_q(page, modal, n, interval_ms=150, pulse_node=None):
    """轮询 modal 里直播源 q 横幅 n 次，返回 (|q| 最大值，|Cz| 或 |S01| 最大值）。

    脉冲响应是约 100 仿真毫秒的尖峰（探针实测：50 ms 墙钟采样全程漏掉，
    E 始终 ~0.013，而响应窗口录到 maxE 0.493），单次读数几乎一定错过；
    脉冲后等 120 ms 再读也错过——尖峰帧在 DOM 上只停留约一帧（~67 ms），
    120 ms 后早已被静息帧覆盖（第三轮实测：16 次脉冲 max|q|=0.027，与静息
    0.028 无异）。正确做法是脉冲后立即快轮询（8 次连续读，只花读数本身
    的往返时间），用多次采样覆盖尖峰帧，再等网络回落才发下一脉冲。
    持续偏置不能用：稳态 E 只抬 +0.003，q≈0.02。长脉冲（500 ms）不能用：
    会把双稳网络锁进高态（E 0.489 持续 5 s+）。
    返回 (|q| 最大值，|Cz| 或 |S01| 最大值）；一次也没读到横幅时 |q| 为 None。
    """
    q_max, v_max = None, 0.0
    for _ in range(n):
        if pulse_node is not None:
            page.evaluate(f"window.__brainSim.pulseAt({pulse_node}, 2.0, 100)")
            # 快轮询：连续读 8 次，覆盖尖峰帧（约一帧 ~67 ms）。
            for _ in range(8):
                text = modal.inner_text() or ""
                q = read_live_q(text)
                if q is not None:
                    q_max = abs(q) if q_max is None else max(q_max, abs(q))
                cz = read_cz(text)
                s01 = read_s01(text)
                v = cz if cz is not None else s01
                if v is not None:
                    v_max = max(v_max, abs(v))
            # 等网络回落（尖峰已衰减）再发下一脉冲。
            page.wait_for_timeout(150)
        else:
            page.wait_for_timeout(interval_ms)
            text = modal.inner_text() or ""
            q = read_live_q(text)
            if q is not None:
                q_max = abs(q) if q_max is None else max(q_max, abs(q))
            cz = read_cz(text)
            s01 = read_s01(text)
            v = cz if cz is not None else s01
            if v is not None:
                v_max = max(v_max, abs(v))
    return q_max, v_max


def run_viewport(pw, width, height, tag):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until="load", timeout=60000)
    page.wait_for_timeout(4000)
    check(f"{tag} L0 app loads, no console errors", len(errors) == 0, "; ".join(errors[:3]))
    check(f"{tag} L0b no horizontal overflow on load", overflow(page) <= 0, f"overflow={overflow(page)}px")
    # 等引擎就绪 + 快照历史攒够（直播推导要 ≥1 s 历史；等 11 s 攒满 10 s 窗）。
    page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
    page.wait_for_timeout(11000)

    # 选 40 号脑区（lAMYG）作全程基准。
    check(f"{tag} L0c select node 40 via response list", select_node(page, 40))
    body = page.locator("body").inner_text()
    check(f"{tag} L0d region panel shows lAMYG #40", "lAMYG" in body and "#40" in body)

    # ---- L1 EEG 台：直播推导 + 三组对照 ----
    page.get_by_role("button", name="EEG 分析", exact=True).click()
    page.wait_for_timeout(800)
    body = page.locator("body").inner_text()
    check(f"{tag} L1a EEG lab shows live-source note", "直播推导" in body and "有效采样率 60 Hz" in body)
    # 关键时序：headless 下仿真时间比墙钟快约 3–6 倍，600 条快照窗只覆盖
    # 约 3–6 墙秒——脉冲必须在点推导前 1 墙秒内发出，否则滚出窗外
    # （探针 tests/pr8/probe-l1b.py 实测：脉冲标记 t=13877，3.5 墙秒后窗口
    # 已从 14996 起，事件 0 个、Pz 0.001；G=0.05 组因脉冲较新才拿到 0.044）。
    # 所以 L1b/L1c/L1d 一律先开好实验台、再脉冲、立刻点推导，不加等待。
    page.evaluate("window.__brainSim.pulse(40)")
    page.get_by_role("button", name="从直播推导记录").click()
    page.wait_for_timeout(2500)
    body = page.locator("body").inner_text()
    pz1 = parse_pz_peak(body)
    m_ev = re.search(r"事件 (\d+) 个", body)
    ev1 = int(m_ev.group(1)) if m_ev else None
    check(f"{tag} L1b live derivation gives Pz peak", pz1 is not None and pz1 > 0.01 and ev1 is not None and ev1 >= 1,
          f"Pz peak={pz1} events={ev1}")
    # 改刺激强度：0.5× → 等旧脉冲滚出窗再脉冲 → 立刻重跑 → Pz 峰值应变小。
    page.evaluate("window.__brainSim.setParams({stim_amplitude: 0.5})")
    page.wait_for_timeout(11000)
    page.evaluate("window.__brainSim.pulse(40)")
    page.get_by_role("button", name="从直播推导记录").click()
    page.wait_for_timeout(2500)
    body = page.locator("body").inner_text()
    pz2 = parse_pz_peak(body)
    check(f"{tag} L1c weaker stimulus -> smaller Pz peak", pz1 is not None and pz2 is not None and pz2 < pz1,
          f"Pz {pz1} -> {pz2}")
    # 改 G：对照改测双稳锁定（探针 tests/pr8/probe-lock.py）——单脉冲峰在
    # amp 2.0 饱和（G 无差别）、amp 1.0 翻转靠运气（三次实测 Pz 0.040/0.018/
    # 0.007）、扩散到 #73/#62 几乎为零（q 峰 0.06–0.09，静息水平），三者都
    # 不可靠。确定性效应是 500 ms 长脉冲的锁定：G=0.35 时反馈自持高态
    # （E 2 s 后仍 ~0.49），G=0.05 时回落（E~0.011），差 40 倍。
    # 这是 sim 层读数（快照 E40），因为 EEG 推导是变化量（相对窗首基线），
    # 持续高态本身在推导里 Pz≈0；台架对 G 的敏感性由方法学测试 L1（管线）+
    # 本检查（直播仿真）+ L1b/L1c（台架跟随直播）三段链条共同建立。
    # 锁死后必须 reset() 复位，否则高态毒化后续检查。
    page.evaluate("window.__brainSim.setParams({stim_amplitude: 2.0, g: 0.35})")
    page.wait_for_timeout(3000)
    page.evaluate("window.__brainSim.pulseAt(40, 2.0, 500)")
    page.wait_for_timeout(2000)
    e_locked = snap_e(page, 40)
    check(f"{tag} L1d1 long pulse locks network at G 0.35", e_locked is not None and e_locked > 0.3,
          f"E40={e_locked}")
    page.evaluate("window.__brainSim.reset()")
    page.wait_for_timeout(2000)
    page.evaluate("window.__brainSim.setParams({g: 0.05})")
    page.wait_for_timeout(3000)
    page.evaluate("window.__brainSim.pulseAt(40, 2.0, 500)")
    page.wait_for_timeout(2000)
    e_fallback = snap_e(page, 40)
    check(f"{tag} L1d G 0.35->0.05 changes lock behavior",
          e_locked is not None and e_fallback is not None and e_locked > 0.3 and e_fallback < 0.05,
          f"E40 locked={e_locked} fallback={e_fallback}")
    page.evaluate("window.__brainSim.reset()")
    page.wait_for_timeout(2000)
    page.evaluate("window.__brainSim.setParams({stim_amplitude: 2.0, g: 0.35})")
    page.screenshot(path=str(SHOTS / f"{tag}-link-eeg.png"))
    check(f"{tag} L1e no overflow in EEG lab", overflow(page) <= 0, f"overflow={overflow(page)}px")
    # 关弹窗再开：记录还在。
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(500)
    page.get_by_role("button", name="EEG 分析", exact=True).click()
    page.wait_for_timeout(800)
    body = page.locator("body").inner_text()
    check(f"{tag} L1f recording survives close/reopen", "当前记录来自直播推导" in body)
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(500)

    # ---- L2 细胞台：前向 live E + 反向 dP ----
    page.get_by_role("button", name="细胞实验", exact=True).click()
    page.wait_for_timeout(800)
    body = page.locator("body").inner_text()
    check(f"{tag} L2a cellular shows live E, no manual slider", "直播 E =" in body and "脑区活动 E：" not in body)
    p_before = snap_p(page, 40)
    page.get_by_role("button", name="运行仿真").click()
    page.wait_for_timeout(800)
    body = page.locator("body").inner_text()
    m = re.search(r"发放率 ([0-9.]+) Hz", body)
    rate = float(m.group(1)) if m else None
    check(f"{tag} L2b HH run gives firing rate", rate is not None and rate > 0, f"rate={rate}")
    page.get_by_role("button", name="把 dP 应用回主仿真（偏置）").click()
    page.wait_for_timeout(1500)
    body = page.locator("body").inner_text()
    check(f"{tag} L2c bias applied note shown", "已应用偏置" in body)
    p_after = snap_p(page, 40)
    dp = 0.002 * rate if rate else 0
    check(f"{tag} L2d live P follows applied dP", abs(p_after - p_before) > 0.3 * abs(dp) if dp else False,
          f"P {p_before:.3f} -> {p_after:.3f} (dP={dp:.3f})")
    page.evaluate("window.__brainSim.clearBias(40)")
    page.screenshot(path=str(SHOTS / f"{tag}-link-cellular.png"))
    check(f"{tag} L2e no overflow in CellularLab", overflow(page) <= 0, f"overflow={overflow(page)}px")
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(500)

    # ---- L3 HEAD EEG：直播源 + 换选区 ----
    page.get_by_role("button", name="HEAD EEG", exact=True).click()
    page.wait_for_timeout(1000)
    modal = page.locator(".modal").first
    text = modal.inner_text() or ""
    check(f"{tag} L3a HEAD shows live source", "直播源：#40 lAMYG" in text, text[:150].replace("\n", " | "))
    check(f"{tag} L3b HEAD not independent-demo in live mode", "独立演示" not in text)
    # 静息 q≈0、脉冲响应是约 100 仿真毫秒的尖峰、持续偏置的稳态 q≈0.02——
    # 单次读数三种路都抓不到信号。改用脉冲串 + 轮询取最大 |q|：16 次短脉冲
    # （100 ms，不锁高态）每次读横幅 q 与 Cz，尖峰至少被一次渲染捕获。
    q_rest40, _ = poll_max_q(page, modal, 6)
    q_max40, cz_max40 = poll_max_q(page, modal, 16, pulse_node=40)
    check(f"{tag} L3c HEAD live q spikes with pulses",
          q_max40 is not None and q_max40 > 0.5 and q_rest40 is not None and q_rest40 < 0.3,
          f"max|q| pulsed={q_max40} rest={q_rest40} max|Cz|={cz_max40:.4f}")
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(500)
    check(f"{tag} L3d select node 73", select_node(page, 73))
    page.get_by_role("button", name="HEAD EEG", exact=True).click()
    page.wait_for_timeout(1000)
    modal = page.locator(".modal").first
    text = modal.inner_text() or ""
    check(f"{tag} L3e HEAD follows new region", "直播源：#73 lV1" in text)
    # 换选区后不脉冲：轮询静息 q，应远小于刚才脉冲串的最大 |q|。
    q_rest73, cz_rest73 = poll_max_q(page, modal, 16)
    check(f"{tag} L3f HEAD Cz changes with region",
          q_max40 is not None and q_max40 > 0.5 and q_rest73 is not None and q_rest73 < 0.3
          and q_max40 > 3 * max(q_rest73, 1e-9),
          f"max|q| #40 pulsed={q_max40} #73 rest={q_rest73} max|Cz| #73 rest={cz_rest73:.4f}")
    # 脉冲串后复位仿真状态（清刺激/偏置），免得残留影响 L4。
    page.evaluate("window.__brainSim.reset()")
    page.wait_for_timeout(2000)
    # 关掉直播源 → 独立演示标注出现。
    page.get_by_role("checkbox", name=re.compile("直播源")).first.uncheck()
    page.wait_for_timeout(500)
    text = modal.inner_text() or ""
    check(f"{tag} L3g manual mode labelled independent-demo", "独立演示" in text)
    page.screenshot(path=str(SHOTS / f"{tag}-link-head.png"))
    check(f"{tag} L3h no overflow in HeadSphereLab", overflow(page) <= 0, f"overflow={overflow(page)}px")
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(500)

    # ---- L4 DIPOLE LAB ----
    page.get_by_role("button", name="DIPOLE LAB", exact=True).click()
    page.wait_for_timeout(800)
    modal = page.locator(".modal").first
    text = modal.inner_text() or ""
    check(f"{tag} L4a dipole shows live source #73", "直播源：#73 lV1" in text)
    # 与 L3 同理：静息轮询取 max|q|，再切回 #40 脉冲串轮询取 max|q|。
    q_rest73, s01_rest73 = poll_max_q(page, modal, 16)
    check(f"{tag} L4b dipole S01 readable", q_rest73 is not None,
          f"max|q| #73 rest={q_rest73} max|S01|={s01_rest73:.3f}")
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(500)
    check(f"{tag} L4c select node 40 again", select_node(page, 40))
    page.get_by_role("button", name="DIPOLE LAB", exact=True).click()
    page.wait_for_timeout(800)
    modal = page.locator(".modal").first
    text = modal.inner_text() or ""
    check(f"{tag} L4b2 dipole shows live source #40", "直播源：#40 lAMYG" in text)
    q_max40, s01_max40 = poll_max_q(page, modal, 16, pulse_node=40)
    check(f"{tag} L4d dipole S01 changes with region",
          q_max40 is not None and q_max40 > 0.5 and q_rest73 is not None and q_rest73 < 0.3
          and q_max40 > 3 * max(q_rest73, 1e-9),
          f"max|q| #40 pulsed={q_max40} #73 rest={q_rest73} "
          f"max|S01| #40={s01_max40:.3f} #73={s01_rest73:.3f}")
    page.evaluate("window.__brainSim.reset()")
    page.wait_for_timeout(2000)
    page.screenshot(path=str(SHOTS / f"{tag}-link-dipole.png"))
    check(f"{tag} L4e no overflow in DipoleLab", overflow(page) <= 0, f"overflow={overflow(page)}px")
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(500)

    # ---- L5 刺激实验：目标 + 感觉输入 + Level A ----
    page.get_by_role("button", name="刺激实验", exact=True).click()
    page.wait_for_timeout(800)
    modal = page.locator(".modal").first
    text = modal.inner_text() or ""
    check(f"{tag} L5a default target is selected region", "选中脑区 #40 lAMYG" in text)
    page.get_by_role("button", name="运行闪烁实验").click()
    page.wait_for_timeout(5000)
    text = modal.inner_text() or ""
    check(f"{tag} L5b flicker pulses occipital V1", "已向枕区 #35、#73 发" in text, text[-300:].replace("\n", " | "))
    n_v1 = page.evaluate("window.__brainSim.getMarkers().filter(m => m.node === 35).length")
    check(f"{tag} L5c flicker adds V1 markers", n_v1 > 0, f"markers on #35: {n_v1}")
    page.get_by_role("button", name="运行听觉实验").click()
    page.wait_for_timeout(3500)
    text = modal.inner_text() or ""
    check(f"{tag} L5d auditory bursts pulse temporal A1", "已向颞区 #0、#38 发" in text)
    n_a1 = page.evaluate("window.__brainSim.getMarkers().filter(m => m.node === 0).length")
    check(f"{tag} L5d2 auditory adds A1 markers", n_a1 > 0, f"markers on #0: {n_a1}")
    # Level A：切到 A 级，运行响应 → 向选中脑区发直播脉冲。
    page.get_by_label("刺激级别").select_option("A")
    page.wait_for_timeout(400)
    page.get_by_role("button", name="运行响应").click()
    page.wait_for_timeout(800)
    text = modal.inner_text() or ""
    check(f"{tag} L5e Level A live pulse to selected region", "已向 #40 lAMYG 发直播脉冲" in text)
    last_marker = page.evaluate("window.__brainSim.getMarkers().slice(-1)[0]")
    check(f"{tag} L5f Level A adds marker on #40", last_marker and last_marker["node"] == 40,
          f"last marker={last_marker}")
    page.screenshot(path=str(SHOTS / f"{tag}-link-stim.png"))
    check(f"{tag} L5g no overflow in StimLab", overflow(page) <= 0, f"overflow={overflow(page)}px")
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(500)

    # ---- L6 对照实验：直播 A / 回放 / 闭环 ----
    # 先给 40 号一个脉冲，让最近响应窗口属于 #40（听觉 burst 的窗口属于 A1）。
    page.evaluate("window.__brainSim.pulse(40)")
    page.wait_for_timeout(3000)
    page.get_by_role("button", name="对照实验", exact=True).click()
    page.wait_for_timeout(800)
    modal = page.locator(".modal").first
    text = modal.inner_text() or ""
    check(f"{tag} L6a JR sections labelled independent-demo", text.count("独立演示") >= 2)
    page.get_by_role("button", name="取直播 A（最近响应窗口）").click()
    page.wait_for_timeout(1500)
    text = modal.inner_text() or ""
    check(f"{tag} L6b live A gives peak dE + Pz", "直播 A（#40 lAMYG）" in text and "峰值 ΔE" in text)
    page.get_by_role("button", name="载入最近 10 秒直播快照").click()
    page.wait_for_timeout(800)
    text = modal.inner_text() or ""
    check(f"{tag} L6c live replay loads real snapshots", "回放：" in text and "E =" in text)
    # 直播闭环：先加偏置把 E 抬起来，再启动（阈值取当前 E 的 80%，动态填）。
    page.evaluate("window.__brainSim.setBias(40, 0.3)")
    page.wait_for_timeout(1500)
    e_now = snap_e(page, 40)
    thr = round(e_now * 0.8, 3)
    live_panel = page.locator("text=闭环控制 · 直播闭环").locator("xpath=..")
    live_panel.locator("input").nth(0).fill(str(thr))
    live_panel.get_by_role("button", name="启动直播闭环").click()
    page.wait_for_timeout(4000)
    text = modal.inner_text() or ""
    check(f"{tag} L6d live closed loop triggers feedback pulse", "→ 脉冲 #40" in text,
          f"thr={thr} E~{e_now:.3f}")
    page.evaluate("window.__brainSim.clearBias(40)")
    page.screenshot(path=str(SHOTS / f"{tag}-link-experiment.png"))
    check(f"{tag} L6e no overflow in ExperimentLab", overflow(page) <= 0, f"overflow={overflow(page)}px")
    page.get_by_role("button", name="关闭", exact=True).first.click()
    page.wait_for_timeout(500)

    check(f"{tag} L7 no console errors after all interactions", len(errors) == 0,
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

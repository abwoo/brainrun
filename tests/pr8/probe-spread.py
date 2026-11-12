"""L1d 扩散探针：脉冲 #40 后，远处节点 #73 的 E(t) 是否跟随（G 对照）。

背景：amp≥1.2 时 G=0.05 也翻转（probe-g15），单节点脉冲峰无法区分 G。
改测网络扩散：G=0.35 时脉冲应翻转全网（含 #73），G=0.05 时只翻转 #40 局部，
#73 保持静息。用 #73 的历史窗内 q 峰值度量。
"""
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": 1920, "height": 1080})
    page.goto("http://127.0.0.1:4173/", timeout=60000)
    page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
    page.wait_for_timeout(11000)
    for g in (0.35, 0.05):
        page.evaluate(f"window.__brainSim.setParams({{stim_amplitude: 2.0, g: {g}}})")
        page.wait_for_timeout(11000)
        page.evaluate("window.__brainSim.pulse(40)")
        page.wait_for_timeout(300)
        h = page.evaluate(
            "window.__brainSim.getSnapshotHistory().map(s => [s.t_ms, s.e[73], s.i[73], s.e[40]])"
        )
        b_e, b_i = h[0][1], h[0][2]
        qp73 = max(abs(0.04 * (200 * (e - b_e) - 100 * (i - b_i))) for _, e, i, _ in h)
        emax73 = max(r[1] for r in h)
        emax40 = max(r[3] for r in h)
        print(f"G={g}: node73 q_peak={qp73:.3f} Emax73={emax73:.4f} Emax40={emax40:.4f} "
              f"(Pz73~{qp73 * 0.02:.3f} uV)")
    b.close()
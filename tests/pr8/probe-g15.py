"""L1d 幅度选择探针：amp 1.2 / 1.5 在 G 0.35 / 0.05 下是否翻转。

背景：amp 1.0 在 G=0.35 时翻转不可靠（探针一次 q=2.87，冒烟一次 Pz=0.018
只翻了一半）；amp 2.0 在 G=0.05 也翻转（q=2.85），故 G 对照不能用 2.0。
找一个幅度：G=0.35 可靠翻转（q>2），G=0.05 不翻转（q<0.8）。
"""
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": 1920, "height": 1080})
    page.goto("http://127.0.0.1:4173/", timeout=60000)
    page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
    page.wait_for_timeout(11000)
    page.evaluate("window.__brainSim.pulse(40)")
    page.wait_for_timeout(3000)
    page.locator(".resp-row[data-node='40']").first.click()
    page.wait_for_timeout(500)
    for amp in (1.5, 1.2):
        for g in (0.35, 0.05):
            page.evaluate(f"window.__brainSim.setParams({{stim_amplitude: {amp}, g: {g}}})")
            page.wait_for_timeout(11000)
            page.evaluate("window.__brainSim.pulse(40)")
            page.wait_for_timeout(300)
            h = page.evaluate(
                "window.__brainSim.getSnapshotHistory().map(s => [s.t_ms, s.e[40], s.i[40]])"
            )
            b_e, b_i = h[0][1], h[0][2]
            qp = max(abs(0.04 * (200 * (e - b_e) - 100 * (i - b_i))) for _, e, i in h)
            emax = max(r[1] for r in h)
            print(f"amp={amp} G={g}: q_peak={qp:.3f} Emax={emax:.4f} (Pz~{qp * 0.014:.3f} uV)")
    b.close()
"""L1d 锁定探针：500 ms 长脉冲后网络是否锁进高态（G 对照）。

背景：单节点脉冲峰在 amp 2.0 饱和（G 无差别）、amp 1.0 翻转靠运气、
扩散到 #73/#62 几乎为零（q 峰 0.06–0.09，静息水平）。
新思路：长脉冲把 E 抬高 500 仿真毫秒，高态能否自持取决于 G 的反馈强度——
G=0.35 应锁死（E 2 s 后仍 ~0.49），G=0.05 应回落（E ~0.013）。
这是二值、确定性的对照（40 倍），不依赖翻转阈值运气。
"""
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": 1920, "height": 1080})
    page.goto("http://127.0.0.1:4173/", timeout=60000)
    page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
    page.wait_for_timeout(11000)
    for amp, g in ((0.8, 0.35), (0.8, 0.05), (2.0, 0.05)):
        page.evaluate(f"window.__brainSim.setParams({{stim_amplitude: {amp}, g: {g}}})")
        page.wait_for_timeout(11000)
        page.evaluate(f"window.__brainSim.pulseAt(40, {amp}, 500)")
        page.wait_for_timeout(2000)
        e2 = page.evaluate("window.__brainSim.getSnapshot().e[40]")
        page.wait_for_timeout(3000)
        e5 = page.evaluate("window.__brainSim.getSnapshot().e[40]")
        print(f"amp={amp} G={g}: E40 2s={e2:.4f} 5s={e5:.4f} "
              f"{'LOCKED' if e2 > 0.3 else 'fell back'}")
        page.evaluate("window.__brainSim.reset()")
        page.wait_for_timeout(2000)
    b.close()

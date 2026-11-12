"""长脉冲探针：500 ms 脉冲是否把 E 抬高到可读窗口（HEAD/DIPOLE 轮询用），
以及脉冲后网络是否锁高态（影响后续检查）。"""
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
    base = page.evaluate("window.__brainSim.getSnapshot().e[40]")
    print(f"baseline E40={base:.4f}")
    page.evaluate("window.__brainSim.pulseAt(40, 2.0, 500)")
    for k in range(40):
        e = page.evaluate("window.__brainSim.getSnapshot().e[40]")
        print(f"  {(k+1)*50:4d}ms E={e:.4f}")
        page.wait_for_timeout(50)
    for wait_s in (3, 5):
        page.wait_for_timeout(wait_s * 1000)
        e = page.evaluate("window.__brainSim.getSnapshot().e[40]")
        print(f"E40 {wait_s}s after long pulse: {e:.4f}")
    b.close()

"""L1b 诊断探针：脉冲后直播推导 Pz 峰值为何是 0.000。

复现 link-smoke L0+L1b 的时序，但直接从 __brainSim 读原始快照历史：
- 脉冲前后节点 40 的 live E（判断网络是否翻进双稳高态）
- 响应窗口 max|ΔE|
- 推导时刻 history 窗口内节点 40 E(t) 的 max/min、首样本基线
- 由此算出期望 q 峰值，与 UI 显示的 Pz 峰值对照
"""
import re
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4173/"
NODE = 40


def hist_node40(page):
    return page.evaluate(
        "window.__brainSim.getSnapshotHistory().map(s => [s.t_ms, s.e[40], s.i[40]])"
    )


def q_peak_from_hist(h):
    if len(h) < 2:
        return 0.0
    b_e, b_i = h[0][1], h[0][2]
    return max(abs(0.04 * (200 * (e - b_e) - 100 * (i - b_i))) for _, e, i in h)


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        page = b.new_page(viewport={"width": 1920, "height": 1080})
        errs = []
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(URL, timeout=60000)
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        page.wait_for_timeout(11000)
        print("pre-pulse live E40 =", page.evaluate("window.__brainSim.getSnapshot().e[40]"))
        print("pre-pulse live P40 =", page.evaluate("window.__brainSim.getSnapshot().p[40]"))
        # 与 link-smoke L0c 相同：先脉冲，再点 RESPONSE 行
        page.evaluate("window.__brainSim.pulse(40)")
        page.wait_for_timeout(3000)
        row = page.locator(".resp-row[data-node='40']")
        print("resp row count:", row.count())
        if row.count():
            row.first.click()
            page.wait_for_timeout(500)
        w = page.evaluate("window.__brainSim.getLastResponseWindow()")
        if w:
            es = [s["e"][NODE] for s in w["snapshots"]]
            print(f"response window: n={len(es)} maxE40={max(es):.4f} minE40={min(es):.4f}")
        print("post-pulse live E40 =", page.evaluate("window.__brainSim.getSnapshot().e[40]"))
        h = hist_node40(page)
        es = [r[1] for r in h]
        print(f"history: n={len(h)} t={h[0][0]:.0f}..{h[-1][0]:.0f} ms "
              f"E40 max={max(es):.4f} min={min(es):.4f} first={es[0]:.4f} last={es[-1]:.4f} "
              f"q_peak={q_peak_from_hist(h):.3f}")
        print("markers:", page.evaluate("window.__brainSim.getMarkers()"))
        # 开 EEG 实验台，点直播推导
        page.get_by_text("EEG 分析", exact=True).first.click()
        page.wait_for_timeout(800)
        lab = page.locator(".modal, [class*=modal]").last
        lab.get_by_text("从直播推导记录", exact=True).click()
        lab.locator("text=直播推导完成").wait_for(state="visible", timeout=30000)
        txt = page.inner_text("body")
        m = re.search(r"直播推导完成：([^\n]*)", txt)
        print("STATUS:", m.group(1) if m else "(not found)")
        h2 = hist_node40(page)
        es2 = [r[1] for r in h2]
        print(f"history@derive: n={len(h2)} t={h2[0][0]:.0f}..{h2[-1][0]:.0f} ms "
              f"E40 max={max(es2):.4f} first={es2[0]:.4f} q_peak={q_peak_from_hist(h2):.3f}")
        print("console errors:", errs)
        b.close()


if __name__ == "__main__":
    sys.exit(main())

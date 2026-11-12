"""L3/L4 + L1d 诊断探针：脉冲响应动力学（墙钟时间）与 G 对单节点脉冲峰的影响。

问题：
- L3c：setBias(40, 0.3) 后等 2 s 读 Cz ≈ -0.0——持续偏置是否产生持续 q？
- L1d：G 0.35→0.05 时 Pz 峰值 0.045 → 0.045（不变）——G 是否影响单节点脉冲峰？
- 脉冲后 E40(t)/q(t) 的时程：峰值何时到、衰减多快（决定“脉冲后立刻读”是否可行）。

做法：直接读 __brainSim 快照（e[40]）与 HEAD/DIPOLE 的 q 横幅，
不经过推导；q 由 E/I 与基线（脉冲前快照）按 equivalentMomentNAm 的
200/100 形态换算：q = 0.04*(200*dE - 100*dI)。
"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4173/"
NODE = 40


def snap(page):
    return page.evaluate(
        "(() => { const s = window.__brainSim.getSnapshot(); "
        "return {e: s.e[40], i: s.i[40], e73: s.e[73], i73: s.i[73]}; })()"
    )


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        page = b.new_page(viewport={"width": 1920, "height": 1080})
        page.goto(URL, timeout=60000)
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        page.wait_for_timeout(11000)
        page.evaluate("window.__brainSim.pulse(40)")
        page.wait_for_timeout(3000)
        page.locator(".resp-row[data-node='40']").first.click()
        page.wait_for_timeout(500)

        # 1) 脉冲响应时程：脉冲后每 50 ms 墙钟采样 E40，持续 3 s
        base = snap(page)
        print(f"baseline E40={base['e']:.4f} I40={base['i']:.4f}")
        page.evaluate("window.__brainSim.pulse(40)")
        print("-- pulse response E40(t), wall ms after pulse --")
        for k in range(60):
            s = snap(page)
            q = 0.04 * (200 * (s["e"] - base["e"]) - 100 * (s["i"] - base["i"]))
            print(f"  {(k + 1) * 50:4d}ms E={s['e']:.4f} I={s['i']:.4f} q={q:+.3f}")
            page.wait_for_timeout(50)
        w = page.evaluate("window.__brainSim.getLastResponseWindow()")
        es = [x["e"][NODE] for x in w["snapshots"]]
        print(f"response window n={len(es)} maxE40={max(es):.4f}")

        # 2) 持续偏置 2 s 后的稳态 E/I 与 q
        page.evaluate("window.__brainSim.setBias(40, 0.3)")
        page.wait_for_timeout(2000)
        s = snap(page)
        q = 0.04 * (200 * (s["e"] - base["e"]) - 100 * (s["i"] - base["i"]))
        print(f"-- sustained bias 0.3, 2s later: E={s['e']:.4f} I={s['i']:.4f} "
              f"dE={s['e'] - base['e']:+.4f} dI={s['i'] - base['i']:+.4f} q={q:+.3f}")
        page.evaluate("window.__brainSim.clearBias(40)")
        page.wait_for_timeout(2000)

        # 3) G 对单节点脉冲峰的影响：amp 2.0/1.0/0.5 × G 0.35/0.05，
        #    每次脉冲后立刻读历史窗口内 q 峰值（与推导同口径：窗首基线）。
        for amp in (2.0, 1.0, 0.5):
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
                print(f"amp={amp} G={g}: q_peak={qp:.3f} Emax={emax:.4f} "
                      f"(Pz~{qp * 0.014:.3f} uV)")
        b.close()


if __name__ == "__main__":
    sys.exit(main())

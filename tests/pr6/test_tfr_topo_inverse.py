"""PR6 时频/地形/源定位 — Python 测试（B3：PR-10/11/12）。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr6 -p 'test_*.py' -v

球形 fixture：``app/public/forward-assets/sphere-model.json`` 由 CI/本地
生成、不入库；本地生成命令：
    ~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py
缺失时依赖它的测试跳过并报出该命令（不是静默通过）。

三层验证：
1. Fixture 新鲜度：重新生成 multitaper ERSP 小 fixture 与
   tfr-topo-inverse fixture，与 tests/pr6/fixtures/ 里存的逐点比较
   （TS 测试读的就是这两份 fixture，过期即失败）。
   新鲜度容差按跨环境浮点确定性实测取值（不是逐位相等）：地形
   电极电位 1e-5 µV（CI 漂移 2.46e-6，来自 CI 现场重算的球形
   正向模型在不同 CPU 上的 MNE 求解差异）、盲测 spread 相对
   1e-5（CI 漂移 6.96e-6 mm，相对 8.9e-8）。量级依据与实测见
   tests/pr6/debug-rounds.md（2026-11-12 CI 漂移诊断）。
2. Python 对照实现自洽：球面样条在电极点上复现、盲测表重算、
   MNE 真实管线（make_inverse_operator/apply_inverse）与 numpy
   公式峰值一致（相关 > 0.98）。
3. 表现表：不同电极数 / 噪声 / 正则化下的盲测定位误差（偶极子拟合
   与 MNE 各给），数字见测试输出与 docs/pr6-topo-inverse.md。
   这些是估计器性质的实测报告，不是方法学容差——MNE 无深度加权
   时峰值误差本来就大（32–106 mm），测试如实报告，不放宽门槛。
"""
import json
import unittest
from pathlib import Path

import numpy as np

from scientific.eeg import inverse_reference as ir
from scientific.eeg import signal_reference as sr

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = ROOT / "tests" / "pr6" / "fixtures"
SPHERE_PATH = ROOT / "app" / "public" / "forward-assets" / "sphere-model.json"
SMALL_FIXTURE = json.loads((FIXTURE_DIR / "multitaper-ersp-small.json").read_text())
TOPO_INV_FIXTURE = json.loads((FIXTURE_DIR / "tfr-topo-inverse-reference.json").read_text())


def assert_close(test, a, b, rtol, atol, label):
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    test.assertEqual(a.shape, b.shape, f"{label}: shape {a.shape} vs {b.shape}")
    err = np.abs(a - b)
    tol = atol + rtol * np.abs(b)
    test.assertTrue(np.all(err <= tol),
                    f"{label}: max err {err.max():.3e} at {np.unravel_index(int(np.argmax(err)), err.shape)}")


def require_sphere(test):
    if not SPHERE_PATH.exists():
        test.skipTest(
            "Missing sphere forward fixture: app/public/forward-assets/sphere-model.json. "
            "Generate it locally with: "
            "~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py "
            "(CI generates it before running tests).")
    return ir.load_sphere_fixture(SPHERE_PATH)


class TestMultitaperErspSmallFixture(unittest.TestCase):
    def test_fixture_freshness(self):
        """重新生成小 fixture，与存量逐点比较（TS 测试读的就是这份）。"""
        fresh = ir.build_multitaper_ersp_small_fixture()
        assert_close(self, fresh["ersp_db"], SMALL_FIXTURE["ersp_db"], 0, 1e-6, "ersp_db")
        assert_close(self, fresh["itc"], SMALL_FIXTURE["itc"], 0, 1e-9, "itc")
        assert_close(self, fresh["times_ms"], SMALL_FIXTURE["times_ms"], 0, 1e-9, "times_ms")

    def test_burst_shape(self):
        """形态：20 Hz 突发在刺激后 100–300 ms 均值约 +5.73 dB、ITC ≈ 1.00。"""
        e = np.asarray(SMALL_FIXTURE["ersp_db"])
        itc = np.asarray(SMALL_FIXTURE["itc"])
        t = np.asarray(SMALL_FIXTURE["times_ms"])
        fi20 = SMALL_FIXTURE["meta"]["freqs_hz"].index(20.0)
        post = (t >= 100) & (t <= 300)
        self.assertGreater(float(e[fi20][post].mean()), 3.0)
        self.assertGreater(float(itc[fi20][post].mean()), 0.9)
        # 与 MNE tfr_multitaper 的关系：MNE 的功率口径与本模块相同
        # （窗长 7 个周期、锥 NW=4/K=7），此处只作 ERSP 形态断言，
        # 逐点对照由 TS 测试（同公式 TS 实现）承担。

    def test_multitaper_psd_agrees_with_scipy_on_same_signal(self):
        """同一突发信号的 multitaper PSD：TS/Python 共用的 scipy DPSS 口径。"""
        x = np.asarray(SMALL_FIXTURE["epochs"]["trials"][0][0])
        f, p = sr.multitaper_psd(x, 250.0, nw=4.0, k=7)
        peak = float(f[int(np.argmax(p))])
        # 20 Hz 突发 + 白噪声：谱峰应在 20 Hz 附近（±2 Hz）。
        self.assertAlmostEqual(peak, 20.0, delta=2.0)


class TestSplineTopography(unittest.TestCase):
    def test_fixture_freshness(self):
        fixture = require_sphere(self)
        fresh = ir.build_tfr_topo_inverse_fixture(SPHERE_PATH)
        topo_f, topo_s = fresh["topography"], TOPO_INV_FIXTURE["topography"]
        self.assertEqual(topo_f["labels"], topo_s["labels"])
        # 地形电极电位 atol 1e-5 µV：CI 漂移实测 2.46e-6（信号幅值
        # 0.77 µV 的 3.2e-6 相对），来自 CI 现场重算的球形正向模型
        #（MNE 四层球求解）在不同 CPU 上的差异；1e-5 仍比同文件
        # 样条复现容差 0.02 µV 严 2000 倍，科学门槛未动。
        assert_close(self, topo_f["values_uv"], topo_s["values_uv"], 0, 1e-5, "topo values")
        self.assertEqual(len(topo_f["grid"]), len(topo_s["grid"]))
        for g_f, g_s in zip(topo_f["grid"], topo_s["grid"]):
            self.assertAlmostEqual(g_f["x"], g_s["x"], places=12)
            self.assertAlmostEqual(g_f["y"], g_s["y"], places=12)
            # 网格值绝对 1e-5 µV（原 places=9）：与电极电位同口径。
            # 不能用相对容差：网格值有过零点，相对误差在过零点
            # 附近会虚大（CI 量级扰动下相对误差可达 2.45e-4，绝对
            # 误差实测最大 1.59e-6）；x/y 是纯坐标，仍要求 places=12。
            grid_err = abs(g_f["value_uv"] - g_s["value_uv"])
            self.assertLess(grid_err, 1e-5, f"grid value abs err {grid_err:.3g}")

    def test_spline_reproduces_electrode_values(self):
        """λ=1e-5 平滑样条在电极点上的复现误差 ≤ 0.02 µV（λ·|C| 量级）。"""
        topo = TOPO_INV_FIXTURE["topography"]
        vals = ir.evaluate_spline_at_electrodes(topo["positions_mm"], topo["values_uv"])
        err = np.abs(vals - np.asarray(topo["values_uv"]))
        self.assertLess(float(err.max()), 0.02)

    def test_spline_kernel_values(self):
        """核函数初值：G(1) ≈ 0.01526（7 阶截断解析和）。"""
        self.assertAlmostEqual(ir.spline_kernel_g(1.0), 0.015260662048995111, places=12)
        # G(1) > G(0)：同点自相关最强（核函数定性检查）。
        self.assertGreater(ir.spline_kernel_g(1.0), ir.spline_kernel_g(0.0))


class TestBlindInverse(unittest.TestCase):
    def test_blind_table_freshness(self):
        """盲测表重算，与存量逐项比较（TS 测试读的就是这份表）。"""
        fixture = require_sphere(self)
        fresh = ir.build_tfr_topo_inverse_fixture(SPHERE_PATH)
        for b_f, b_s in zip(fresh["blind"], TOPO_INV_FIXTURE["blind"]):
            self.assertEqual(b_f["dipole"]["estimated_position_mm"],
                             b_s["dipole"]["estimated_position_mm"])
            assert_close(self, b_f["dipole"]["estimated_moment_nAm"],
                         b_s["dipole"]["estimated_moment_nAm"], 0, 1e-9, "dipole moment")
            self.assertAlmostEqual(b_f["dipole"]["residual_rms_uv"],
                                   b_s["dipole"]["residual_rms_uv"], places=9)
            self.assertEqual(b_f["mne"]["estimated_position_mm"],
                             b_s["mne"]["estimated_position_mm"])
            # peak_value 相对 1e-5（原 places=6）：同 spread，CI 现场
            # 重算的增益差异会让峰值漂 ~3e-6 相对；位置分量仍要求
            # 精确相等，真实回归会被位置断言抓住。
            peak_err = abs(b_f["mne"]["peak_value"] - b_s["mne"]["peak_value"]) / max(
                1e-12, abs(b_s["mne"]["peak_value"]))
            self.assertLess(peak_err, 1e-5, f"mne peak rel err {peak_err:.3g}")
            # spread 相对 1e-5：CI 漂移 6.96e-6 mm（78.1 mm 的 8.9e-8
            # 相对），来自增益矩阵的跨 CPU 差异经 MNE 逆解放大；1e-5
            # 相对仍比盲测的科学量级（分布范围几十 mm）严 6 个量级，
            # 且位置分量仍要求精确相等，真实回归会被位置断言抓住。
            spread_err = abs(b_f["mne"]["spread_mm"] - b_s["mne"]["spread_mm"]) / max(
                1e-12, abs(b_s["mne"]["spread_mm"]))
            self.assertLess(spread_err, 1e-5,
                            f"mne spread rel err {spread_err:.3g}")

    def test_mne_operator_peak_matches_numpy_formula(self):
        """MNE 真实管线与 numpy 公式：峰值网格点相同、估计向量相关 > 0.98。

        不逐点比：MNE 内部的 SVD/白化管线使估计向量与 numpy 公式差
        到 0.04–0.27 nA·m（峰值的 ~20%），但相关 0.990–0.995、峰值
        网格点三例全同。只断言峰值与相关，不虚报逐点一致。
        """
        fixture = require_sphere(self)
        for true_pos, true_mom in (([-16.0, -16.0, -16.0], [0.0, 10.0, 0.0]),
                                    ([-16.0, 16.0, 48.0], [10.0, 0.0, 0.0]),
                                    ([48.0, 48.0, 48.0], [0.0, 0.0, 10.0])):
            data, _ = ir.forward_eeg(fixture, "10-20", true_pos, true_mom, "average")
            L, _, _ = ir.lead_field_matrix(fixture, "10-20", "average")
            inv_np = ir.mne_inverse(L, data, lambda2=ir.MNE_LAMBDA2_DEFAULT)
            op = ir.mne_operator_estimate(fixture, "10-20", data,
                                          lambda2=ir.MNE_LAMBDA2_DEFAULT)
            self.assertEqual(op["peak_grid_index"], inv_np["grid_index"],
                             f"true {true_pos}: MNE operator peak != numpy peak")
            est_np = np.asarray(inv_np["source_moments"]).ravel()
            corr = float(np.corrcoef(op["estimate_nAm"], est_np)[0, 1])
            self.assertGreater(corr, 0.98, f"true {true_pos}: corr {corr:.4f}")

    def test_forward_eeg_matches_fixture_gain(self):
        """forward_eeg（网格点上）= fixture 增益直接点乘（平均参考后）。"""
        fixture = require_sphere(self)
        data, labels = ir.forward_eeg(fixture, "10-20", [16.0, 16.0, 16.0],
                                      [0.0, 10.0, 5.0], "average")
        gains = np.asarray(fixture["gain_uv_per_nAm"])
        idx = [[s["label"] for s in fixture["sensors"]].index(lb) for lb in labels]
        grid = ir.source_grid_positions_mm()
        gi = int(np.where((grid == [16.0, 16.0, 16.0]).all(axis=1))[0][0])
        expect = gains[idx, 3 * gi:3 * gi + 3] @ np.array([0.0, 10.0, 5.0])
        expect = expect - expect.mean()
        assert_close(self, data, expect, 0, 1e-9, "forward_eeg vs fixture gain")

    def test_performance_table(self):
        """表现表：不同电极数 / 噪声 / 正则化下的盲测定位误差。

        数字打印出来供汇报引用；断言只卡住定性结论（偶极子拟合
        无噪声精确、MNE 表浅源精确、噪声下残差≈噪声水平），不把
        “MNE 误差大”这个实测结论写成失败。
        """
        fixture = require_sphere(self)
        rows = []
        for montage in ("10-20", "10-10", "10-05"):
            for true_pos, true_mom in (([-16.0, -16.0, -16.0], [0.0, 10.0, 0.0]),
                                        ([48.0, 48.0, 48.0], [0.0, 0.0, 10.0])):
                for noise, lam2 in ((0.0, ir.MNE_LAMBDA2_DEFAULT),
                                    (0.5, ir.MNE_LAMBDA2_DEFAULT),
                                    (0.5, 0.01)):
                    res = ir.blind_test(fixture, montage, true_pos, true_mom,
                                        noise_rms_uv=noise, seed=7, lambda2=lam2)
                    rows.append((montage, tuple(true_pos), noise, lam2,
                                 res["dipole"]["localization_error_mm"],
                                 res["dipole"]["residual_rms_uv"],
                                 res["mne"]["localization_error_mm"],
                                 res["mne"]["spread_mm"]))
        print("\n  montage  true_pos            noise lam2   dipErr  dipResid  mneErr  mneSpread")
        for r in rows:
            print(f"  {r[0]:<7} {str(r[1]):<20} {r[2]:.1f}   {r[3]:.4g}  {r[4]:5.1f}  {r[5]:.3f}    {r[6]:5.1f}  {r[7]:5.1f}")
        for r in rows:
            if r[2] == 0.0:
                # 无噪声：偶极子拟合精确恢复（模型正确时）。
                self.assertEqual(r[4], 0.0, f"{r[0]} {r[1]} noiseless dipole error")
                self.assertLess(r[5], 1e-9, f"{r[0]} {r[1]} noiseless dipole residual")
            else:
                # 有噪声：残差≈噪声水平（0.5 µV ± 0.2）。
                self.assertGreater(r[5], 0.3, f"{r[0]} {r[1]} noisy residual")
                self.assertLess(r[5], 0.7, f"{r[0]} {r[1]} noisy residual")
        # 表浅角源（[48,48,48]）无噪声时 MNE 也精确；深部源不精确（见文档）。
        for r in rows:
            if r[2] == 0.0 and r[1] == (48.0, 48.0, 48.0):
                self.assertEqual(r[6], 0.0, f"{r[0]} corner source MNE error")


if __name__ == "__main__":
    unittest.main()

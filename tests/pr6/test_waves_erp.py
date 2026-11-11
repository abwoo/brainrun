"""PR6 (B2) — WAVES / ERP Python 对照测试。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr6 -p 'test_waves_erp.py' -v

对照链：
- JR p0=220 alpha：scipy Welch（与 TS welchPsd 同口径）+ ds003061 实测值。
- 晚期机制：SciPy DOP853（本模块的独立实现）+ TS fixture 回归
  （live 计算 vs 已提交的 late-response-reference.json）。
- ERP：同一份 oddball 记录经 MNE Epochs/Evoked（独立实现）与本模块
  的 numpy 计算（erp_metrics）逐项对照。
- 试次数量效应：SEM 随试次数缩小（测量噪声，numpy 种子复现）。

幅度差距不断言“通过”：模型 oddball 峰 0.17 µV vs 真实 8.89 µV
是结构性缺口，测试只断言它没有被重缩放修掉（见 test_no_rescaling）。
"""
import json
import unittest
from pathlib import Path

import numpy as np

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scientific" / "eeg"))
import late_response_reference as L

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "tests/pr6/fixtures/late-response-reference.json").read_text())
CONSTRAINT = json.loads(
    (ROOT / "scientific/forward/public_eeg_reference_values.json").read_text())


class TestAlphaLimitCycle(unittest.TestCase):
    def test_welch_peak_matches_fixture_and_real_alpha_band(self):
        alpha = L.run_alpha_limit_cycle()
        fx = FIXTURE["alpha_limit_cycle"]
        self.assertAlmostEqual(alpha["y0_welch"]["alpha_peak_hz"],
                               fx["y0_alpha_peak_hz"], places=6)
        self.assertAlmostEqual(alpha["pz_welch"]["alpha_peak_hz"],
                               fx["pz_alpha_peak_hz"], places=6)
        # 峰在 alpha 频段内；与 ds003061 Pz 10.00 Hz 差 +0.99 Hz、Oz 9.25 Hz 差 +1.74 Hz。
        peak = alpha["y0_welch"]["alpha_peak_hz"]
        self.assertGreaterEqual(peak, 8.0)
        self.assertLessEqual(peak, 13.0)
        real_pz = CONSTRAINT["measured"]["psd"]["channels"]["Pz"]["alpha_band_peak_hz_4_13"]
        real_oz = CONSTRAINT["measured"]["psd"]["channels"]["Oz"]["alpha_band_peak_hz_4_13"]
        self.assertAlmostEqual(peak - real_pz, 0.99, places=1)
        self.assertAlmostEqual(peak - real_oz, 1.74, places=1)
        # 纯极限环：alpha 占 1–40 Hz 功率 ~99.8%（真实 Pz 30.3%、Oz 69.3%——
        # 模型无宽带背景，占比虚高，如实记录，不修）。
        share = alpha["y0_welch"]["band_share_pct_of_1_40_hz"]["alpha"]
        self.assertGreater(share, 95.0)
        self.assertAlmostEqual(share, 99.8, delta=0.5)
        # Pz RMS 0.017 µV vs 真实基线 RMS 6.07 µV：幅度仍差 ~360 倍。
        self.assertAlmostEqual(alpha["pz_welch"]["rms"], 0.0167, delta=0.002)
        self.assertLess(alpha["pz_welch"]["rms"], 0.1)


class TestLateResponse(unittest.TestCase):
    def test_oddball_late_component_morphology(self):
        odd = L.simulate_late_trial(L.ODDBALL_DRIVE_PER_S, t_end_ms=2000.0)
        std = L.simulate_late_trial(L.STANDARD_DRIVE_PER_S, t_end_ms=2000.0)
        m_odd = L.erp_metrics(odd["t_ms"], odd["pz_uv"])
        m_std = L.erp_metrics(std["t_ms"], std["pz_uv"])
        # 与 TS 同窗同口径：oddball 峰 0.174 µV @352 ms、窗均值 0.0697 µV。
        self.assertAlmostEqual(m_odd["peak_uv"], 0.174, delta=0.005)
        self.assertAlmostEqual(m_odd["peak_latency_ms"], 352.0, delta=4.0)
        self.assertAlmostEqual(m_odd["window_mean_uv"], 0.0697, delta=0.005)
        # standard 窗均值 <0.02 µV；oddball 选择性 >5 倍。
        self.assertLess(m_std["window_mean_uv"], 0.02)
        self.assertGreater(m_odd["window_mean_uv"] / m_std["window_mean_uv"], 5.0)
        # 刺激后回到基线（无锁存）。
        self.assertFalse(L.detect_latch(odd["q_nAm"], odd["t_ms"]))
        self.assertFalse(L.detect_latch(std["q_nAm"], std["t_ms"]))

    def test_latch_boundary_gain_3_safe_gain_4_latches(self):
        safe = L.simulate_late_trial(L.ODDBALL_DRIVE_PER_S, t_end_ms=2000.0, gain=3.0)
        self.assertFalse(L.detect_latch(safe["q_nAm"], safe["t_ms"]))
        latched = L.simulate_late_trial(L.ODDBALL_DRIVE_PER_S, t_end_ms=2000.0, gain=4.0)
        self.assertTrue(L.detect_latch(latched["q_nAm"], latched["t_ms"]))
        # 锁存的 q 末尾仍 ~0.85 nA·m（峰值的 ~75%），不是数值噪声。
        self.assertGreater(abs(latched["q_nAm"][-1]), 0.5)

    def test_live_matches_committed_fixture(self):
        """已提交 fixture 的回归守卫：live 计算与 fixture 一致（防漂移）。"""
        live = L.simulate_late_trial(L.ODDBALL_DRIVE_PER_S, t_end_ms=800.0)
        fx = FIXTURE["oddball_trial"]
        np.testing.assert_allclose(live["t_ms"], fx["t_ms"], rtol=0, atol=0)
        np.testing.assert_allclose(live["y0_mv"], fx["y0_mv"], rtol=0, atol=1e-9)
        np.testing.assert_allclose(live["q_nAm"], fx["q_nAm"], rtol=0, atol=1e-9)
        np.testing.assert_allclose(live["pz_uv"], fx["pz_uv"], rtol=0, atol=1e-9)

    def test_no_rescaling(self):
        """非辨识性守卫：Pz 增益是 PR5 中央值；模型峰远低于真实 P300，未被修掉。"""
        self.assertEqual(L.PZ_GAIN_UV_PER_NAM, 0.16)
        odd = L.simulate_late_trial(L.ODDBALL_DRIVE_PER_S, t_end_ms=800.0)
        m = L.erp_metrics(odd["t_ms"], odd["pz_uv"])
        real_peak = CONSTRAINT["measured"]["erp"]["oddball"]["Pz"]["p300_window_peak_uv"]
        self.assertEqual(real_peak, 8.89)
        self.assertLess(m["peak_uv"], 0.5)
        self.assertGreater(real_peak / m["peak_uv"], 40.0)


class TestErpMne(unittest.TestCase):
    def _build_recording(self, n_trials=10):
        """10 试次 oddball 记录（8 standard + 2 oddball），与 TS 的
        runOddballExperiment 同协议：ISI 1000 ms、epoch −200–800 ms、
        共享边界点（后一试次覆盖）。返回 (data_uv, events, sfreq)。"""
        per = 250
        data = np.zeros(per * n_trials + 1)
        events = []
        for k in range(n_trials):
            oddball = (k + 1) % 5 == 0
            pulse = L.ODDBALL_DRIVE_PER_S if oddball else L.STANDARD_DRIVE_PER_S
            tr = L.simulate_late_trial(pulse, t_end_ms=800.0)
            data[k * per:k * per + len(tr["pz_uv"])] = tr["pz_uv"]
            events.append((k * per + 50, 0, 2 if oddball else 1))
        return data, np.array(events, dtype=int), 250.0

    def test_mne_epochs_evoked_match_numpy(self):
        import mne
        data_uv, events, sfreq = self._build_recording()
        info = mne.create_info(["Pz"], sfreq, "eeg")
        raw = mne.io.RawArray((data_uv * 1e-6)[None, :], info, verbose=False)
        epochs = mne.Epochs(raw, events, event_id={"standard": 1, "oddball": 2},
                            tmin=-0.2, tmax=0.8, baseline=(-0.2, 0.0),
                            reject=dict(eeg=150e-6), preload=True, verbose=False)
        self.assertEqual(len(epochs["standard"]), 8)
        self.assertEqual(len(epochs["oddball"]), 2)
        self.assertEqual(len(epochs.drop_log), 10)
        for cond in ("standard", "oddball"):
            ev = epochs[cond].average()
            ch, lat_s, amp_v = ev.get_peak(ch_type="eeg", tmin=0.25, tmax=0.6,
                                           mode="abs", time_as_index=False,
                                           return_amplitude=True)
            self.assertEqual(ch, "Pz")
            # numpy 独立计算（同一份试次数据，MNE 口径 epoch/基线/平均）。
            ep = epochs[cond].get_data() * 1e6  # (n, 1, 251) µV
            mean_uv = ep.mean(axis=0)[0]
            t_ms = epochs.times * 1000.0
            m = L.erp_metrics(t_ms, mean_uv)
            self.assertAlmostEqual(amp_v * 1e6, m["peak_uv"], delta=0.01)
            self.assertAlmostEqual(lat_s * 1000.0, m["peak_latency_ms"], delta=4.0)
            # 窗均值：MNE Evoked 在 300–500 ms 内的均值 vs numpy 同窗。
            w = (t_ms >= 300) & (t_ms <= 500)
            self.assertAlmostEqual(float(ev.data[0][w].mean() * 1e6),
                                   m["window_mean_uv"], delta=0.01)
        # 差异波（oddball − standard）峰值与 numpy 一致。
        diff = epochs["oddball"].average().data - epochs["standard"].average().data
        t_ms = epochs.times * 1000.0
        m_diff = L.erp_metrics(t_ms, diff[0] * 1e6)
        self.assertGreater(m_diff["peak_uv"], 0.1)
        self.assertAlmostEqual(m_diff["window_mean_uv"], 0.0697 - 0.0086, delta=0.01)


class TestTrialCountSem(unittest.TestCase):
    def test_sem_shrinks_with_trial_count(self):
        """SEM ∝ 1/√n（测量噪声 0.25 µV，numpy 种子复现）。"""
        rng = np.random.default_rng(7)
        odd = L.simulate_late_trial(L.ODDBALL_DRIVE_PER_S, t_end_ms=800.0)
        base = odd["pz_uv"]
        t_ms = odd["t_ms"]

        def sem_in_window(n):
            """300–500 ms 窗内 SEM 的均值（单采样点的 SEM 在 n=2 时波动极大，
            窗内平均后才稳定；期望比 ≈ √(8/2) = 2）。"""
            trials = base[None, :] + rng.normal(0, 0.25, size=(n, len(base)))
            mean = trials.mean(axis=0)
            sem = trials.std(axis=0, ddof=1) / np.sqrt(n)
            m = L.erp_metrics(t_ms, mean)
            w = (t_ms >= 300) & (t_ms <= 500)
            return float(sem[w].mean()), m["window_mean_uv"]

        sem2, _ = sem_in_window(2)
        sem8, wm8 = sem_in_window(8)
        self.assertLess(sem8, sem2 * 0.75)
        # 窗均值（无偏量）在无噪声值附近；峰值本身因取最大而正偏，不作此断言。
        self.assertAlmostEqual(wm8, 0.0697, delta=0.05)


if __name__ == "__main__":
    unittest.main()

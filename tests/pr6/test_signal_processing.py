"""PR6 信号处理核心 — Python 测试（A1）。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr6 -p 'test_*.py' -v

两层验证：
1. Python 对照实现（scientific/eeg/signal_reference.py）与 scipy/MNE
   原语的独立对照——Welch 直接调 scipy、DPSS 直接调 scipy、STFT
   与 scipy.signal.stft 有确定的换算关系、Morlet 与 MNE tfr_morlet
   只差一个解析因子 2·σ_s·√π、epoch/平均与 MNE Epochs/Evoked
   逐点一致（3.6e-15 µV 量级）。
2. Fixture 新鲜度：重新生成 fixture，与 tests/pr6/fixtures/ 里
   存的逐点比较（TS 测试读的就是这份 fixture，过期即失败）。

容差与 TS 测试同量级（舍入级）：FFT/Welch/STFT/ERP 为 1e-8 相对、
Morlet/multitaper 为 1e-6 相对、ERSP 为 1e-6 dB、ITC 为 1e-9。
"""
import json
import unittest
import warnings
from pathlib import Path

import numpy as np
from scipy import signal as _signal

from scientific.eeg import signal_reference as sr

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "tests" / "pr6" / "fixtures" / "signal-reference.json").read_text())
DPSS_FIXTURE = json.loads((ROOT / "tests" / "pr6" / "fixtures" / "dpss-tapers.json").read_text())
CONSTRAINT = json.loads((ROOT / "scientific" / "forward" / "public_eeg_reference_values.json").read_text())

SFREQ = 250.0


def assert_close(test, a, b, rtol, atol, label):
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    test.assertEqual(a.shape, b.shape, f"{label}: shape {a.shape} vs {b.shape}")
    err = np.abs(a - b)
    tol = atol + rtol * np.abs(b)
    test.assertTrue(np.all(err <= tol),
                    f"{label}: max err {err.max():.3e} at {np.unravel_index(int(np.argmax(err)), err.shape)}")


class TestWelchAndBands(unittest.TestCase):
    def test_welch_matches_scipy_and_manual_formula(self):
        c = FIXTURE["welch_sine10"]
        x = np.array(c["x"])
        f, p = sr.welch_psd(x, SFREQ, n_fft=256, overlap=0.5)
        assert_close(self, f, c["freqs_hz"], 0, 1e-12, "welch freqs")
        assert_close(self, p, c["psd"], 1e-8, 1e-12, "welch psd")
        # 独立公式：|FFT|²/(fs·Σw²)，单边加倍，与 scipy 直接调用互为验证。
        n_fft = 256
        w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n_fft) / n_fft)
        step = 128
        acc = np.zeros(n_fft // 2 + 1)
        n_seg = 0
        for start in range(0, len(x) - n_fft + 1, step):
            spec = np.fft.rfft(x[start:start + n_fft] * w)
            one = (np.abs(spec) ** 2) / (SFREQ * np.sum(w ** 2))
            one[1:n_fft // 2] *= 2.0
            acc += one
            n_seg += 1
        assert_close(self, acc / n_seg, p, 1e-10, 1e-12, "welch manual formula")
        # 峰在 9.77 Hz；PSD 积分 ≈ 方差。
        self.assertAlmostEqual(float(f[int(np.argmax(p))]), 9.765625, places=9)
        df = f[1] - f[0]
        total = float(np.trapezoid(p, f))
        self.assertLess(abs(total - float(np.var(x))) / float(np.var(x)), 0.05)

    def test_band_powers(self):
        c = FIXTURE["welch_sine10"]
        bands = sr.band_powers(np.array(c["freqs_hz"]), np.array(c["psd"]))
        for band, v in c["band_powers"].items():
            self.assertAlmostEqual(bands[band], v, delta=1e-9 + 1e-8 * abs(v))
        # 10 Hz 正弦的功率几乎全在 alpha。
        self.assertGreater(bands["alpha"], 11.5)
        self.assertLess(bands["delta"], 0.05)
        self.assertLess(bands["theta"], 0.05)

    def test_fft_matches_numpy(self):
        rng = np.random.default_rng(3)
        x = rng.standard_normal(256)
        spec = sr.fft_spectrum(x, 256)
        np.testing.assert_allclose(spec, np.fft.fft(x), rtol=1e-12, atol=1e-12)


class TestStftMorlet(unittest.TestCase):
    def test_stft_matches_scipy(self):
        c = FIXTURE["stft_two_sine"]
        x = np.array(c["x"])
        r = sr.stft(x, SFREQ, n_fft=128, hop=64)
        assert_close(self, r["times_ms"], c["times_ms"], 0, 1e-9, "stft times")
        assert_close(self, r["freqs_hz"], c["freqs_hz"], 0, 1e-12, "stft freqs")
        assert_close(self, r["power"], c["power"], 1e-8, 1e-12, "stft power")
        # 与 scipy.signal.stft 的确定换算：scipy Zxx = rFFT(w·x)/Σw，
        # 本实现功率 = 2|Zxx|²（内部频点）、|Zxx|²（DC/Nyquist）。
        f2, t2, zxx = _signal.stft(x, fs=SFREQ, window="hann", nperseg=128,
                                    noverlap=64, boundary="zeros", padded=True)
        np.testing.assert_allclose(t2 * 1000, r["times_ms"], rtol=0, atol=1e-9)
        expect = 2 * np.abs(zxx) ** 2
        expect[0, :] = np.abs(zxx[0, :]) ** 2
        expect[-1, :] = np.abs(zxx[-1, :]) ** 2
        assert_close(self, r["power"], expect, 1e-9, 1e-12, "stft power vs scipy")

    def test_morlet_calibration_and_mne_factor(self):
        # 标定：纯正弦在中心频率处功率 = A²/2。
        t = np.arange(500) / SFREQ
        for freq, amp in ((10.0, 5.0), (20.0, 3.0), (5.0, 2.0)):
            x = amp * np.cos(2 * np.pi * freq * t)
            r = sr.morlet_tfr(x, SFREQ, np.array([freq]), cycles=5.0)
            med = float(np.median(r["power"][0][100:400]))
            self.assertAlmostEqual(med, amp ** 2 / 2, delta=0.02 * amp ** 2 / 2 + 0.05)
        # 与 fixture 一致。
        c = FIXTURE["morlet_two_sine"]
        r = sr.morlet_tfr(np.array(c["x"]), SFREQ, np.array(c["freqs_hz"]), cycles=5.0)
        assert_close(self, r["power"], c["power"], 1e-6, 1e-12, "morlet power")
        # 与 MNE tfr_morlet 只差解析因子 2·σ_s·√π（MNE 小波 ℓ² 范数 √2）。
        import mne
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            x = 5.0 * np.cos(2 * np.pi * 10 * t)
            data = (x * 1e-6)[None, None, :]
            info = mne.create_info(["Pz"], SFREQ, "eeg")
            ep = mne.EpochsArray(data, info, tmin=0.0, verbose=False)
            tfr = ep.compute_tfr(method="morlet", freqs=np.array([10.0]), n_cycles=5,
                                 return_itc=False, average=True, verbose=False)
            p_mne = float(np.median(tfr.data[0, 0, 100:400])) * 1e12
        sigma_s = 5 * SFREQ / (2 * np.pi * 10.0)
        factor = 2 * sigma_s * np.sqrt(np.pi)
        r_single = sr.morlet_tfr(x, SFREQ, np.array([10.0]), cycles=5.0)
        mine_single = float(np.median(r_single["power"][0][100:400]))
        self.assertAlmostEqual(p_mne / mine_single, factor, delta=0.01 * factor)

    def test_morlet_phase_tracks_sine(self):
        t = np.arange(500) / SFREQ
        x = 5.0 * np.cos(2 * np.pi * 10 * t)
        r = sr.morlet_tfr(x, SFREQ, np.array([10.0]), cycles=5.0)
        # 中心段相位应跟踪 cos 的相位（2π·10·t），环形差 < 0.01 rad。
        d = np.angle(np.exp(1j * (r["phase"][0][100:400] - 2 * np.pi * 10 * t[100:400])))
        self.assertLess(float(np.median(np.abs(d))), 0.01)


class TestDpssMultitaper(unittest.TestCase):
    def test_dpss_matches_scipy(self):
        for cs in DPSS_FIXTURE["cases"]:
            tapers = sr.dpss_tapers(cs["n"], cs["nw"], cs["k"])
            ref = np.array(cs["tapers"])
            self.assertEqual(tapers.shape, ref.shape)
            for a, b in zip(tapers, ref):
                d = min(np.max(np.abs(a - b)), np.max(np.abs(a + b)))
                self.assertLess(d, 1e-12)
            # 正交归一。
            np.testing.assert_allclose(tapers @ tapers.T, np.eye(cs["k"]), atol=1e-12)

    def test_multitaper_psd(self):
        c = FIXTURE["multitaper_sine10"]
        f, p = sr.multitaper_psd(np.array(c["x"]), SFREQ, nw=4.0, k=7)
        assert_close(self, f, c["freqs_hz"], 0, 1e-12, "mt freqs")
        assert_close(self, p, c["psd"], 1e-6, 1e-12, "mt psd")
        # 白噪声谱平坦：σ=3 → 单边 PSD 期望 2σ²/fs = 0.072。
        w = FIXTURE["multitaper_white"]
        _, pw = sr.multitaper_psd(np.array(w["x"]), SFREQ, nw=4.0, k=7)
        self.assertLess(abs(float(pw.mean()) - 0.072) / 0.072, 0.2)
        self.assertLess(float(pw.max()), 4 * float(pw.mean()))


class TestEpochAveragePeak(unittest.TestCase):
    def _fixture_epochs(self):
        rec, events = sr._synthetic_recording_and_events()
        ep = sr.epoch_recording(rec, events, -200.0, 800.0, [-200.0, 0.0],
                                reject_peak_to_peak_uv=150.0)
        return rec, events, ep

    def test_epoch_matches_mne(self):
        import mne
        rec, events, ep = self._fixture_epochs()
        avg = sr.average_epochs(ep)
        self.assertEqual(ep["kept"], [True, True, False, True, True, True, True, False])
        self.assertEqual(avg["n"], 6)
        # MNE 独立对照：RawArray（V）+ Epochs（同口径：−200–800 ms、
        # 基线 −200–0、峰峰值 150 µV 剔除）。
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            data_v = np.asarray(rec["data_uv"]) * 1e-6
            info = mne.create_info(["Pz", "Cz"], SFREQ, "eeg")
            raw = mne.io.RawArray(data_v, info, verbose=False)
            ev_arr = np.array([[int(round(ev["t_ms"] * SFREQ / 1000)), 0, 1]
                               for ev in events], dtype=int)
            mne_ep = mne.Epochs(raw, ev_arr, event_id={"oddball": 1},
                                tmin=-0.2, tmax=0.8, baseline=(-0.2, 0.0),
                                reject=dict(eeg=150e-6), preload=True, verbose=False)
            evk = mne_ep.average()
        self.assertEqual(len(mne_ep), avg["n"])
        mine_samples = [int(round(ev["t_ms"] * SFREQ / 1000))
                        for ev, k in zip(events, ep["kept"]) if k]
        self.assertEqual(mne_ep.events[:, 0].tolist(), mine_samples)
        self.assertEqual(len(evk.times), len(avg["times_ms"]))
        # 逐点一致到 1e-9 µV（双精度舍入级；实测 3.6e-15）。
        assert_close(self, evk.data * 1e6, avg["mean_uv"], 0, 1e-9, "ERP mean vs MNE")

    def test_epoch_matches_fixture(self):
        _, _, ep = self._fixture_epochs()
        avg = sr.average_epochs(ep)
        e = FIXTURE["erp"]
        self.assertEqual(ep["kept"], e["kept"])
        assert_close(self, ep["times_ms"], e["times_ms"], 0, 1e-9, "epoch times")
        self.assertEqual(len(ep["times_ms"]), 251)
        for tr_mine, tr_fix in zip(ep["trials"], e["trials"]):
            assert_close(self, tr_mine, tr_fix, 0, 1e-9, "trial")
        assert_close(self, avg["mean_uv"], e["mean_uv"], 0, 1e-9, "mean")
        assert_close(self, avg["sem_uv"], e["sem_uv"], 0, 1e-9, "sem")

    def test_peak_and_ds003061_shape(self):
        _, _, ep = self._fixture_epochs()
        avg = sr.average_epochs(ep)
        peak = sr.peak_in_window(avg["times_ms"], avg["mean_uv"][0], [250.0, 600.0])
        win = sr.peak_in_window(avg["times_ms"], avg["mean_uv"][0], [300.0, 500.0])
        self.assertAlmostEqual(peak["peak_uv"], FIXTURE["erp"]["peak_250_600_pz"]["peak_uv"], places=9)
        self.assertAlmostEqual(win["window_mean_uv"],
                               FIXTURE["erp"]["window_300_500_pz"]["window_mean_uv"], places=9)
        # 形状对照（宽松，6 试次噪声所限）：ds003061 oddball Pz
        # 峰 8.89 µV @410 ms、300–500 ms 均值 6.94 µV。
        ref = CONSTRAINT["measured"]["erp"]["oddball"]["Pz"]
        self.assertLess(abs(peak["peak_uv"] - ref["p300_window_peak_uv"]), 1.5)
        self.assertLess(abs(peak["latency_ms"] - ref["p300_window_peak_latency_ms"]), 20)
        self.assertLess(abs(win["window_mean_uv"] - ref["mean_300_500_ms_uv"]), 1.0)

    def test_peak_gaussian_analytic(self):
        times = -200.0 + np.arange(251) * 4.0
        vals = 8.89 * np.exp(-((times - 410.0) ** 2) / (2 * 78.0 ** 2))
        peak = sr.peak_in_window(times, vals, [250.0, 600.0])
        self.assertAlmostEqual(peak["peak_uv"], 8.887, delta=0.01)
        self.assertIn(peak["latency_ms"], (408.0, 412.0))
        win = sr.peak_in_window(times, vals, [300.0, 500.0])
        self.assertAlmostEqual(win["window_mean_uv"], 6.94, delta=0.15)
        neg = sr.peak_in_window(np.array([0.0, 100.0, 200.0]),
                                np.array([1.0, -5.0, 3.0]), [0.0, 200.0])
        self.assertEqual(neg["peak_uv"], -5.0)  # 绝对值口径
        self.assertEqual(neg["latency_ms"], 100.0)

    def test_average_sem_formula(self):
        ep = {"times_ms": np.array([0.0, 4.0]),
              "trials": [np.array([[1.0, 10.0]]), np.array([[2.0, 20.0]]), np.array([[3.0, 30.0]])]}
        avg = sr.average_epochs(ep)
        np.testing.assert_allclose(avg["mean_uv"], [[2.0, 20.0]], atol=1e-12)
        np.testing.assert_allclose(avg["sem_uv"], [[1 / np.sqrt(3), 10 / np.sqrt(3)]], atol=1e-12)


class TestErspItc(unittest.TestCase):
    def test_ersp_itc_matches_fixture(self):
        rec, events, ep = TestEpochAveragePeak()._fixture_epochs()
        for key, method in (("ersp_morlet", "morlet"), ("ersp_stft", "stft")):
            f = FIXTURE[key]
            r = sr.ersp_itc(ep, "Pz", np.array(f["freqs_hz"]), method, [-200.0, 0.0])
            assert_close(self, r["times_ms"], f["times_ms"], 0, 1e-9, f"{method} times")
            assert_close(self, r["ersp_db"], f["ersp_db"], 0, 1e-6, f"{method} ersp")
            assert_close(self, r["itc"], f["itc"], 0, 1e-9, f"{method} itc")
            # 基线窗内 ERSP 的时间均值 ≈ 0 dB（定义使然）。
            base_idx = np.where((r["times_ms"] >= -200) & (r["times_ms"] <= 0))[0]
            self.assertLess(float(np.abs(r["ersp_db"][:, base_idx].mean(axis=1)).max()), 1.0)

    def test_itc_phase_locked_sine_is_one(self):
        times = -200.0 + np.arange(251) * 4.0
        sine = 5 * np.cos(2 * np.pi * 10 * (times + 200) / 1000.0)
        trials = [np.array([sine]) for _ in range(6)]
        ep = {"times_ms": times, "trials": trials, "sfreq_hz": SFREQ, "channels": ["Pz"]}
        r = sr.ersp_itc(ep, "Pz", np.array([10.0]), "morlet", [-200.0, 0.0])
        med = float(np.median(r["itc"][0][100:200]))
        self.assertGreater(med, 0.99)


class TestFixtureFreshness(unittest.TestCase):
    def test_fixture_regenerates_identically(self):
        fresh = sr.build_fixture()
        # 数值逐项对照（与 TS 测试同容差）。
        assert_close(self, fresh["welch_sine10"]["psd"], FIXTURE["welch_sine10"]["psd"],
                     1e-8, 1e-12, "fresh welch psd")
        assert_close(self, fresh["multitaper_sine10"]["psd"], FIXTURE["multitaper_sine10"]["psd"],
                     1e-6, 1e-12, "fresh mt psd")
        assert_close(self, fresh["stft_two_sine"]["power"], FIXTURE["stft_two_sine"]["power"],
                     1e-8, 1e-12, "fresh stft power")
        assert_close(self, fresh["morlet_two_sine"]["power"], FIXTURE["morlet_two_sine"]["power"],
                     1e-6, 1e-12, "fresh morlet power")
        assert_close(self, fresh["erp"]["mean_uv"], FIXTURE["erp"]["mean_uv"],
                     0, 1e-9, "fresh ERP mean")
        assert_close(self, fresh["ersp_morlet"]["ersp_db"], FIXTURE["ersp_morlet"]["ersp_db"],
                     0, 1e-6, "fresh ersp morlet")
        assert_close(self, fresh["ersp_stft"]["ersp_db"], FIXTURE["ersp_stft"]["ersp_db"],
                     0, 1e-6, "fresh ersp stft")
        self.assertEqual(fresh["erp"]["kept"], FIXTURE["erp"]["kept"])
        fresh_dpss = sr.build_dpss_fixture()
        for cs_fresh, cs_stored in zip(fresh_dpss["cases"], DPSS_FIXTURE["cases"]):
            assert_close(self, cs_fresh["tapers"], cs_stored["tapers"], 0, 1e-12, "fresh dpss")


if __name__ == "__main__":
    unittest.main()

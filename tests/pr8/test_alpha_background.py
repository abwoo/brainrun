"""PR8-D item 2 — Alpha 宽带背景 Python 独立对照。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr8 -p 'test_alpha_background.py' -v

对照链：SciPy DOP853 的 JR p0=220 极限环（`scientific/eeg/
late_response_reference.py`）+ 与 TS 同 RNG/同顺序的 PR6 噪声模型
（`scientific/eeg/eeg_reference.py` 的 `generate_noise`，mulberry32）
→ scipy Welch（`scientific/eeg/signal_reference.py`）→ 频段占比。
与 TS（tests/pr8/methods-alpha-background.test.mjs）交叉核对：
纯极限环 alpha 占比 ~99.8%、叠加默认噪声后 ~13.5%。
容差取 ±2 个百分点：两边柱积分器不同（DOP853 vs RK4）且噪声
归一化在有限样本上实现，逐点一致不成立、分布一致才成立。
"""
import sys
import unittest
from pathlib import Path

import numpy as np

EEG_DIR = str(Path(__file__).resolve().parents[2] / "scientific" / "eeg")
sys.path.insert(0, EEG_DIR)
import eeg_reference as E
import late_response_reference as L
import signal_reference as SIG

DEFAULT_NOISE = {"whiteRmsUv": 2.0, "pinkRmsUv": 1.0,
                 "line50HzRmsUv": 0.5, "driftRmsUv": 0.5}


def alpha_share(x):
    x = np.asarray(x, dtype=float)
    xc = x - np.mean(x)
    freqs, psd = SIG.welch_psd(xc, 250.0, n_fft=1024, overlap=0.5)
    bands = SIG.band_powers(freqs, psd)
    total = sum(bands[b] for b in ("delta", "theta", "alpha", "beta", "gamma"))
    alpha = (freqs >= 8) & (freqs <= 13)
    peak_hz = float(freqs[alpha][int(np.argmax(psd[alpha]))])
    return bands["alpha"] / total, peak_hz, float(np.sqrt(np.mean(xc ** 2)))


class TestAlphaBackground(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lc = L.run_alpha_limit_cycle()
        cls.pz = np.asarray(cls.lc["pz_uv"], dtype=float)

    def test_pure_limit_cycle_alpha_share(self):
        share, peak_hz, rms_uv = alpha_share(self.pz)
        self.assertAlmostEqual(share, 0.998, delta=0.005)
        self.assertAlmostEqual(peak_hz, 10.99, delta=0.3)
        self.assertAlmostEqual(rms_uv, 0.0167, delta=0.002)

    def test_default_noise_background_share(self):
        noise = E.generate_noise(DEFAULT_NOISE, 1, len(self.pz), 250.0, 1)
        mixed = self.pz + noise["total"][0]
        share, peak_hz, rms_uv = alpha_share(mixed)
        # TS：13.49%、RMS 2.301 µV；Python DOP853 + 同 RNG 噪声应落在 ±2pp 内。
        self.assertAlmostEqual(share, 0.135, delta=0.02)
        self.assertAlmostEqual(rms_uv, 2.30, delta=0.05)
        self.assertGreaterEqual(peak_hz, 8.0)
        self.assertLessEqual(peak_hz, 13.0)

    def test_noise_deterministic_same_seed(self):
        n1 = E.generate_noise(DEFAULT_NOISE, 1, len(self.pz), 250.0, 1)
        n2 = E.generate_noise(DEFAULT_NOISE, 1, len(self.pz), 250.0, 1)
        np.testing.assert_array_equal(n1["total"], n2["total"])


if __name__ == "__main__":
    unittest.main()

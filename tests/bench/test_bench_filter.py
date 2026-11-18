"""Phase 1 闭环实验台 — 带通滤波 Python 行为对照（implementation-plan.md §1.2）。

与 TS `signalProcessing.ts` 的 `bandpassFilter` 同公式独立实现：
窗函数 sinc FIR（Hamming），带通 = 低通(highHz) − 低通(lowHz)，
低通核与 `filterAndDecimate` 的 129-tap Hamming sinc 同式，
中心化零相位、等长输出、边缘零填充。

断言与 node 测试 `tests/bench/bench-filter.test.mjs` 同一组：
10 Hz 正弦通过（增益 0.9–1.1）、100 Hz 在 sfreq 250 / low 0.5 /
high 40 下衰减 > 40 dB、直流被去掉。不要求系数逐位相等。

跑法：~/workspace/eeg-venv/bin/python -m unittest tests.bench.test_bench_filter -v
（或直接 python tests/bench/test_bench_filter.py）。
"""

import unittest

import numpy as np


def lowpass_kernel(cutoff_hz, sfreq_hz, taps=129):
    half = (taps - 1) // 2
    fc = cutoff_hz / sfreq_hz
    j = np.arange(taps)
    k = j - half
    with np.errstate(divide="ignore", invalid="ignore"):
        sinc = np.sin(2 * np.pi * fc * k) / (np.pi * k)
    sinc[k == 0] = 2 * fc
    kernel = sinc * (0.54 - 0.46 * np.cos(2 * np.pi * j / (taps - 1)))
    return kernel / kernel.sum()


def bandpass_filter(samples, low_hz, high_hz, sfreq_hz, taps=129):
    samples = np.asarray(samples, dtype=float)
    kernel = lowpass_kernel(high_hz, sfreq_hz, taps) - lowpass_kernel(low_hz, sfreq_hz, taps)
    padded = np.concatenate([np.zeros((taps - 1) // 2), samples, np.zeros((taps - 1) // 2)])
    return np.convolve(padded, kernel, mode="valid")


def rms(x):
    return float(np.sqrt(np.mean(np.asarray(x, dtype=float) ** 2)))


SFREQ = 250


def sine(freq_hz, seconds=2.0, amplitude=1.0):
    n = int(round(seconds * SFREQ))
    t = np.arange(n) / SFREQ
    return amplitude * np.sin(2 * np.pi * freq_hz * t)


def central(x, edge=100):
    return x[edge:len(x) - edge]


class TestBenchBandpassFilter(unittest.TestCase):
    def test_10hz_passes(self):
        sig = sine(10)
        out = bandpass_filter(sig, 0.5, 40, SFREQ)
        self.assertEqual(len(out), len(sig))
        gain = rms(central(out)) / rms(central(sig))
        self.assertGreaterEqual(gain, 0.9)
        self.assertLessEqual(gain, 1.1)

    def test_100hz_attenuated_more_than_40db(self):
        sig = sine(100)
        out = bandpass_filter(sig, 0.5, 40, SFREQ)
        ratio = rms(central(out)) / rms(central(sig))
        db = 20 * np.log10(ratio)
        self.assertLess(db, -40)

    def test_dc_removed(self):
        out = bandpass_filter(np.ones(500), 0.5, 40, SFREQ)
        self.assertLess(rms(central(out)), 0.01)


if __name__ == "__main__":
    unittest.main()

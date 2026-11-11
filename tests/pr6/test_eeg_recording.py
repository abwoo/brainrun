"""PR-07 多导 EEG — Python 测试（B1）。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr6 -p 'test_*.py' -v

两层验证：
1. Python 对照实现（scientific/eeg/eeg_reference.py）自身的性质：
   参考三模式差异、噪声 RMS 与种子复现、投影线性、导联切换、
   事件表、全跑形状与种子复现。
2. Fixture 新鲜度：重新生成 tests/pr6/fixtures/
   eeg-recording-reference.json，与存量逐值比较（TS 测试读的
   就是这份 fixture，过期即失败）。

容差：与 TS 测试同口径。噪声逐值对照的 TS/Python 差异实测
≤ 8e-14（V8 与 CPython 的 sin/cos 末位差异），容差取 1e-9 相对；
柱模型 q(t) 用 DOP853，TS 的 RK4 与之差 WC 2.0e-6 nA·m、
JR 1.9e-8 nA·m（见 TS 测试），本文件内 DOP853 自身的确定性
对照（同参数两次运行）用 1e-12 相对。
"""
import json
import math
import unittest
from pathlib import Path

import numpy as np

from scientific.eeg import eeg_reference as er

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = ROOT / "tests" / "pr6" / "fixtures" / "eeg-recording-reference.json"

NOISE = dict(er.DEFAULT_NOISE)
LABELS_10_20 = er.LABELS_10_20


def assert_close(test, a, b, rtol, atol, label):
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    test.assertEqual(a.shape, b.shape, f"{label}: shape {a.shape} vs {b.shape}")
    err = np.abs(a - b)
    tol = atol + rtol * np.abs(b)
    test.assertTrue(np.all(err <= tol),
                    f"{label}: max err {err.max():.3e} at "
                    f"{np.unravel_index(int(np.argmax(err)), err.shape)}")
    return float(err.max())


def assert_close_recursive(test, a, b, rtol, atol, label):
    if isinstance(a, dict):
        test.assertEqual(set(a), set(b), f"{label}: keys")
        for k in a:
            assert_close_recursive(test, a[k], b[k], rtol, atol, f"{label}.{k}")
    elif isinstance(a, list):
        test.assertEqual(len(a), len(b), f"{label}: length")
        for i, (x, y) in enumerate(zip(a, b)):
            assert_close_recursive(test, x, y, rtol, atol, f"{label}[{i}]")
    elif isinstance(a, float) or isinstance(b, float):
        test.assertTrue(abs(float(a) - float(b)) <= atol + rtol * abs(float(b)),
                        f"{label}: {a} vs {b}")
    else:
        test.assertEqual(a, b, f"{label}: {a} vs {b}")


class TestRng(unittest.TestCase):
    def test_mulberry32_first_values_match_ts(self):
        # 与 TS mulberry32(1) 逐位相同（IEEE-754 双精度，见 TS 测试同款硬编码）。
        rng = er.mulberry32(1)
        self.assertEqual([rng() for _ in range(5)],
                         [0.6270739405881613, 0.002735721180215478,
                          0.5274470399599522, 0.9810509674716741,
                          0.9683778982143849])
        rng = er.mulberry32(1)
        self.assertEqual([er.gaussian(rng) for _ in range(3)],
                         [0.9659740590152261, 1.1231041937525543,
                          -0.049227862786499016])

    def test_different_seeds_differ(self):
        a = er.mulberry32(1)
        b = er.mulberry32(2)
        self.assertNotEqual([a() for _ in range(5)], [b() for _ in range(5)])


class TestReference(unittest.TestCase):
    def setUp(self):
        self.fixture = er.make_synthetic_fixture()
        self.labels = LABELS_10_20
        t = np.arange(0, 2000 + 1, 4, dtype=float) / 1000.0
        self.q = 1.5 * np.sin(2 * np.pi * 8.0 * t) + 0.8 * np.sin(2 * np.pi * 23.0 * t)
        self.v_inf = er.project_moments(self.fixture, (0, 0, 16), (0, 0, 1),
                                        self.q, "10-20")

    def test_three_modes_differ_and_properties(self):
        v_avg = er.apply_reference(self.v_inf, ("average", None))
        v_el = er.apply_reference(self.v_inf, ("electrode", "Cz", self.labels))
        v_inf = er.apply_reference(self.v_inf, ("infinity", None))
        np.testing.assert_array_equal(v_inf, self.v_inf)
        # 三者两两最大差都 > 0.01 µV（R4 的数值要求）。
        for a, b, name in [(v_avg, v_inf, "avg-inf"), (v_avg, v_el, "avg-el"),
                           (v_inf, v_el, "inf-el")]:
            self.assertGreater(np.max(np.abs(a - b)), 0.01, name)
        # 平均参考：每采样点跨通道均值 ≈ 0。
        np.testing.assert_allclose(v_avg.mean(axis=0), 0.0, atol=1e-9)
        # 电极参考：Cz 行全零。
        np.testing.assert_array_equal(v_el[self.labels.index("Cz")], 0.0)
        # 未知电极抛错。
        with self.assertRaises(ValueError):
            er.apply_reference(self.v_inf, ("electrode", "NoSuch", self.labels))


class TestNoise(unittest.TestCase):
    def test_component_rms_exact_and_total_quadrature(self):
        gen = er.generate_noise(NOISE, 19, 501, 250.0, 7)
        for kind, target in [("white", 2.0), ("pink", 1.0),
                             ("line50", 0.5), ("drift", 0.5)]:
            comp = gen["components"][kind]
            self.assertIn("非神经源", comp["label"], f"{kind} must be labelled non-neural")
            for c in range(19):
                r = er._rms(comp["data"][c])
                self.assertAlmostEqual(r, target, delta=1e-9 * target,
                                       msg=f"{kind} ch{c} RMS {r} vs {target}")
        total_rms = er._rms(gen["total"][0])
        expect = math.sqrt(4 + 1 + 0.25 + 0.25)
        self.assertLess(abs(total_rms - expect) / expect, 0.05)
        # 全零参数 → 全零噪声。
        zero = er.generate_noise({"whiteRmsUv": 0.0, "pinkRmsUv": 0.0,
                                  "line50HzRmsUv": 0.0, "driftRmsUv": 0.0},
                                 3, 100, 250.0, 1)
        np.testing.assert_array_equal(zero["total"], 0.0)
        with self.assertRaises(ValueError):
            er.generate_noise({"whiteRmsUv": -1.0}, 3, 100, 250.0, 1)

    def test_seed_reproduction(self):
        a = er.generate_noise(NOISE, 19, 501, 250.0, 7)
        b = er.generate_noise(NOISE, 19, 501, 250.0, 7)
        np.testing.assert_array_equal(a["total"], b["total"])
        c = er.generate_noise(NOISE, 19, 501, 250.0, 8)
        self.assertFalse(np.array_equal(c["total"], a["total"]))


class TestProjectionAndMontage(unittest.TestCase):
    def test_linearity_and_montage_counts(self):
        fixture = er.make_synthetic_fixture()
        t = np.arange(0, 2000 + 1, 4, dtype=float) / 1000.0
        q1 = np.sin(2 * np.pi * 8.0 * t)
        q2 = 0.5 * np.sin(2 * np.pi * 23.0 * t + 1.0)
        v1 = er.project_moments(fixture, (0, 0, 16), (0, 0, 1), q1, "10-20")
        v2 = er.project_moments(fixture, (0, 0, 16), (0, 0, 1), q2, "10-20")
        v12 = er.project_moments(fixture, (0, 0, 16), (0, 0, 1), q1 + q2, "10-20")
        np.testing.assert_allclose(v12, v1 + v2, rtol=1e-12, atol=1e-12)
        self.assertEqual(len(er.channels_for_montage(fixture, "10-20")), 19)
        self.assertEqual(len(er.channels_for_montage(fixture, "10-10")), 25)
        self.assertEqual(len(er.channels_for_montage(fixture, "10-05")), 25)
        labels1010 = {c["label"] for c in er.channels_for_montage(fixture, "10-10")}
        self.assertTrue(set(LABELS_10_20) <= labels1010)
        # 通道位置在 95 mm 球面上。
        for ch in er.channels_for_montage(fixture, "10-20"):
            self.assertAlmostEqual(np.linalg.norm(ch["positionMm"]), 95.0, delta=0.01)


class TestRunExperiment(unittest.TestCase):
    def setUp(self):
        self.fixture = er.make_synthetic_fixture()

    def test_shapes_events_and_reference_modes(self):
        res = er.run_experiment(self.fixture, duration_ms=2000, source_model="wc",
                                noise=NOISE, seed=7)
        self.assertEqual(res["data_uv"].shape, (19, 501))
        self.assertEqual(res["raw_uv"].shape, (19, 501))
        self.assertEqual(len(res["times_ms"]), 501)
        self.assertEqual(res["events"],
                         [{"id": 0, "type": "pulse", "tMs": 1000.0,
                           "condition": "standard", "drive": 1.0, "driveUnit": "wc"}])
        self.assertEqual(res["reference"], {"mode": "average"})
        # 三种参考数值各不相同（R4）。
        outs = {}
        for ref in [(("average", None)), (("infinity", None)),
                    (("electrode", "Cz"))]:
            outs[ref[0]] = er.run_experiment(
                self.fixture, duration_ms=2000, source_model="wc",
                reference=ref, noise=NOISE, seed=7)["data_uv"]
        for a, b in [("average", "infinity"), ("average", "electrode"),
                     ("infinity", "electrode")]:
            self.assertGreater(np.max(np.abs(outs[a] - outs[b])), 0.01, f"{a}-{b}")

    def test_event_schedule_long_run(self):
        res = er.run_experiment(self.fixture, duration_ms=10000, source_model="wc")
        self.assertEqual([e["tMs"] for e in res["events"]],
                         [1000.0, 2000.0, 3000.0, 4000.0, 5000.0,
                          6000.0, 7000.0, 8000.0, 9000.0])
        self.assertEqual([e["condition"] for e in res["events"]],
                         ["standard", "oddball"] * 4 + ["standard"])

    def test_seed_reproduction_and_noise_difference(self):
        a = er.run_experiment(self.fixture, duration_ms=2000, source_model="wc",
                              noise=NOISE, seed=7)
        b = er.run_experiment(self.fixture, duration_ms=2000, source_model="wc",
                              noise=NOISE, seed=7)
        np.testing.assert_array_equal(a["data_uv"], b["data_uv"])
        c = er.run_experiment(self.fixture, duration_ms=2000, source_model="wc",
                              noise=NOISE, seed=8)
        self.assertFalse(np.array_equal(c["data_uv"], a["data_uv"]))
        # 有噪声 − 无噪声 = 已参考的噪声总和（参考变换线性）。
        clean = er.run_experiment(self.fixture, duration_ms=2000, source_model="wc")
        gen = er.generate_noise(NOISE, 19, 501, 250.0, 7)
        labels = [c for c in a["channels"]]
        expect_diff = er.apply_reference(gen["total"], ("average", None))
        assert_close(self, a["data_uv"] - clean["data_uv"], expect_diff,
                     1e-9, 1e-12, "noisy-clean == referenced noise")
        self.assertEqual(labels, LABELS_10_20)

    def test_linearity_both_vs_single(self):
        pos = (0.0, 0.0, 16.0)
        common = dict(fixture=self.fixture, duration_ms=2000,
                      reference=("infinity", None), noise=None,
                      source_position_mm=pos)
        wc = er.run_experiment(source_model="wc", **common)
        jr = er.run_experiment(source_model="jr", **common)
        both = er.run_experiment(source_model="both", second_source_position_mm=pos,
                                 **common)
        np.testing.assert_allclose(both["data_uv"], wc["data_uv"] + jr["data_uv"],
                                   rtol=1e-9, atol=1e-12)

    def test_jr_q_matches_fixture(self):
        stored = json.loads(FIXTURE_PATH.read_text())
        res = er.run_experiment(self.fixture, duration_ms=2000, source_model="jr")
        assert_close(self, res["q_series"]["jr"], stored["run_jr_q_nAm"],
                     1e-12, 1e-12, "JR q determinism")


class TestFixtureFreshness(unittest.TestCase):
    def test_regenerated_fixture_matches_stored(self):
        stored = json.loads(FIXTURE_PATH.read_text())
        fresh = er.generate_fixture()
        assert_close_recursive(self, fresh, stored, 1e-12, 1e-15, "fixture")


if __name__ == "__main__":
    unittest.main()

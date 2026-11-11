"""PR-15 — 双脑对照、时间机器、闭环控制 Python 对照测试。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr7 -p 'test_experiments.py' -v

对照链：
- 本模块的独立实现（`reference/python-model/experiments_pr7.py`，
  纯 Python RK4）vs TS（`app/src/lib/experiments.ts`）：
  同一自由运行逐值一致到 1e-15 量级（fixture 回归，见 TS 测试）。
- 本文件断言 Python 自身的性质（确定性、分支重现、PID 收敛、
  阈值触发、误触发率、稳定性）+ 与已提交的
  `tests/pr7/fixtures/experiments-reference.json` 逐项一致
  （fixture 由 experiments_pr7.py --write-fixture 生成；改动实现后
  须重生成并检查数值变化是否合理，不许悄悄改期望）。
- 60 s 稳定性在 Python 里只跑 20 s（纯 Python RK4 较慢；TS 测试
  跑满 60 s，同一控制律）。
- 源定位对照不在本文件：它依赖 MNE 球形正向模型，由 TS 测试覆盖
  （与 PR6 的 blindTest 同口径）。
"""

import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "reference" / "python-model"))
import experiments_pr7 as E

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "tests/pr7/fixtures/experiments-reference.json").read_text())

FREE_CFG = dict(duration_ms=2000.0,
                events=[dict(t_ms=1000.0, drive_per_s=120.0, duration_ms=100.0)])
THR_CFG = dict(base=dict(duration_ms=3000.0,
                         events=[dict(t_ms=1000.0, drive_per_s=300.0, duration_ms=100.0)]),
               feature=dict(kind="instant"),
               controller="threshold",
               threshold=dict(threshold=0.1, output_per_s=-80.0),
               measurement_noise_rms_uv=0.02, noise_seed=7)


def max_abs_diff(a, b):
    return max(abs(x - y) for x, y in zip(a, b))


class TestDeterminism(unittest.TestCase):
    def test_same_config_twice_identical(self):
        a = E.run_single_experiment(FREE_CFG)
        b = E.run_single_experiment(FREE_CFG)
        self.assertEqual(a["y0_mv"], b["y0_mv"])
        self.assertEqual(a["q_nAm"], b["q_nAm"])

    def test_free_run_matches_fixture(self):
        run = E.run_single_experiment(FREE_CFG)
        fr = FIXTURE["free_run"]
        self.assertLess(max_abs_diff(run["y0_mv"][::8], fr["y0_4ms"]), 1e-12)
        self.assertLess(max_abs_diff(run["q_nAm"][::8], fr["q_nAm_4ms"]), 1e-12)
        self.assertLess(max_abs_diff(run["eeg_uv_pz"], fr["eeg_uv_pz"]), 1e-12)

    def test_indexed_noise_matches_ts_values(self):
        self.assertAlmostEqual(E.splitmix32_uniform(7, 0), 0.13706416846252978, places=12)
        self.assertAlmostEqual(E.indexed_gaussian(7, 0), -1.9002125408373438, places=12)


class TestAB(unittest.TestCase):
    def test_same_config_zero_difference(self):
        ab = E.run_ab(FREE_CFG, FREE_CFG)
        c = ab["comparison"]
        self.assertEqual(c["max_abs_y0_diff_mv"], 0.0)
        self.assertEqual(c["peak_y0_diff_mv"], 0.0)
        self.assertEqual(c["rms_eeg_diff_uv"], 0.0)

    def test_changed_drive_quantified_difference(self):
        ab = E.run_ab(FREE_CFG, dict(duration_ms=2000.0,
                                      events=[dict(t_ms=1000.0, drive_per_s=300.0, duration_ms=100.0)]))
        c = ab["comparison"]
        fx = FIXTURE["ab_comparison"]
        self.assertAlmostEqual(c["peak_y0_diff_mv"], fx["peak_y0_diff_mv"], places=12)
        self.assertAlmostEqual(c["erp_peak_diff_uv"], fx["erp_peak_diff_uv"], places=12)
        self.assertGreater(c["max_abs_y0_diff_mv"], 0.005)

    def test_limit_cycle_alpha_peak(self):
        lc = E.run_single_experiment(dict(duration_ms=12000.0, baseline_input_per_s=220.0,
                                          limit_cycle=True))
        seg = [y for t, y in zip(lc["times_ms"], lc["y0_mv"]) if t >= 2000.0][::8]
        peak = E._welch_peak_hz(seg)
        self.assertGreaterEqual(peak, 10.0)
        self.assertLessEqual(peak, 12.0)


class TestTimeMachine(unittest.TestCase):
    def test_branch_point_replay_exact(self):
        tm = E.TimeMachine(FREE_CFG)
        tm.step_to(2000.0)
        snap = next(s for s in tm.history if abs(s["t_ms"] - 1000.0) < 1e-9)
        tm2 = E.TimeMachine(FREE_CFG)
        tm2.restore(snap)
        tm2.step_to(2000.0)
        y1 = [s["readout"]["y0"] for s in tm.history if s["t_ms"] >= 1000.0 - 1e-9]
        y2 = [s["readout"]["y0"] for s in tm2.history if s["t_ms"] >= 1000.0 - 1e-9]
        self.assertEqual(len(y1), len(y2))
        self.assertEqual(max_abs_diff(y1, y2), 0.0)

    def test_fork_diverges_after_branch(self):
        tm = E.TimeMachine(FREE_CFG)
        tm.step_to(2000.0)
        snap = next(s for s in tm.history if abs(s["t_ms"] - 1000.0) < 1e-9)
        forked = tm.fork(snap, dict(events=[dict(t_ms=1000.0, drive_per_s=300.0, duration_ms=100.0)]))
        forked.step_to(2000.0)
        y1 = [s["readout"]["y0"] for s in tm.history if s["t_ms"] >= 1000.0 - 1e-9]
        y2 = [s["readout"]["y0"] for s in forked.history if s["t_ms"] >= 1000.0 - 1e-9]
        d = max_abs_diff(y1, y2)
        self.assertAlmostEqual(d, FIXTURE["branch"]["diverge_max_diff_mv"], places=12)
        self.assertGreater(d, 0.05)

    def test_adaptation_depresses_repeated_drives(self):
        cfg = dict(duration_ms=2000.0,
                   events=[dict(t_ms=1000.0 + 200 * k, drive_per_s=300.0, duration_ms=40.0)
                           for k in range(5)],
                   adaptation=dict(utilization=0.5, tau_rec_ms=1000.0))
        run = E.run_single_experiment(cfg)
        eff = run["effective_drives_per_s"]
        self.assertEqual(eff, FIXTURE["adaptation"]["effective_drives_per_s"])
        for i in range(1, 5):
            self.assertLess(eff[i], eff[i - 1])


class TestClosedLoop(unittest.TestCase):
    def test_pid_step_response_converges(self):
        r = E.simulate_pid_step_response(dict(kp=2.0, ki=10.0, kd=0.0, setpoint=1.0),
                                         200.0, 3000.0)
        fx = FIXTURE["pid_step"]
        self.assertAlmostEqual(r["overshoot_pct"], fx["overshoot_pct"], places=9)
        self.assertEqual(r["settling_time_ms"], fx["settling_time_ms"])
        self.assertLess(abs(r["steady_state_error"]), 1e-6)

    def test_threshold_triggers_at_expected_time(self):
        r = E.run_closed_loop(THR_CFG)
        fx = FIXTURE["threshold"]
        self.assertEqual(r["metrics"]["first_trigger_ms"], fx["first_trigger_ms"])
        self.assertEqual(r["metrics"]["response_latency_ms"], fx["response_latency_ms"])
        self.assertAlmostEqual(r["metrics"]["trigger_fraction"], fx["trigger_fraction"], places=12)

    def test_delay_shifts_first_trigger(self):
        cfg = dict(THR_CFG, delay_ms=40.0)
        r = E.run_closed_loop(cfg)
        self.assertEqual(r["metrics"]["first_trigger_ms"], 1084.0)
        self.assertEqual(r["metrics"]["response_latency_ms"], 84.0)

    def test_control_vs_no_control(self):
        ctl = E.run_closed_loop(THR_CFG)
        noctl = E.run_closed_loop(dict(base=THR_CFG["base"], controller="off"))
        fx = FIXTURE["control_vs_no_control"]
        rms_diff = ctl["metrics"]["rms_eeg_uv"] - noctl["metrics"]["rms_eeg_uv"]
        self.assertAlmostEqual(rms_diff, fx["rms_eeg_diff_uv"], places=12)
        self.assertLess(rms_diff, 0.0)

    def test_pure_noise_false_trigger_rate(self):
        r = E.run_closed_loop(dict(base=dict(duration_ms=5000.0),
                                   feature=dict(kind="alphaPower"),
                                   controller="threshold",
                                   threshold=dict(threshold=0.05, output_per_s=-80.0),
                                   measurement_noise_rms_uv=0.5, noise_seed=7))
        post = [t for t, tt in zip(r["triggered"], r["times_ms"]) if tt >= 300.0]
        frac = sum(post) / len(post)
        self.assertAlmostEqual(frac, FIXTURE["noise_only"]["post_warmup_trigger_fraction"], places=12)
        self.assertLess(frac, 0.01)

    def test_stability_bounded_20s(self):
        r = E.run_closed_loop(dict(base=dict(duration_ms=20000.0,
                                            events=[dict(t_ms=1000.0, drive_per_s=300.0, duration_ms=100.0)]),
                                     feature=dict(kind="instant"),
                                     controller="threshold",
                                     threshold=dict(threshold=0.1, output_per_s=-80.0),
                                     measurement_noise_rms_uv=0.02, noise_seed=7))
        self.assertFalse(r["metrics"]["diverged"])
        self.assertLess(r["metrics"]["max_abs_y0_mv"], 1.0)
        self.assertAlmostEqual(r["metrics"]["max_abs_y0_mv"],
                               FIXTURE["stability_20s"]["max_abs_y0_mv"], places=12)

    def test_goertzel_calibration(self):
        xs = [5 * math.sin(2 * math.pi * 10 * i / 250) for i in range(500)]
        self.assertAlmostEqual(E.goertzel_power(xs, 10.0, 250.0), 12.5, places=9)


if __name__ == "__main__":
    unittest.main()

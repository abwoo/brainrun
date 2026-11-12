"""PR8-D item 3 — 深度偏置组合方法 Python 独立对照。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr8 -p 'test_depth_pr8.py' -v

对照链：numpy 同公式（`scientific/eeg/depth_reference.py`）vs TS
（`app/src/lib/depthWeightedInverse.ts`，见
tests/pr8/methods-depth.test.mjs）。球形正向模型须先生成：
    ~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py

断言的是实测值：无噪声 depth=1.2 同时修好深浅两端；有噪声
（numpy seed-7 实现）dSPM(1.2) 深源 45.25 mm、depth=1.2 深源
96.00 mm——没有一种方法同时修好有噪声的两端。
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scientific" / "eeg"))
import depth_reference as D

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "tests/pr7/fixtures/depth-reference.json").read_text())
DEEP = [16, 16, 16]
SHALLOW = [48, 48, 48]
MOMENT = [0, 10, 5]


def combined_errors(L, V, grid_pos, true_pos, depth=1.2):
    dw = D.depth_weighted_mne(L, V, grid_pos, depth=depth)
    ds = D.dspm(L, V, grid_pos, depth=depth)
    n1 = np.asarray(dw["source_norms"], dtype=float)
    n2 = np.asarray(ds["dspm_values"], dtype=float)
    mean = 0.5 * (n1 / n1.max() + n2 / n2.max())
    prod = (n1 / n1.max()) * (n2 / n2.max())
    return (D.loc_error(grid_pos[int(np.argmax(mean))], true_pos),
            D.loc_error(grid_pos[int(np.argmax(prod))], true_pos))


class TestDepthCombinations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sphere = D.load_sphere()
        cls.L, _, cls.pos = D.build_lead_field(cls.sphere, "10-20", "average")

    def test_noiseless_depth_1_2_fixes_both_ends(self):
        for true_pos in (DEEP, SHALLOW):
            V, _ = D.forward_data(self.sphere, "10-20", true_pos, MOMENT, "average")
            dw = D.depth_weighted_mne(self.L, V, self.pos, depth=1.2)
            self.assertAlmostEqual(
                D.loc_error(dw["estimated_position_mm"], true_pos), 0.0, places=9)
            ds = D.dspm(self.L, V, self.pos, depth=1.2)
            # dSPM(1.2)：深源修好（0），浅源仍坏（55.43）——与 TS 一致。
            expected_ds = 0.0 if true_pos == DEEP else 55.43
            self.assertAlmostEqual(
                D.loc_error(ds["estimated_position_mm"], true_pos), expected_ds, places=2)
            mean_err, prod_err = combined_errors(self.L, V, self.pos, true_pos)
            self.assertAlmostEqual(mean_err, 0.0, places=9)
            self.assertAlmostEqual(prod_err, 0.0, places=9)

    def test_noisy_depth_sweep_fixture_realisation(self):
        # numpy seed-7 实现（与 depth-reference.json 的 noisy case 同数据）。
        for name, true_pos in (("deep_noisy", DEEP), ("shallow_noisy", SHALLOW)):
            want = FIXTURE["cases"][name]
            V = np.asarray(want["data_uv"], dtype=float)
            dw12 = D.depth_weighted_mne(self.L, V, self.pos, depth=1.2)
            ds12 = D.dspm(self.L, V, self.pos, depth=1.2)
            if name == "deep_noisy":
                self.assertAlmostEqual(
                    D.loc_error(dw12["estimated_position_mm"], true_pos), 96.00, places=2)
                self.assertAlmostEqual(
                    D.loc_error(ds12["estimated_position_mm"], true_pos), 45.25, places=2)
                mean_err, prod_err = combined_errors(self.L, V, self.pos, true_pos)
                self.assertAlmostEqual(mean_err, 90.51, places=2)
                self.assertAlmostEqual(prod_err, 90.51, places=2)
            else:
                self.assertAlmostEqual(
                    D.loc_error(dw12["estimated_position_mm"], true_pos), 0.0, places=9)
                self.assertAlmostEqual(
                    D.loc_error(ds12["estimated_position_mm"], true_pos), 55.43, places=2)
                mean_err, prod_err = combined_errors(self.L, V, self.pos, true_pos)
                self.assertAlmostEqual(mean_err, 0.0, places=9)
                self.assertAlmostEqual(prod_err, 0.0, places=9)

    def test_noisy_lambda_sweep_does_not_fix_deep(self):
        case = D.evaluate_case(self.sphere, "10-20", DEEP, MOMENT,
                               noise_rms_uv=0.5, noise_seed=7)
        V = np.asarray(case["data_uv"], dtype=float)
        for lam in (1 / 36, 1 / 9, 1 / 3, 1.0):
            p = D.mne_plain(self.L, V, self.pos, lambda2=lam, noise_rms_uv=0.5)
            self.assertGreaterEqual(D.loc_error(p["estimated_position_mm"], DEEP), 70.0)


if __name__ == "__main__":
    unittest.main()

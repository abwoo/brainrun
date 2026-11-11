"""Method tests for the public EEG/MEG constraint (PR5).

These tests do NOT download data and do NOT need MNE. They check the
committed summary JSON (scientific/forward/public_eeg_reference_values.json)
against:

1. the independently measured values from ds003061 sub-001 run-1, with
   tolerances that cover only numerical re-run drift (same MNE 1.11.0,
   same data, same fixed processing choices): relative 2% on amplitudes,
   5% on band shares, 1 Hz on peak frequencies, exact on counts and
   latencies (4 ms sample grid). The tolerances are stated here, not
   tuned to make anything pass: the measured gaps (12.6x / 53.8x) are
   orders of magnitude larger than any of them.
2. the WC / JR fixture waveforms in tests/pr5/fixtures/ (peak |q| and
   peak latency recomputed from the samples, tight tolerance);
3. the internal arithmetic of the comparison (model Pz uV = peak q x Pz
   gain; rescale factor = measured P300 / model Pz uV; verdicts follow
   the documented >2x bar);
4. the licence and provenance fields (CC0, ds003061, DOI) and the
   non-identifiability guard text, so a future edit cannot silently
   turn an amplitude match into a claim about cell counts.

Reproduce the JSON itself (requires the ~63 MB download once):
    python scientific/forward/public_eeg_constraint.py --data-dir <dir>

Run:
    python -m unittest discover -s tests/pr5 -p 'test_public_eeg_constraint.py' -v
"""

import json
import math
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
JSON_PATH = (REPO_ROOT / "scientific" / "forward"
             / "public_eeg_reference_values.json")
FIXTURES = REPO_ROOT / "tests" / "pr5" / "fixtures"

# Expected measured values, from public_eeg_constraint.py on ds003061
# sub-001 run-1 (MNE 1.11.0; 0.5-40 Hz; average reference; reject 150 uV).
EXPECTED = {
    "p300_peak_uv_Pz": 8.89,
    "p300_latency_ms_Pz": 410.0,
    "p300_mean_300_500_uv_Pz": 6.94,
    "diff_peak_uv_Pz": 9.14,
    "diff_latency_ms_Pz": 414.0,
    "standard_mean_300_500_uv_Pz": 0.06,
    "baseline_rms_uv_Pz": 6.07,
    "continuous_rms_uv_Pz": 8.58,
    "baseline_rms_uv_Oz": 10.02,
    "alpha_peak_hz_Pz": 10.0,
    "alpha_peak_hz_Oz": 9.25,
    "alpha_share_pct_Oz": 69.3,
    "alpha_share_pct_Pz": 30.3,
    "n1_min_uv_Cz_oddball": -2.83,
    "n1_latency_ms_Cz_oddball": 109.0,
    "epoch_counts": {"oddball": 99, "standard": 476, "noise": 103},
    "pz_gain_central": 0.160,
    "pz_gain_range": [0.130, 0.188],
    "wc_peak_q_nAm": 4.413,
    "wc_peak_latency_ms": 108.0,
    "wc_peak_pz_uv": 0.71,
    "wc_scale": 12.6,
    "jr_peak_q_nAm": 1.032,
    "jr_peak_latency_ms": 176.0,
    "jr_peak_pz_uv": 0.17,
    "jr_scale": 53.8,
}


def _close(actual, expected, rel_tol):
    return math.isclose(actual, expected, rel_tol=rel_tol)


class TestPublicEegConstraint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(JSON_PATH.read_text())
        cls.measured = cls.data["measured"]
        cls.comparison = cls.data["comparison"]

    def test_json_is_small_derived_summary(self):
        # Only KB-scale derived numbers are committed; no raw EEG.
        self.assertLess(JSON_PATH.stat().st_size, 50_000)
        self.assertEqual(self.data["schema"], "public-eeg-constraint-v1")

    def test_dataset_provenance_and_cc0_licence(self):
        ds = self.data["dataset"]
        self.assertEqual(ds["openneuro_id"], "ds003061")
        self.assertEqual(ds["doi"], "10.18112/openneuro.ds003061.v1.1.2")
        self.assertEqual(ds["license"], "CC0")
        self.assertEqual(ds["subject_used"], "sub-001")
        self.assertEqual(ds["run_used"], "run-1")
        self.assertIn("CC0", ds["license_source"])

    def test_epoch_counts(self):
        counts = self.measured["epoch_counts"]
        for cond, n in EXPECTED["epoch_counts"].items():
            self.assertEqual(counts[cond], n, cond)
        # 747 stimuli presented, 69 rejected by the 150 uV peak-to-peak bar.
        self.assertEqual(counts["rejected"], 69)
        self.assertEqual(sum(counts["presented"].values()), 747)

    def test_amplitude_constraints(self):
        amp = self.measured["amplitude"]["channels"]
        self.assertTrue(_close(amp["Pz"]["baseline_rms_pre_stimulus_uv"],
                               EXPECTED["baseline_rms_uv_Pz"], 0.02))
        self.assertTrue(_close(amp["Pz"]["continuous_rms_uv"],
                               EXPECTED["continuous_rms_uv_Pz"], 0.02))
        self.assertTrue(_close(amp["Oz"]["baseline_rms_pre_stimulus_uv"],
                               EXPECTED["baseline_rms_uv_Oz"], 0.02))

    def test_erp_p300_and_n1(self):
        odd_pz = self.measured["erp"]["oddball"]["Pz"]
        self.assertTrue(_close(odd_pz["p300_window_peak_uv"],
                               EXPECTED["p300_peak_uv_Pz"], 0.02))
        self.assertEqual(odd_pz["p300_window_peak_latency_ms"],
                         EXPECTED["p300_latency_ms_Pz"])
        self.assertTrue(_close(odd_pz["mean_300_500_ms_uv"],
                               EXPECTED["p300_mean_300_500_uv_Pz"], 0.02))
        diff_pz = self.measured["erp"]["difference_oddball_minus_standard"]["Pz"]
        self.assertTrue(_close(diff_pz["p300_window_peak_uv"],
                               EXPECTED["diff_peak_uv_Pz"], 0.02))
        self.assertEqual(diff_pz["p300_window_peak_latency_ms"],
                         EXPECTED["diff_latency_ms_Pz"])
        std_pz = self.measured["erp"]["standard"]["Pz"]
        # Standard-tone ERP is flat in the P300 window (near zero).
        self.assertLess(abs(std_pz["mean_300_500_ms_uv"]
                            - EXPECTED["standard_mean_300_500_uv_Pz"]), 0.05)
        n1_cz = self.measured["erp"]["oddball"]["Cz"]
        self.assertTrue(_close(n1_cz["n1_window_min_uv"],
                               EXPECTED["n1_min_uv_Cz_oddball"], 0.02))
        self.assertEqual(n1_cz["n1_window_min_latency_ms"],
                         EXPECTED["n1_latency_ms_Cz_oddball"])

    def test_psd_alpha_peak_and_shares(self):
        psd = self.measured["psd"]["channels"]
        self.assertAlmostEqual(psd["Pz"]["alpha_band_peak_hz_4_13"],
                               EXPECTED["alpha_peak_hz_Pz"], delta=1.0)
        self.assertAlmostEqual(psd["Oz"]["alpha_band_peak_hz_4_13"],
                               EXPECTED["alpha_peak_hz_Oz"], delta=1.0)
        self.assertTrue(_close(
            psd["Oz"]["band_power_share_pct_of_1_40_hz"]["alpha"],
            EXPECTED["alpha_share_pct_Oz"], 0.05))
        self.assertTrue(_close(
            psd["Pz"]["band_power_share_pct_of_1_40_hz"]["alpha"],
            EXPECTED["alpha_share_pct_Pz"], 0.05))
        # Eyes-closed posterior alpha dominates at Oz, not at Pz.
        self.assertGreater(
            psd["Oz"]["band_power_share_pct_of_1_40_hz"]["alpha"],
            psd["Pz"]["band_power_share_pct_of_1_40_hz"]["alpha"])

    def test_lead_field_gain_range(self):
        gain = self.data["lead_field"]
        self.assertAlmostEqual(gain["central_gain_uv_per_nAm"],
                               EXPECTED["pz_gain_central"], delta=0.005)
        self.assertEqual(gain["gain_range_uv_per_nAm"],
                         EXPECTED["pz_gain_range"])
        self.assertEqual(gain["electrode"], "Pz")
        # Cross-check against the repo's own stored sphere fixture:
        # the radial projection at grid point (-16,-48,48) must agree with
        # the independently generated gain matrix to within 5%.
        sphere = json.loads((REPO_ROOT / "app" / "public" / "forward-assets"
                             / "sphere-model.json").read_text()) \
            if (REPO_ROOT / "app" / "public" / "forward-assets"
                / "sphere-model.json").exists() else None
        if sphere is not None:
            import numpy as np
            names = [s["label"] for s in sphere["sensors"]]
            g = np.array(sphere["gain_uv_per_nAm"])
            idx = (1 * 4 + 0) * 4 + 3  # grid (-16,-48,48)
            vec = g[names.index("Pz"), 3 * idx:3 * idx + 3]
            radial = np.array([-16, -48, 48], dtype=float)
            radial /= np.linalg.norm(radial)
            stored = float(vec @ radial)
            variant = [v for v in gain["variants"]
                       if v["label"] == "parietal left, radial"][0]
            self.assertTrue(math.isclose(variant["pz_gain_uv_per_nAm"],
                                         stored, rel_tol=0.05),
                            f"direct {variant['pz_gain_uv_per_nAm']} vs "
                            f"stored fixture {stored:.3f}")

    def test_model_waveforms_match_fixtures(self):
        for key, fname, exp_q, exp_lat in (
                ("wilson_cowan", "local-column-reference.json",
                 EXPECTED["wc_peak_q_nAm"], EXPECTED["wc_peak_latency_ms"]),
                ("jansen_rit", "jansen-rit-reference.json",
                 EXPECTED["jr_peak_q_nAm"], EXPECTED["jr_peak_latency_ms"])):
            fixture = json.loads((FIXTURES / fname).read_text())
            samples = fixture["samples"]
            peak_q = max(abs(s["q_nAm"]) for s in samples)
            peak_lat = next(s["t_ms"] for s in samples
                            if abs(s["q_nAm"]) == peak_q)
            self.assertTrue(_close(peak_q, exp_q, 1e-3), (key, peak_q))
            self.assertEqual(peak_lat, exp_lat)
            stored = self.data["model_waveforms"][key]
            self.assertTrue(_close(stored["peak_abs_q_nAm"], peak_q, 1e-3))
            self.assertEqual(stored["peak_latency_ms"], peak_lat)

    def test_comparison_arithmetic_and_verdicts(self):
        gain = self.comparison["pz_gain_uv_per_nAm"]
        p300 = self.comparison["measured_reference"]["p300_peak_uv_at_Pz"]
        for key, exp_uv, exp_scale in (
                ("wilson_cowan", EXPECTED["wc_peak_pz_uv"], EXPECTED["wc_scale"]),
                ("jansen_rit", EXPECTED["jr_peak_pz_uv"], EXPECTED["jr_scale"])):
            route = self.comparison["routes"][key]
            # model Pz uV = peak q x Pz gain (rounded to 2 decimals in JSON).
            self.assertAlmostEqual(
                route["model_peak_pz_uv"],
                round(route["model_peak_q_nAm"] * gain, 2), delta=0.01)
            # rescale factor = measured P300 / model Pz uV, computed from
            # the UNROUNDED product (peak q x gain), as the script does.
            self.assertAlmostEqual(
                route["product_rescale_needed_to_match_p300_peak"],
                round(p300 / (route["model_peak_q_nAm"] * gain), 1),
                delta=0.2)
            self.assertAlmostEqual(route["model_peak_pz_uv"], exp_uv, delta=0.02)
            self.assertAlmostEqual(
                route["product_rescale_needed_to_match_p300_peak"],
                exp_scale, delta=0.5)
            # Both routes fail all three classes by far more than the 2x bar.
            self.assertEqual(route["amplitude_verdict"], "FAIL")
            self.assertEqual(route["morphology_verdict"], "FAIL")
            self.assertEqual(route["baseline_verdict"], "FAIL")
            self.assertEqual(route["frequency_verdict"], "FAIL")
            # No late component: model 300-500 ms voltage is ~0, data ~7 uV.
            self.assertLess(route["model_max_abs_q_300_500_ms_uv_at_Pz"], 0.05)
            self.assertGreater(
                abs(route["measured_mean_300_500_ms_uv"]), 5.0)

    def test_non_identifiability_guard_present(self):
        text = self.data["non_identifiability"]
        for phrase in ("non-identifiable", "N x coherence",
                       "no rescaling factor"):
            self.assertIn(phrase, text)
        # The JSON must never present a rescale as a recovered cell count:
        # the only occurrence of that phrase is inside the guard sentence
        # that explicitly denies it.
        blob = json.dumps(self.data)
        self.assertEqual(blob.count("certifies a cell count"), 1)
        self.assertIn("no rescaling factor reported here certifies a cell "
                      "count", blob)


if __name__ == "__main__":
    unittest.main()

"""PR4 cross-check — compare tests/pr4/wasm-scenarios.json (Node/WASM)
against tests/pr4/python-scenarios.json (Python reference).

Run:  python3 tests/pr4/crosscheck-compare.py   (from the repo root)
Prints the max |E| difference per scenario and the snapshot / seed
assertions.  Exits non-zero on any failure.
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "pr4"

failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def main():
    wasm = json.loads((OUT / "wasm-scenarios.json").read_text(encoding="utf-8"))
    py = json.loads((OUT / "python-scenarios.json").read_text(encoding="utf-8"))

    for tag in ("S0_spont_seed0", "S1_spont_seed1", "S2_spont_seed0_nopulse", "S3_osc"):
        a = np.array(wasm[tag]["trace"])
        b = np.array(py[tag]["trace"])
        d = float(np.abs(a - b).max())
        check(f"{tag} WASM==Python sampled E (max diff)", d < 1e-12, f"max diff {d:.3e}")

    # Seeds differ: S1 must differ from S0 in both implementations.
    d01_w = float(np.abs(np.array(wasm["S1_spont_seed1"]["trace"])
                         - np.array(wasm["S0_spont_seed0"]["trace"])).max())
    d01_p = float(np.abs(np.array(py["S1_spont_seed1"]["trace"])
                         - np.array(py["S0_spont_seed0"]["trace"])).max())
    check("seed 1 != seed 0 (WASM)", d01_w > 1e-3, f"max diff {d01_w:.4f}")
    check("seed 1 != seed 0 (Python)", d01_p > 1e-3, f"max diff {d01_p:.4f}")

    # Snapshot round-trip: restore instant state + continuation identical.
    for impl, data in (("WASM", wasm["S4_snapshot"]), ("Python", py["S4_snapshot"])):
        d_snap = float(np.abs(np.array(data["restoredE"]) - np.array(data["snapE"])).max())
        check(f"S4 snapshot restore instant E ({impl})", d_snap == 0.0, f"max diff {d_snap:.3e}")
        d_cont = float(np.abs(np.array(data["afterTrace"])
                              - np.array(data["controlTrace"])).max())
        check(f"S4 restore-then-run == uninterrupted ({impl})", d_cont == 0.0,
              f"max diff {d_cont:.3e}")

    # Quiet reset + rerun is bit-identical.
    for impl, data in (("WASM", wasm["S5_quiet_reset_rerun"]),
                       ("Python", py["S5_quiet_reset_rerun"])):
        d = float(np.abs(np.array(data["t1"]) - np.array(data["t2"])).max())
        check(f"S5 quiet reset+rerun identical ({impl})", d == 0.0, f"max diff {d:.3e}")

    # Oscillatory: mean-E FFT peak at the drive frequency (WASM side).
    mean_e = np.array(wasm["S3_osc"]["meanE"])
    tail = mean_e[200:]  # last 2 s of the 4 s run, sampled every 10 ms
    x = tail - tail.mean()
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    freqs = np.fft.rfftfreq(len(x), d=0.01)
    spec[0] = 0.0
    f_peak = float(freqs[int(np.argmax(spec))])
    ptp = float(tail.max() - tail.min())
    check("S3 oscillatory FFT peak 10 Hz (WASM)", abs(f_peak - 10.0) < 0.6,
          f"peak {f_peak:.2f} Hz, ptp {ptp:.4f}")
    check("S3 oscillatory visible but far from lock (WASM)",
          0.005 < ptp < 0.06 and float(mean_e.max()) < 0.15,
          f"ptp {ptp:.4f}, max mean E {float(mean_e.max()):.4f}")

    if failures:
        print(f"\n{len(failures)} FAILURES")
        sys.exit(1)
    print("\nall PR4 cross-checks passed")


if __name__ == "__main__":
    main()

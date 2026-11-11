"""PR4 sine-drive sizing: choose (amp, freq) for the Oscillatory preset.

The Oscillatory mode is an EXPLICITLY LABELLED external sinusoidal drive
(no stable limit cycle exists in this Wilson–Cowan family — see
pr4_scan*.py).  Criteria: mean E must oscillate visibly (peak-to-peak
>> baseline noise, FFT peak exactly at the drive frequency), max mean E
must stay far below the 0.15 lock threshold, and a pulse on top must
still give its full transient response.

Run: python3 reference/python-model/pr4_sine_scan.py  (from the repo root)
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import BG_OSCILLATORY, Params, Simulator, StimulusEvent, load_connectivity

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"


def fft_peak(x, dt_ms=1.0):
    x = np.asarray(x, dtype=np.float64)
    x = x - x.mean()
    n = len(x)
    spec = np.abs(np.fft.rfft(x * np.hanning(n)))
    freqs = np.fft.rfftfreq(n, d=dt_ms / 1000.0)
    spec[0] = 0.0
    return float(freqs[int(np.argmax(spec))]), float(np.ptp(x))


def main():
    weights, lengths = load_connectivity(ASSET)
    print("== sine drive sizing, demo network G=0.35, 8 s (last 4 s analysed) ==")
    for amp, freq in [(0.1, 10.0), (0.2, 10.0), (0.3, 10.0), (0.5, 10.0),
                      (0.8, 10.0), (1.0, 10.0),
                      (0.3, 5.0), (0.3, 20.0)]:
        p = Params(**{**Params.demo().__dict__, "bg_mode": BG_OSCILLATORY,
                      "ext_sine_amp": amp, "ext_sine_freq_hz": freq})
        sim = Simulator(weights, lengths, p)
        r = sim.run(8000.0)
        mean_e = r.E.mean(axis=1)
        tail = mean_e[int(4000):]
        f, ptp = fft_peak(tail)
        node_ptp = float(np.ptp(r.E[int(4000):], axis=0).max())
        print(f"amp={amp:.1f} f={freq:4.1f} Hz  meanE range "
              f"[{tail.min():.4f}, {tail.max():.4f}] ptp={ptp:.4f} "
              f"maxNodePtp={node_ptp:.4f} "
              f"FFT peak={f:5.2f} Hz maxMeanE={mean_e.max():.4f}")

    print("== pulse on top of the 0.30 / 10 Hz drive ==")
    p = Params.oscillatory()
    sim = Simulator(weights, lengths, p)
    r0 = sim.run(4000.0)
    base = r0.E.mean(axis=0)  # per-node time average over the settle window
    r = sim.run(4000.0, [StimulusEvent(40, 1000.0, 100.0, 2.0)])
    peak = float(np.abs(r.E - base[None, :]).max(axis=0)[40])
    print(f"pulse 40 peak |dE[40]| vs pre-pulse per-node mean = {peak:.4f} "
          f"(quiet-demo reference ~0.48)")


if __name__ == "__main__":
    main()

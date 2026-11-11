"""PR6 (B2) — late-response mechanism + WAVES/ERP Python reference.

SciPy DOP853 mirror of ``app/src/lib/lateResponse.ts`` (TS RK4, dt = 0.5 ms).
Same JR constants as ``scientific/forward/jansen_rit_reference.py`` and
``app/src/lib/jansenRitColumn.ts``; same assumed dipole coupling and the
same Pz spherical-head gain (0.16 uV/(nA*m), central variant) as
``docs/pr5-public-eeg-constraint.md``.

Mechanism (slow NMDA-like synaptic current with delayed re-entrant onset)
---------------------------------------------------------------------------
The afferent drive that the fast JR pathway receives (rectangular stimulus
pulse, 40 ms) also drives a SECOND, slow second-order synaptic kernel::

    dr/dt = w
    dw/dt = a_s^2 * (gain * stim(t - delay) - r) - 2 * a_s * w,
    a_s = 1 / tau_slow,  tau_slow = 200 ms, delay = 100 ms, gain = 2.5.

Its output r(t) [1/s] feeds back as extra afferent input to the same JR
column: p(t) = p0 + stim(t) + r(t).  This is a parametric dynamical
mechanism (a slow synaptic current with its own time constant, delay and
gain), NOT a fixed P300-shaped waveform added to the output: the late
waveform emerges from the kernel + column ODEs, the oddball/standard
difference emerges from the drive amplitude (300 vs 120 1/s) passed
through the same kernel, and the response returns to baseline (no latch)
at the default gain.  Above gain ~4 the column transiently visits the
JR upper branch and latches (documented unsafe region; the latch
detector in both implementations flags it).

Hard limits (structural, not tunable by this mechanism):
- y0 is capped by JR sigmoid saturation at ~0.16 mV, so q peaks at
  ~1.3 nA*m and Pz at ~0.21 uV no matter the slow gain.  The amplitude
  gap to the real P300 (8.89 uV) is therefore NOT closed by this
  mechanism; only the morphology (nonzero late window, correct latency,
  oddball-selective) is fixed.  No amplitude rescaling is applied
  anywhere: the N x coherence x pA x mm product is non-identifiable
  (see docs/pr5-public-eeg-constraint.md) and must not be "calibrated"
  to match the P300 peak.

Units: time ms, potentials mV, firing rates 1/s, dipole moment nA*m,
EEG uV, frequency Hz.  Sampling of the returned traces is 250 Hz
(4 ms grid), matching ds003061.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import fsolve
from scipy.signal import welch

# --- Jansen-Rit constants (Jansen & Rit 1995; same as jansen_rit_reference.py) ---
A_MV, B_MV = 3.25, 22.0
A_RATE, B_RATE = 100.0, 50.0
C1, C2, C3, C4 = 135.0, 108.0, 33.75, 33.75
E0, V0_MV, R_PER_MV = 2.5, 6.0, 0.56
P0_PER_S = 90.0

# --- Assumed dipole coupling (same form as the WC route; NOT calibrated) ---
N_CELLS, COHERENCE, G_PA_PER_MV, L_MM = 1_000_000, 0.08, 200.0, 0.5

# --- Pz spherical-head gain, central variant (PR5 constraint doc) ---
PZ_GAIN_UV_PER_NAM = 0.16
PZ_GAIN_RANGE_UV_PER_NAM = (0.13, 0.188)

# --- Late-response mechanism defaults (TS DEFAULT_LATE_RESPONSE_PARAMS) ---
TAU_SLOW_MS = 200.0
DELAY_MS = 100.0
SLOW_GAIN = 2.5
SLOW_MAX_PER_S = 5000.0

# --- Oddball protocol (TS STANDARD_DRIVE_PER_S / ODDBALL_DRIVE_PER_S) ---
STIM_DURATION_MS = 40.0
STANDARD_DRIVE_PER_S = 120.0
ODDBALL_DRIVE_PER_S = 300.0
DT_MS = 0.5
SAMPLE_DT_MS = 4.0  # 250 Hz output grid


def sigmoid_per_s(v_mv):
    """Sigmoid firing rate, 1/s. v in mV (same stable form as the TS code)."""
    a = R_PER_MV * (V0_MV - v_mv)
    return 2.0 * E0 / (1.0 + np.exp(np.clip(a, -500, 500)))


def dipole_nam(y0_mv, baseline_mv):
    """Assumed coupling: q = N * c * L * g * (y0 - y0_0) * 1e-6 [nA*m]."""
    return N_CELLS * COHERENCE * L_MM * G_PA_PER_MV * (y0_mv - baseline_mv) * 1e-6


def jr_fixed_point(p_per_s, guess=(0.01, 1.0, 0.5)):
    """Resting fixed point (y0, y1, y2) of the plain JR column at input p."""
    def equations(y):
        y0, y1, y2 = y
        return [
            y0 - (A_MV / A_RATE) * sigmoid_per_s(y1 - y2),
            y1 - (A_MV / A_RATE) * (p_per_s + C2 * sigmoid_per_s(C1 * y0)),
            y2 - (B_MV / B_RATE) * C4 * sigmoid_per_s(C3 * y0),
        ]
    sol, info, ier, _ = fsolve(equations, guess, full_output=True)
    if ier != 1 or np.max(np.abs(equations(sol))) > 1e-9:
        raise RuntimeError(f"JR fixed-point solve failed (ier={ier})")
    return sol


def _rates(_t, s, stim_fn, p0=P0_PER_S):
    """8-dim augmented ODE: JR (y0..y5) + slow kernel (r, w). Time in ms.

    stim_fn(t_ms) -> added stimulus input [1/s] (0 outside the pulse).
    The slow kernel is driven by the DELAYED stimulus; its output r feeds
    back as extra afferent input.  At rest stim = 0 so r = 0 exactly and
    the baseline is the plain JR p0 fixed point.
    """
    y0, y1, y2, y3, y4, y5, r, w = s
    a, b = A_RATE / 1000.0, B_RATE / 1000.0
    a_s = 1.0 / TAU_SLOW_MS
    s_per_ms = lambda v: sigmoid_per_s(v) / 1000.0
    stim = stim_fn(_t)
    stim_d = stim_fn(_t - DELAY_MS)
    target = min(SLOW_GAIN * stim_d, SLOW_MAX_PER_S)
    p_total = p0 + stim + r
    return np.array([
        y3, y4, y5,
        A_MV * a * s_per_ms(y1 - y2) - 2 * a * y3 - a * a * y0,
        A_MV * a * (p_total / 1000.0 + C2 * s_per_ms(C1 * y0)) - 2 * a * y4 - a * a * y1,
        B_MV * b * C4 * s_per_ms(C3 * y0) - 2 * b * y5 - b * b * y2,
        w,
        a_s * a_s * (target - r) - 2 * a_s * w,
    ])


def _pulse_fn(pulse_per_s, t_on_ms=0.0, duration_ms=STIM_DURATION_MS):
    def stim_fn(t_ms):
        return pulse_per_s if (t_on_ms <= t_ms < t_on_ms + duration_ms) else 0.0
    return stim_fn


def simulate_late_trial(pulse_per_s, t_end_ms=2000.0, t_start_ms=-200.0,
                        gain=SLOW_GAIN, tau_ms=TAU_SLOW_MS, delay_ms=DELAY_MS):
    """One trial from the equilibrated baseline; stimulus pulse at t = 0.

    Returns dict with t_ms (4 ms grid), y0_mv, q_nAm, pz_uv, slow_r_per_s.
    DOP853, rtol=1e-12/atol=1e-14, split at the stimulus edges exactly
    (same protocol as scientific/forward/jansen_rit_reference.py).
    The gain/tau/delay arguments are test hooks; the module-level defaults
    are the shipped defaults and must stay in sync with the TS defaults.
    """
    global SLOW_GAIN, TAU_SLOW_MS, DELAY_MS
    old = (SLOW_GAIN, TAU_SLOW_MS, DELAY_MS)
    SLOW_GAIN, TAU_SLOW_MS, DELAY_MS = gain, tau_ms, delay_ms
    try:
        base3 = jr_fixed_point(P0_PER_S)
        state = np.array([base3[0], base3[1], base3[2], 0, 0, 0, 0, 0], dtype=float)
        assert np.max(np.abs(_rates(0.0, state, _pulse_fn(0.0)))) < 1e-9
        stim_fn = _pulse_fn(pulse_per_s)
        # Split at every discontinuity of the drive: the stimulus edges
        # (0, 40 ms) AND the delayed edges (delay, delay + 40 ms) where the
        # slow-kernel target switches.  DOP853 must never step over a
        # discontinuity: with rtol=1e-9 it does and the post-edge trajectory
        # is wrong by ~0.1 mV (measured); rtol=1e-12 + splitting agree.
        edges = sorted({t_start_ms, 0.0, STIM_DURATION_MS,
                        delay_ms, delay_ms + STIM_DURATION_MS, t_end_ms})
        pieces = list(zip(edges[:-1], edges[1:]))
        t_out, y_out = [], []
        for start, stop in pieces:
            sample = np.arange(start + SAMPLE_DT_MS, stop + 0.01, SAMPLE_DT_MS)
            if start == t_start_ms:
                # include the t_start_ms sample itself
                sample = np.concatenate([[t_start_ms], sample])
            result = solve_ivp(_rates, (start, stop), state, method="DOP853",
                               rtol=1e-12, atol=1e-14, t_eval=sample,
                               args=(stim_fn,))
            if not result.success:
                raise RuntimeError(result.message)
            t_out.append(result.t)
            y_out.append(result.y)
            state = result.y[:, -1]
        t = np.concatenate(t_out)
        y = np.hstack(y_out)
        q = dipole_nam(y[0], base3[0])
        return {
            "t_ms": t,
            "y0_mv": y[0],
            "q_nAm": q,
            "pz_uv": q * PZ_GAIN_UV_PER_NAM,
            "slow_r_per_s": y[6],
            "baseline_y0_mv": float(base3[0]),
        }
    finally:
        SLOW_GAIN, TAU_SLOW_MS, DELAY_MS = old


def detect_latch(q_nAm, t_ms, tail_ms=100.0, ratio=0.05):
    """True if the system failed to return to baseline: mean |q| over the
    final `tail_ms` exceeds `ratio` x peak |q|.  Safe runs sit at ~1e-4 of
    peak; latched runs at ~0.5-0.75.  Threshold 0.05 is far from both."""
    peak = float(np.max(np.abs(q_nAm)))
    tail = np.abs(q_nAm[t_ms >= t_ms[-1] - tail_ms])
    return bool(np.mean(tail) > ratio * peak) if peak > 0 else False


def erp_metrics(t_ms, pz_uv, peak_window_ms=(250.0, 600.0),
                mean_window_ms=(300.0, 500.0)):
    """Peak (abs, MNE get_peak mode='abs'), latency and window mean."""
    w = (t_ms >= peak_window_ms[0]) & (t_ms <= peak_window_ms[1])
    m = (t_ms >= mean_window_ms[0]) & (t_ms <= mean_window_ms[1])
    i = int(np.argmax(np.abs(pz_uv[w])))
    return {
        "peak_uv": float(pz_uv[w][i]),
        "peak_latency_ms": float(t_ms[w][i]),
        "window_mean_uv": float(np.mean(pz_uv[m])),
    }


# --- PR-08: JR p0=220 alpha limit cycle ------------------------------------

def run_alpha_limit_cycle(duration_ms=12000.0, settle_ms=2000.0):
    """Plain JR column at p0=220 from zero; DOP853; 250 Hz output.

    Returns the settled segment (duration - settle = 10 s) with y0, q and
    Pz traces, plus Welch PSD (nperseg=1024, Hann periodic, 50% overlap)
    for y0 and Pz and the 1-40 Hz band shares.
    """
    def rates220(_t, y):
        y0, y1, y2, y3, y4, y5 = y
        a, b = A_RATE / 1000.0, B_RATE / 1000.0
        s = lambda v: sigmoid_per_s(v) / 1000.0
        return np.array([
            y3, y4, y5,
            A_MV * a * s(y1 - y2) - 2 * a * y3 - a * a * y0,
            A_MV * a * (220.0 / 1000.0 + C2 * s(C1 * y0)) - 2 * a * y4 - a * a * y1,
            B_MV * b * C4 * s(C3 * y0) - 2 * b * y5 - b * b * y2,
        ])
    t_eval = np.arange(0, duration_ms + 0.01, SAMPLE_DT_MS)
    result = solve_ivp(rates220, (0, duration_ms), np.zeros(6),
                       method="DOP853", rtol=1e-10, atol=1e-12, t_eval=t_eval)
    if not result.success:
        raise RuntimeError(result.message)
    keep = t_eval >= settle_ms
    t = t_eval[keep]
    y0 = result.y[0][keep]
    base = float(np.mean(y0))
    q = dipole_nam(y0, base)
    pz = q * PZ_GAIN_UV_PER_NAM
    out = {"t_ms": t, "y0_mv": y0, "q_nAm": q, "pz_uv": pz,
           "baseline_y0_mv": base}
    for key in ("y0_mv", "pz_uv"):
        seg = out[key] - np.mean(out[key])
        f, p = welch(seg, fs=250.0, nperseg=1024, noverlap=512)
        alpha = (f >= 8) & (f <= 13)
        total = np.trapezoid(p[(f >= 1) & (f <= 40)], f[(f >= 1) & (f <= 40)])
        shares = {}
        for name, (lo, hi) in {"delta": (0.5, 4), "theta": (4, 8),
                                "alpha": (8, 13), "beta": (13, 30),
                                "gamma": (30, 45)}.items():
            m = (f >= lo) & (f <= hi)
            shares[name] = float(100 * np.trapezoid(p[m], f[m]) / total)
        out[f"{'y0' if key == 'y0_mv' else 'pz'}_welch"] = {
            "freqs_hz": f.tolist(),
            "psd": p.tolist(),
            "alpha_peak_hz": float(f[alpha][int(np.argmax(p[alpha]))]),
            "band_share_pct_of_1_40_hz": shares,
            "rms": float(np.sqrt(np.mean(seg ** 2))),
        }
    return out


# --- Fixture for the TS test (TS RK4 vs this DOP853 reference) -------------

def generate_fixture(path=None):
    """Write tests/pr6/fixtures/late-response-reference.json: the oddball
    trial (pulse 300 1/s, -200..800 ms, 4 ms grid) + the alpha Welch
    peak values.  The TS test compares its RK4 traces against this."""
    if path is None:
        here = Path(__file__).resolve()
        path = here.parents[2] / "tests" / "pr6" / "fixtures" / "late-response-reference.json"
    trial = simulate_late_trial(ODDBALL_DRIVE_PER_S, t_end_ms=800.0)
    alpha = run_alpha_limit_cycle()
    fixture = {
        "schema": "late-response-reference-v1",
        "mechanism": {"tau_slow_ms": TAU_SLOW_MS, "delay_ms": DELAY_MS,
                      "slow_gain": SLOW_GAIN, "slow_max_per_s": SLOW_MAX_PER_S},
        "protocol": {"pulse_per_s": ODDBALL_DRIVE_PER_S,
                     "stim_duration_ms": STIM_DURATION_MS,
                     "t_start_ms": -200.0, "t_end_ms": 800.0,
                     "sample_dt_ms": SAMPLE_DT_MS,
                     "pz_gain_uv_per_nAm": PZ_GAIN_UV_PER_NAM},
        "oddball_trial": {
            "t_ms": trial["t_ms"].tolist(),
            "y0_mv": trial["y0_mv"].tolist(),
            "q_nAm": trial["q_nAm"].tolist(),
            "pz_uv": trial["pz_uv"].tolist(),
            "slow_r_per_s": trial["slow_r_per_s"].tolist(),
            "baseline_y0_mv": trial["baseline_y0_mv"],
        },
        "alpha_limit_cycle": {
            "y0_alpha_peak_hz": alpha["y0_welch"]["alpha_peak_hz"],
            "pz_alpha_peak_hz": alpha["pz_welch"]["alpha_peak_hz"],
            "y0_band_share_pct_of_1_40_hz": alpha["y0_welch"]["band_share_pct_of_1_40_hz"],
            "pz_band_share_pct_of_1_40_hz": alpha["pz_welch"]["band_share_pct_of_1_40_hz"],
            "pz_rms_uv": alpha["pz_welch"]["rms"],
            "y0_rms_mv": alpha["y0_welch"]["rms"],
        },
    }
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    return fixture


if __name__ == "__main__":
    fx = generate_fixture()
    tr = fx["oddball_trial"]
    t = np.array(tr["t_ms"])
    pz = np.array(tr["pz_uv"])
    print("oddball trial metrics:", erp_metrics(t, pz))
    print("alpha:", fx["alpha_limit_cycle"]["y0_alpha_peak_hz"],
          "Hz (y0),", fx["alpha_limit_cycle"]["pz_alpha_peak_hz"], "Hz (Pz)")

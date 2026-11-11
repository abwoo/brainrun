"""Independent high-accuracy SciPy ODE reference for the Jansen-Rit route.

Jansen-Rit neural mass model (Jansen & Rit 1995, Biol. Cybern. 73:357-366):
three populations (pyramidal cells, excitatory and inhibitory interneurons),
second-order synaptic kernels converted to six first-order ODEs. Time is
integrated in milliseconds; potentials are in mV; the sigmoid returns a
firing rate in s^-1, converted to per-ms inside the derivatives.

This is a numerical cross-check, *not* empirical biological calibration.
The pyramidal PSP -> dipole coupling (g = 200 pA/mV, N, coherence, length)
is an explicitly assumed hypothesis, identical in form to the Wilson-Cowan
route, and equally unidentifiable from EEG amplitude alone. Outputs are
temporary and generated locally; no copyrighted subject data.
"""
import json
from pathlib import Path
import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import fsolve

# --- Standard Jansen-Rit parameters (Jansen & Rit 1995) -------------------
A_MV = 3.25    # excitatory synaptic gain, mV
B_MV = 22.0    # inhibitory synaptic gain, mV
A_RATE = 100.0  # excitatory lumped rate constant, 1/s
B_RATE = 50.0   # inhibitory lumped rate constant, 1/s
C1, C2, C3, C4 = 135.0, 108.0, 33.75, 33.75  # connectivity constants
E0 = 2.5       # sigmoid maximum firing rate, 1/s
V0_MV = 6.0    # sigmoid half-activation potential, mV
R_PER_MV = 0.56  # sigmoid slope, 1/mV

# --- Resting input and stimulus (this project's comparison protocol) -------
# Baseline mean afferent input p0 = 90 1/s: the mean used by Wendling et al.
# (2002) for the same equations. The comparison uses the LOW resting branch
# (see module docstring in docs/pr5-jansen-rit.md): at p0 = 90 the upper
# fixed point is marginally stable and a 40 ms pulse switches the system to
# the low branch instead of producing a transient, while the standard
# p0 = 220 operating point is a ~10.5 Hz limit cycle (alpha), not a fixed
# point. The low branch is strongly stable (max Jacobian Re ~ -25 1/s).
P0_PER_S = 90.0
PULSE_PER_S = 120.0   # added input, 80-120 ms (same window as the WC route)
STIM_ON_MS = 80.0
STIM_OFF_MS = 120.0
T_END_MS = 600.0

# --- Dipole coupling (ASSUMED, same form as the Wilson-Cowan route) -------
N_CELLS = 1_000_000
COHERENCE = 0.08
G_PA_PER_MV = 200.0  # assumed transmembrane-current change per mV of PSP
L_MM = 0.5


def sigmoid_per_s(v_mv):
    """Sigmoid firing rate, 1/s. v in mV."""
    return 2.0 * E0 / (1.0 + np.exp(np.clip(R_PER_MV * (V0_MV - v_mv), -500, 500)))


def rates_ms(_t, y, p_per_s):
    """dy/dt with t in ms, y = [y0..y5] (mV, mV, mV, mV/ms, mV/ms, mV/ms).

    y0: pyramidal-population PSP (the model EEG proxy, mV)
    y1: excitatory-interneuron PSP, mV; y2: inhibitory-interneuron PSP, mV
    y3, y4, y5: time derivatives of y0, y1, y2.
    """
    y0, y1, y2, y3, y4, y5 = y
    a = A_RATE / 1000.0  # 1/ms
    b = B_RATE / 1000.0  # 1/ms
    s = lambda v: sigmoid_per_s(v) / 1000.0  # firing rate per ms
    return np.array([
        y3,
        y4,
        y5,
        A_MV * a * s(y1 - y2) - 2 * a * y3 - a * a * y0,
        A_MV * a * (p_per_s / 1000.0 + C2 * s(C1 * y0)) - 2 * a * y4 - a * a * y1,
        B_MV * b * C4 * s(C3 * y0) - 2 * b * y5 - b * b * y2,
    ])


def algebraic_fixed_point(p_per_s, guess):
    """Solve the 3-dim resting fixed-point system (y3=y4=y5=0)."""
    def equations(y):
        y0, y1, y2 = y
        return [
            y0 - (A_MV / A_RATE) * sigmoid_per_s(y1 - y2),
            y1 - (A_MV / A_RATE) * (p_per_s + C2 * sigmoid_per_s(C1 * y0)),
            y2 - (B_MV / B_RATE) * C4 * sigmoid_per_s(C3 * y0),
        ]
    sol, info, ier, _ = fsolve(equations, guess, full_output=True)
    if ier != 1 or np.max(np.abs(equations(sol))) > 1e-9:
        raise RuntimeError(f"fixed-point solve failed (ier={ier})")
    return sol


def dipole_nam(y0_mv, baseline_mv):
    """Assumed coupling: q = N * c * l * g * (y0 - y0_0) * 1e-6 [nA*m]."""
    return N_CELLS * COHERENCE * L_MM * G_PA_PER_MV * (y0_mv - baseline_mv) * 1e-6


def half_life_ms(t_ms, q):
    """Time after |q| peak for |q| to first fall below half its peak."""
    i = int(np.argmax(np.abs(q)))
    peak = abs(q[i])
    post = np.where((t_ms > t_ms[i]) & (np.abs(q) < peak / 2.0))[0]
    return float(t_ms[post[0]] - t_ms[i]) if len(post) else float("nan")


def dominant_freq_hz(t_ms, q, start_ms=120.0):
    """FFT peak (excluding DC) of the detrended, Hann-windowed post-stimulus
    segment. The 480 ms window resolves 2.08 Hz bins; a pure transient peaks
    at the lowest bin, which is reported as-is, not as an oscillation."""
    mask = t_ms >= start_ms
    seg = q[mask] - np.mean(q[mask])
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    freqs = np.fft.rfftfreq(len(seg), d=0.004)  # samples are 4 ms apart
    return float(freqs[int(np.argmax(spec[1:])) + 1])


def make_reference():
    baseline3 = algebraic_fixed_point(P0_PER_S, [0.01, 1.0, 0.5])
    baseline = np.array([baseline3[0], baseline3[1], baseline3[2], 0, 0, 0])
    assert np.max(np.abs(rates_ms(0.0, baseline, P0_PER_S))) < 1e-11
    pieces = [
        (0.0, STIM_ON_MS, P0_PER_S),
        (STIM_ON_MS, STIM_OFF_MS, P0_PER_S + PULSE_PER_S),
        (STIM_OFF_MS, T_END_MS, P0_PER_S),
    ]
    series = [{"t_ms": 0.0, "y0": float(baseline[0]), "y1": float(baseline[1]),
               "y2": float(baseline[2]), "y1_minus_y2": float(baseline[1] - baseline[2]),
               "q_nAm": 0.0}]
    state = baseline.copy()
    for start, stop, p in pieces:
        sample = np.arange(start + 4, stop + 0.01, 4, dtype=float)
        result = solve_ivp(lambda t, y: rates_ms(t, y, p), (start, stop), state,
                           method="DOP853", rtol=1e-12, atol=1e-14, t_eval=sample)
        if not result.success:
            raise RuntimeError(result.message)
        for time, y0, y1, y2 in zip(result.t, result.y[0], result.y[1], result.y[2]):
            series.append({"t_ms": float(time), "y0": float(y0), "y1": float(y1),
                           "y2": float(y2), "y1_minus_y2": float(y1 - y2),
                           "q_nAm": float(dipole_nam(y0, baseline[0]))})
        state = result.y[:, -1]
    t = np.array([s["t_ms"] for s in series])
    q = np.array([s["q_nAm"] for s in series])
    i_peak = int(np.argmax(np.abs(q)))
    metrics = {
        "peak_q_nAm": float(q[i_peak]),
        "peak_latency_ms": float(t[i_peak]),
        "peak_dy0_mV": float(series[i_peak]["y0"] - baseline[0]),
        "half_life_ms": half_life_ms(t, q),
        "dominant_freq_hz": dominant_freq_hz(t, q),
        "q_at_600ms_nAm": float(q[-1]),
    }
    return {
        "method": "Independent SciPy DOP853 piecewise stimulus; numerical cross-check only",
        "model": "Jansen-Rit 1995, six first-order ODEs, integrated in ms",
        "parameters": {"A_mV": A_MV, "B_mV": B_MV, "a_per_s": A_RATE,
                       "b_per_s": B_RATE, "C1": C1, "C2": C2, "C3": C3, "C4": C4,
                       "e0_per_s": E0, "v0_mV": V0_MV, "r_per_mV": R_PER_MV},
        "baseline_input_per_s": P0_PER_S,
        "stimulus": {"on_ms": STIM_ON_MS, "off_ms": STIM_OFF_MS,
                     "pulse_per_s": PULSE_PER_S},
        "baseline_y0_mV": float(baseline[0]),
        "baseline_y1_mV": float(baseline[1]),
        "baseline_y2_mV": float(baseline[2]),
        "coupling_assumed": {"N": N_CELLS, "coherence": COHERENCE,
                             "g_pA_per_mV": G_PA_PER_MV, "length_mm": L_MM},
        "metrics": metrics,
        "samples": series,
    }


def main():
    out = Path(__file__).resolve().parents[2] / "tests/pr5/fixtures/jansen-rit-reference.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    result = make_reference()
    out.write_text(json.dumps(result, allow_nan=False, separators=(",", ":")))
    print(json.dumps({"samples": len(result["samples"]), **result["metrics"],
                      "baseline_y0_mV": result["baseline_y0_mV"]}))


if __name__ == "__main__":
    main()

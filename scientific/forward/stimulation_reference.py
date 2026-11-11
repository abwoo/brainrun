"""Independent SciPy reference for PR-14 brain stimulation (plan §15.3/§15.4).

TES: closed-form point-current-source field in an infinite homogeneous
isotropic conductor, E = sum_k I_k (r - r_k) / (4 pi sigma |r - r_k|^3).
TMS: Faraday induced field of a circular loop in a uniform conductor,
E = -mu0 N (dI/dt) / (4 pi) * oint dl / |r - r'|; the loop integral is
evaluated here with 3600 trapezoid segments (the TS implementation uses
360 — the fixture records both so the segment-convergence error is
measured, not assumed).
Level D / sensory: the WC and JR columns are integrated with SciPy
DOP853 (piecewise-constant drive per stimulus piece; continuous sine
drive for flicker), independently of the TS RK4 integrators. The dipole
couplings are the same explicitly assumed chains as PR5/PR6
(local_column_scipy_reference / jansen_rit_reference); this is a
numerical cross-check, *not* empirical biological calibration, and the
Level D gains are uncalibrated by design.

Units: mm / mA / V/m / ms / Hz / nA*m. Coordinates: head-RAS,
sphere-centred mm. Outputs are written to
tests/pr7/fixtures/stimulation-reference.json by main().
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import root

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jansen_rit_reference import (  # noqa: E402
    P0_PER_S,
    algebraic_fixed_point,
    dipole_nam as jr_dipole_nam,
    rates_ms as jr_rates_ms,
)
from local_column_scipy_reference import (  # noqa: E402
    dipole_nam as wc_dipole_nam,
    rates as wc_rates,
)

MU0 = 4.0 * np.pi * 1e-7
HEAD_RADIUS_MM = 95.0
BRAIN_INNER_RADIUS_MM = 85.5
SIGMA_S_PER_M = 0.33

# --- Reference configurations (must match the TS defaults) ---------------
TES_ELECTRODES = [
    {"label": "Anode", "positionMm": [0.0, 0.0, 95.0], "currentMA": 2.0},
    {"label": "Cathode", "positionMm": [0.0, -95.0, 0.0], "currentMA": -2.0},
]
TES_TARGET_MM = [0.0, 0.0, 70.0]
TES_TARGET_NORMAL = [0.0, 0.0, 1.0]
TMS_COIL = {
    "centerMm": [0.0, 0.0, 102.0],
    "axis": [0.0, 0.0, 1.0],
    "radiusMm": 35.0,
    "turns": 10,
    "dIdtAPerS": 1e8,
}
TMS_TARGET_MM = [30.0, 0.0, 70.0]
FIELD_TO_WC_GAIN = 0.01   # model units per (V/m), uncalibrated
FIELD_TO_JR_GAIN = 1.0    # (1/s) per (V/m), uncalibrated
VISUAL_DRIVE_AMPLITUDE = 0.5
AUDITORY_BURST_DRIVE = 1.0
LEVEL_D_FIELDS_VM = [0.0, 25.0, 50.0, 100.0, 200.0]


# --- TES ------------------------------------------------------------------
def tes_field(electrodes, target_mm, sigma=SIGMA_S_PER_M):
    """Closed-form point-source field (V/m) at target_mm."""
    t = np.asarray(target_mm, dtype=float) * 1e-3
    e = np.zeros(3)
    for el in electrodes:
        r = t - np.asarray(el["positionMm"], dtype=float) * 1e-3
        d = float(np.linalg.norm(r))
        e += (el["currentMA"] * 1e-3) * r / (4.0 * np.pi * sigma * d ** 3)
    return e


# --- TMS ------------------------------------------------------------------
def tms_field(coil, target_mm, n_segments=3600):
    """Loop-integral induced field (V/m); trapezoid rule, n_segments."""
    c = np.asarray(coil["centerMm"], dtype=float)
    axis = np.asarray(coil["axis"], dtype=float)
    axis = axis / np.linalg.norm(axis)
    a = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(axis, a)
    u = u / np.linalg.norm(u)
    v = np.cross(axis, u)
    th = np.linspace(0.0, 2.0 * np.pi, n_segments, endpoint=False)
    dth = 2.0 * np.pi / n_segments
    pts = c[None, :] + coil["radiusMm"] * (
        np.outer(np.cos(th), u) + np.outer(np.sin(th), v))
    dl = coil["radiusMm"] * (
        np.outer(-np.sin(th), u) + np.outer(np.cos(th), v)) * dth
    dist = np.linalg.norm(np.asarray(target_mm, dtype=float)[None, :] - pts, axis=1)
    integral = np.sum(dl / dist[:, None], axis=0)
    return -MU0 / (4.0 * np.pi) * coil["turns"] * coil["dIdtAPerS"] * integral


# --- Column integration (DOP853) ------------------------------------------
def wc_baseline():
    sol = root(lambda s: wc_rates(0, s, 0.0), [0.1, 0.1], tol=1e-12)
    assert sol.success and np.max(np.abs(wc_rates(0, sol.x, 0.0))) < 1e-11
    return sol.x


def run_wc_pieces(pieces, t_end, sample_dt=4.0):
    """WC column, piecewise-constant drive.

    pieces: [(start_ms, stop_ms, drive), ...] covering [0, t_end].
    Samples at 0, sample_dt, 2*sample_dt, ...; a sample exactly on a
    piece boundary belongs to the piece that ends there (same convention
    as the TS stepper, whose step at t uses the drive at t).
    Returns (t_ms, q_nAm).
    """
    base = wc_baseline()
    state = base.copy()
    sample_times = np.arange(0.0, t_end + 0.5 * sample_dt, sample_dt)
    ts = [0.0]
    qs = [0.0]
    for start, stop, drive in pieces:
        if start >= t_end:
            break
        stop = min(stop, t_end)
        mask = (sample_times > start) & (sample_times <= stop)
        teval = sample_times[mask]
        sol = solve_ivp(lambda t, y: wc_rates(t, y, drive), (start, stop), state,
                        method="DOP853", rtol=1e-11, atol=1e-13,
                        t_eval=teval if len(teval) else None)
        if not sol.success:
            raise RuntimeError(sol.message)
        # NOTE: with t_eval given, sol.y[:, -1] is the state at the LAST
        # SAMPLED time, not at the piece end. When stop is not on the
        # sample grid (e.g. a 50 ms burst ending at 550 ms), carrying
        # that stale state into the next piece silently shifts the drive
        # edge by up to one sample interval. Advance to stop explicitly.
        if len(teval) and teval[-1] < stop:
            tail = solve_ivp(lambda t, y: wc_rates(t, y, drive),
                             (teval[-1], stop), sol.y[:, -1],
                             method="DOP853", rtol=1e-11, atol=1e-13)
            if not tail.success:
                raise RuntimeError(tail.message)
            state = tail.y[:, -1]
        else:
            state = sol.y[:, -1]
        # Only t_eval samples enter the series. Without t_eval, sol.t
        # holds the solver's internal adaptive steps (off-grid); appending
        # those would let a peak be "found" between grid samples.
        if len(teval):
            for tt, e, i in zip(sol.t, sol.y[0], sol.y[1]):
                ts.append(float(tt))
                qs.append(float(wc_dipole_nam(e, i, *base)))
    return np.array(ts), np.array(qs)


def run_wc_flicker(freq_hz, intensity, duration_ms=4000.0, sample_dt=4.0):
    """WC column under a continuous sinusoidal flicker drive."""
    base = wc_baseline()
    drive = lambda t: intensity * VISUAL_DRIVE_AMPLITUDE * np.sin(
        2.0 * np.pi * freq_hz * t / 1000.0)
    teval = np.arange(0.0, duration_ms + 0.5 * sample_dt, sample_dt)
    sol = solve_ivp(lambda t, y: wc_rates(t, y, drive(t)), (0.0, duration_ms),
                    base, method="DOP853", rtol=1e-10, atol=1e-12, t_eval=teval)
    if not sol.success:
        raise RuntimeError(sol.message)
    q = np.array([wc_dipole_nam(e, i, *base) for e, i in zip(sol.y[0], sol.y[1])])
    return sol.t, q


def run_jr_pieces(pieces, t_end, sample_dt=4.0):
    """JR column, piecewise-constant added input (1/s), p0 = 90 1/s."""
    base3 = algebraic_fixed_point(P0_PER_S, [0.01, 1.0, 0.5])
    base = np.array([base3[0], base3[1], base3[2], 0.0, 0.0, 0.0])
    state = base.copy()
    sample_times = np.arange(0.0, t_end + 0.5 * sample_dt, sample_dt)
    ts = [0.0]
    qs = [0.0]
    for start, stop, drive in pieces:
        if start >= t_end:
            break
        stop = min(stop, t_end)
        mask = (sample_times > start) & (sample_times <= stop)
        teval = sample_times[mask]
        sol = solve_ivp(
            lambda t, y: jr_rates_ms(t, y, P0_PER_S + drive), (start, stop), state,
            method="DOP853", rtol=1e-10, atol=1e-12,
            t_eval=teval if len(teval) else None)
        if not sol.success:
            raise RuntimeError(sol.message)
        # Same stale-handoff guard as run_wc_pieces (see comment there).
        if len(teval) and teval[-1] < stop:
            tail = solve_ivp(
                lambda t, y: jr_rates_ms(t, y, P0_PER_S + drive),
                (teval[-1], stop), sol.y[:, -1],
                method="DOP853", rtol=1e-10, atol=1e-12)
            if not tail.success:
                raise RuntimeError(tail.message)
            state = tail.y[:, -1]
        else:
            state = sol.y[:, -1]
        # Only t_eval samples enter the series (see run_wc_pieces).
        if len(teval):
            for tt, y0 in zip(sol.t, sol.y[0]):
                ts.append(float(tt))
                qs.append(float(jr_dipole_nam(y0, base[0])))
    return np.array(ts), np.array(qs)


def level_d_pieces(field_vm, gain, model):
    """Rectangular Level D drive, window 100-200 ms, run to 600 ms."""
    drive = field_vm * gain
    return [(0.0, 100.0, 0.0), (100.0, 200.0, drive), (200.0, 600.0, 0.0)]


def auditory_pieces(isi_ms, intensity, n_bursts=5, burst_ms=50.0,
                    first_ms=500.0, total_ms=3000.0):
    pieces = []
    t = 0.0
    for k in range(n_bursts):
        s = first_ms + k * isi_ms
        pieces.append((t, s, 0.0))
        pieces.append((s, s + burst_ms, intensity * AUDITORY_BURST_DRIVE))
        t = s + burst_ms
    pieces.append((t, total_ms, 0.0))
    return pieces


def fixed_window_mean_abs_q(t_ms, q, start_ms, width_ms=1000.0):
    mask = (t_ms >= start_ms) & (t_ms < start_ms + width_ms)
    return float(np.mean(np.abs(q[mask])))


def make_reference():
    tes = tes_field(TES_ELECTRODES, TES_TARGET_MM)
    tes_grid = []
    for pos in ([0, 0, 70], [30, 0, 70], [-30, 0, 70], [0, 0, 16],
                [0, 40, 40], [48, 0, 0]):
        f = tes_field(TES_ELECTRODES, pos)
        tes_grid.append({"positionMm": [float(x) for x in pos],
                         "fieldVm": [float(x) for x in f],
                         "magnitudeVm": float(np.linalg.norm(f))})
    tms = tms_field(TMS_COIL, TMS_TARGET_MM, n_segments=3600)
    tms360 = tms_field(TMS_COIL, TMS_TARGET_MM, n_segments=360)
    tms_axis = tms_field(TMS_COIL, [0, 0, 70], n_segments=3600)

    level_d_wc = {"fieldsVm": LEVEL_D_FIELDS_VM, "peaks": [], "series100": None}
    for field in LEVEL_D_FIELDS_VM:
        t, q = run_wc_pieces(level_d_pieces(field, FIELD_TO_WC_GAIN, "wc"), 600.0)
        level_d_wc["peaks"].append(float(np.max(np.abs(q))))
        if field == 100.0:
            level_d_wc["series100"] = {"t_ms": [float(x) for x in t],
                                       "q_nAm": [float(x) for x in q]}
    level_d_jr = {"fieldsVm": LEVEL_D_FIELDS_VM, "peaks": [], "series25": None}
    for field in LEVEL_D_FIELDS_VM:
        t, q = run_jr_pieces(level_d_pieces(field, FIELD_TO_JR_GAIN, "jr"), 600.0)
        level_d_jr["peaks"].append(float(np.max(np.abs(q))))
        if field == 25.0:
            level_d_jr["series25"] = {"t_ms": [float(x) for x in t],
                                      "q_nAm": [float(x) for x in q]}

    t_f, q_f = run_wc_flicker(10.0, 1.0)
    t_fh, q_fh = run_wc_flicker(10.0, 0.5)
    flicker = {
        "freqHz": 10.0, "intensity": 1.0,
        "t_ms": [float(x) for x in t_f], "q_nAm": [float(x) for x in q_f],
        "peakHalfIntensity": float(np.max(np.abs(q_fh))),
    }

    auditory = {"isiScan": [], "intensityScan": [], "series500": None}
    for isi in (250.0, 500.0, 1000.0):
        t, q = run_wc_pieces(auditory_pieces(isi, 1.0), 3000.0)
        auditory["isiScan"].append({
            "isiMs": isi,
            "fixedWindowMeanAbsQNAm": fixed_window_mean_abs_q(t, q, 500.0),
            "peakAbsQNAm": float(np.max(np.abs(q)))})
        if isi == 500.0:
            auditory["series500"] = {"t_ms": [float(x) for x in t],
                                     "q_nAm": [float(x) for x in q]}
    for intensity in (0.25, 0.5, 1.0):
        t, q = run_wc_pieces(auditory_pieces(500.0, intensity), 1500.0)
        auditory["intensityScan"].append({
            "intensity": intensity,
            "peakAbsQNAm": float(np.max(np.abs(q)))})

    return {
        "method": "Independent SciPy DOP853 / closed-form reference; numerical "
                  "cross-check only, not empirical calibration",
        "tes": {
            "electrodes": TES_ELECTRODES, "targetMm": TES_TARGET_MM,
            "sigmaSPerM": SIGMA_S_PER_M,
            "fieldVm": [float(x) for x in tes],
            "magnitudeVm": float(np.linalg.norm(tes)),
            "normalFieldVm": float(np.dot(tes, TES_TARGET_NORMAL)),
            "gridSample": tes_grid,
        },
        "tms": {
            "coil": TMS_COIL, "targetMm": TMS_TARGET_MM,
            "fieldVm": [float(x) for x in tms],
            "magnitudeVm": float(np.linalg.norm(tms)),
            "fieldVm360Segments": [float(x) for x in tms360],
            "axisFieldMagnitudeVm": float(np.linalg.norm(tms_axis)),
        },
        "levelD": {
            "wcGain": FIELD_TO_WC_GAIN, "jrGain": FIELD_TO_JR_GAIN,
            "wc": level_d_wc, "jr": level_d_jr,
        },
        "flickerWc": flicker,
        "auditoryWc": auditory,
    }


def main():
    out = Path(__file__).resolve().parents[2] / "tests/pr7/fixtures/stimulation-reference.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    result = make_reference()
    out.write_text(json.dumps(result, allow_nan=False, separators=(",", ":")))
    print(json.dumps({
        "tesMagnitudeVm": result["tes"]["magnitudeVm"],
        "tmsMagnitudeVm": result["tms"]["magnitudeVm"],
        "levelDwcPeaks": result["levelD"]["wc"]["peaks"],
        "levelDjrPeaks": result["levelD"]["jr"]["peaks"],
        "flickerPeak": max(abs(x) for x in result["flickerWc"]["q_nAm"]),
        "auditoryIsi": [d["fixedWindowMeanAbsQNAm"] for d in result["auditoryWc"]["isiScan"]],
    }))


if __name__ == "__main__":
    main()

"""Independent SciPy DOP853 reference for the cellular (PR-13) models.

Models (all time in ms, potentials in mV, currents in pA unless stated):
  * Leaky Integrate-and-Fire (LIF): exact subthreshold update, refractory
    period, current injection, f-I curve vs the analytic steady rate.
  * Hodgkin-Huxley (HH1952, squid giant axon at 6.3 degC): Na/K/leak
    conductances, m/h/n gating, current injection in uA/cm^2, action
    potentials. Standard parameters (Hodgkin & Huxley 1952, J. Physiol.
    117:500-544): C=1 uF/cm^2, gNa=120, gK=36, gL=0.3 mS/cm^2,
    ENa=+50, EK=-77, EL=-54.387 mV, Vrest=-65 mV.
  * Multi-compartment neuron (soma + apical/basal dendrite): passive cable
    + active (HH) soma; morphology parameters explicit; axial conductance
    from cylinder geometry and axial resistivity Ra=100 Ohm*cm.
  * Synaptic currents: conductance-based, AMPA-like (Erev=0 mV) and
    GABA-like (Erev=-75 mV), alpha-function or exponential kernels.
  * Cross-scale coupling: WC/JR region activity E (dimensionless) ->
    cellular injected current (assumed linear gain, UNCALIBRATED, same
    honest status as the PR5 dipole coupling); cellular firing rate ->
    population drive (assumed gain, UNCALIBRATED).

This is a numerical cross-check, *not* empirical biological calibration.
The TS implementation (app/src/lib/cellular.ts) integrates the same ODEs
with fixed-step RK4; this file integrates them with SciPy DOP853
(rtol=1e-12, atol=1e-14 unless noted). The LIF uses the exact update in
both implementations, so TS/Python agreement there is at exp() last-bit
level. NEURON cross-check (built-in hh mechanism) is attempted when the
`neuron` package is importable; it is reported, not gated, because NEURON
is not a CI dependency.
"""
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp

# --------------------------------------------------------------------------
# LIF — Leaky Integrate-and-Fire
# --------------------------------------------------------------------------
# Standard textbook values (Dayan & Abbott 2001): C=250 pF, gL=25 nS
# (tau=10 ms), EL=-65 mV, Vth=-50 mV, Vreset=-65 mV, t_ref=2 ms.
# Rheobase = gL * (Vth - EL) = 25 nS * 15 mV = 375 pA.
LIF_C_PF = 250.0
LIF_GLEAK_NS = 25.0
LIF_EL_MV = -65.0
LIF_VTH_MV = -50.0
LIF_VRESET_MV = -65.0
LIF_TREF_MS = 2.0
LIF_DT_MS = 0.1


def lif_analytic_rate_hz(i_pa, c_pf=LIF_C_PF, g_ns=LIF_GLEAK_NS,
                         el_mv=LIF_EL_MV, vth_mv=LIF_VTH_MV,
                         vreset_mv=LIF_VRESET_MV, tref_ms=LIF_TREF_MS):
    """Steady firing rate (Hz) for constant current, analytic formula.

    f = 1 / (t_ref + tau * ln((I*R - (Vreset-EL)) / (I*R - (Vth-EL)))),
    tau = C/gL (ms), R = 1/gL (GOhm), I*R in mV (pA * GOhm = mV).
    Returns 0 below rheobase.
    """
    tau_ms = c_pf / g_ns
    r_gohm = 1.0 / g_ns
    v_inf = el_mv + i_pa * r_gohm
    if v_inf <= vth_mv:
        return 0.0
    charge_ms = tau_ms * math.log((v_inf - vreset_mv) / (v_inf - vth_mv))
    return 1000.0 / (tref_ms + charge_ms)


def simulate_lif(i_pa_fn, duration_ms, dt_ms=LIF_DT_MS,
                 c_pf=LIF_C_PF, g_ns=LIF_GLEAK_NS, el_mv=LIF_EL_MV,
                 vth_mv=LIF_VTH_MV, vreset_mv=LIF_VRESET_MV,
                 tref_ms=LIF_TREF_MS):
    """Exact-update LIF. i_pa_fn(t_ms) -> injected current in pA.

    Semantics (mirrored exactly by the TS implementation): each step
    integrates over [t, t+dt); while refractory the membrane is held at
    reset and the refractory clock counts down; a threshold crossing at
    the end of a step records a spike at the new time, resets V and
    starts the refractory period. Returns dict of arrays/lists.
    """
    tau_ms = c_pf / g_ns
    r_gohm = 1.0 / g_ns
    decay = math.exp(-dt_ms / tau_ms)
    n = int(round(duration_ms / dt_ms))
    t = np.arange(n + 1) * dt_ms
    v = np.empty(n + 1)
    v[0] = el_mv
    refractory = 0.0
    spikes = []
    for k in range(n):
        i_pa = float(i_pa_fn(t[k]))
        if refractory > 0.0:
            refractory -= dt_ms
            v[k + 1] = vreset_mv
        else:
            v_inf = el_mv + i_pa * r_gohm
            v_new = v_inf + (v[k] - v_inf) * decay
            if v_new >= vth_mv:
                spikes.append(float(t[k + 1]))
                v[k + 1] = vreset_mv
                refractory = tref_ms
            else:
                v[k + 1] = v_new
    return {"t_ms": t, "v_mv": v, "spike_times_ms": spikes}


def lif_fi_curve(currents_pa, duration_ms=1000.0, discard_ms=100.0):
    """(current pA, simulated Hz, analytic Hz) per current."""
    out = []
    for i_pa in currents_pa:
        r = simulate_lif(lambda _t, i=i_pa: i, duration_ms)
        n = sum(1 for s in r["spike_times_ms"] if s >= discard_ms)
        sim_hz = n / ((duration_ms - discard_ms) / 1000.0)
        out.append({"i_pa": float(i_pa), "sim_hz": float(sim_hz),
                    "analytic_hz": lif_analytic_rate_hz(i_pa)})
    return out


# --------------------------------------------------------------------------
# Hodgkin-Huxley (HH1952)
# --------------------------------------------------------------------------
HH_C_UF_PER_CM2 = 1.0
HH_GNA_MS_PER_CM2 = 120.0
HH_GK_MS_PER_CM2 = 36.0
HH_GL_MS_PER_CM2 = 0.3
HH_ENA_MV = 50.0
HH_EK_MV = -77.0
HH_EL_MV = -54.387
HH_VREST_MV = -65.0
HH_DT_MS = 0.025


def _rate_ratio(x):
    """x / (exp(x) - 1), stable for |x| < 1e-6 (series to x^4).

    Used for alpha_m (singular at v=+25 mV rel.) and alpha_n (v=+10).
    """
    if abs(x) < 1e-6:
        return 1.0 - x / 2.0 + x * x / 12.0 - x ** 4 / 720.0
    return x / (math.exp(x) - 1.0)


def hh_alpha_beta(v_rel_mv):
    """alpha/beta rates (1/ms) at v = V - Vrest (mV). HH1952 Table / eqs."""
    v = v_rel_mv
    a_m = 0.1 * 10.0 * _rate_ratio((25.0 - v) / 10.0)
    b_m = 4.0 * math.exp(-v / 18.0)
    a_h = 0.07 * math.exp(-v / 20.0)
    b_h = 1.0 / (math.exp((30.0 - v) / 10.0) + 1.0)
    a_n = 0.01 * 10.0 * _rate_ratio((10.0 - v) / 10.0)
    b_n = 0.125 * math.exp(-v / 80.0)
    return (a_m, b_m, a_h, b_h, a_n, b_n)


def hh_steady_gating(v_rel_mv=0.0):
    """Steady-state (m0, h0, n0) at the given relative potential."""
    a_m, b_m, a_h, b_h, a_n, b_n = hh_alpha_beta(v_rel_mv)
    return (a_m / (a_m + b_m), a_h / (a_h + b_h), a_n / (a_n + b_n))


def hh_rates(_t, y, i_ua_per_cm2):
    """dy/dt, y = [V, m, h, n], V absolute mV, t in ms."""
    v, m, h, n = y
    a_m, b_m, a_h, b_h, a_n, b_n = hh_alpha_beta(v - HH_VREST_MV)
    g_na = HH_GNA_MS_PER_CM2 * m ** 3 * h
    g_k = HH_GK_MS_PER_CM2 * n ** 4
    i_na = g_na * (v - HH_ENA_MV)
    i_k = g_k * (v - HH_EK_MV)
    i_l = HH_GL_MS_PER_CM2 * (v - HH_EL_MV)
    dv = (i_ua_per_cm2 - i_na - i_k - i_l) / HH_C_UF_PER_CM2
    return np.array([dv,
                     a_m * (1.0 - m) - b_m * m,
                     a_h * (1.0 - h) - b_h * h,
                     a_n * (1.0 - n) - b_n * n])


def hh_conductances(y):
    """(gNa, gK, INa, IK, IL) in mS/cm^2 and uA/cm^2 at state y."""
    v, m, h, n = y
    g_na = HH_GNA_MS_PER_CM2 * m ** 3 * h
    g_k = HH_GK_MS_PER_CM2 * n ** 4
    return (g_na, g_k,
            g_na * (v - HH_ENA_MV), g_k * (v - HH_EK_MV),
            HH_GL_MS_PER_CM2 * (v - HH_EL_MV))


def _sample_grid(start, stop, dt):
    """Output times strictly inside (start, stop]: start+dt, ..., <= stop.

    Built by integer counting, not by repeated float addition, so the
    last point never overshoots the integration span (solve_ivp rejects
    t_eval outside t_span).
    """
    n = int(math.floor((stop - start) / dt + 1e-9))
    return start + dt * np.arange(1, n + 1)


def _spike_times(t, v, threshold_mv=0.0):
    """Upward threshold-crossing times (linear interpolation)."""
    out = []
    for k in range(len(t) - 1):
        if v[k] < threshold_mv <= v[k + 1]:
            frac = (threshold_mv - v[k]) / (v[k + 1] - v[k])
            out.append(float(t[k] + frac * (t[k + 1] - t[k])))
    return out


def simulate_hh(i_fn, duration_ms, dt_out_ms=0.1,
                rtol=1e-12, atol=1e-14):
    """DOP853 HH run. i_fn(t_ms) -> injected current uA/cm^2.

    Piecewise-constant input is integrated piece by piece so the
    integrator never steps over a discontinuity. Output sampled every
    dt_out_ms. Returns dict with t, v, m, h, n, gNa, gK, spikes.
    """
    m0, h0, n0 = hh_steady_gating(0.0)
    y0 = np.array([HH_VREST_MV, m0, h0, n0])
    # Breakpoints: every input change (i_fn is probed on a fine grid to
    # find them) plus the output grid edges.
    probe = np.arange(0.0, duration_ms + 1e-9, 0.05)
    vals = np.array([i_fn(x) for x in probe])
    breaks = [0.0]
    for k in range(1, len(probe)):
        if vals[k] != vals[k - 1]:
            breaks.append(float(probe[k]))
    breaks.append(float(duration_ms))
    pieces = [(breaks[k], breaks[k + 1], vals[np.searchsorted(probe, breaks[k])])
              for k in range(len(breaks) - 1) if breaks[k + 1] > breaks[k]]
    t_all, y_all = [0.0], [y0.copy()]
    state = y0.copy()
    for start, stop, i_val in pieces:
        sample = _sample_grid(start, stop, dt_out_ms)
        sol = solve_ivp(lambda t, y: hh_rates(t, y, float(i_val)),
                        (start, stop), state, method="DOP853",
                        rtol=rtol, atol=atol, t_eval=sample)
        if not sol.success:
            raise RuntimeError(sol.message)
        for tt, yy in zip(sol.t, sol.y.T):
            t_all.append(float(tt))
            y_all.append(yy.copy())
        state = sol.y[:, -1]
    t = np.array(t_all)
    y = np.array(y_all)
    g_na = HH_GNA_MS_PER_CM2 * y[:, 1] ** 3 * y[:, 2]
    g_k = HH_GK_MS_PER_CM2 * y[:, 3] ** 4
    return {"t_ms": t, "v_mv": y[:, 0], "m": y[:, 1], "h": y[:, 2],
            "n": y[:, 3], "g_na_ms_per_cm2": g_na,
            "g_k_ms_per_cm2": g_k,
            "spike_times_ms": _spike_times(t, y[:, 0])}


def hh_ap_metrics(trace):
    """Peak, half-width and spike count of an HH trace.

    Half-width: width of the first spike at half amplitude between the
    resting level (-65 mV) and the peak, linear interpolation.
    """
    v = trace["v_mv"]
    t = trace["t_ms"]
    i_peak = int(np.argmax(v))
    peak = float(v[i_peak])
    half = HH_VREST_MV + (peak - HH_VREST_MV) / 2.0
    up = None
    for k in range(i_peak, 0, -1):
        if v[k - 1] < half <= v[k]:
            up = t[k - 1] + (half - v[k - 1]) / (v[k] - v[k - 1]) * (t[k] - t[k - 1])
            break
    down = None
    for k in range(i_peak, len(v) - 1):
        if v[k] >= half > v[k + 1]:
            down = t[k] + (v[k] - half) / (v[k] - v[k + 1]) * (t[k + 1] - t[k])
            break
    width = float(down - up) if up is not None and down is not None else float("nan")
    return {"peak_mv": peak, "peak_latency_ms": float(t[i_peak]),
            "half_width_ms": width,
            "n_spikes": len(trace["spike_times_ms"])}


def hh_threshold_pulse(pulse_ms=1.0, lo=0.0, hi=40.0, tol=0.05):
    """Smallest 1 ms pulse amplitude (uA/cm^2, from rest at 10 ms) that
    fires one AP, by bisection. A pulse 'fires' if V crosses 0 mV."""
    def fires(i_pa):
        tr = simulate_hh(lambda t, i=i_pa: i if 10.0 <= t < 10.0 + pulse_ms else 0.0,
                         60.0, dt_out_ms=0.05)
        return len(tr["spike_times_ms"]) > 0
    assert not fires(lo) and fires(hi)
    while hi - lo > tol:
        mid = 0.5 * (lo + hi)
        if fires(mid):
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


# --------------------------------------------------------------------------
# Synapses — conductance-based, AMPA-like / GABA-like
# --------------------------------------------------------------------------
SYNAPSE_DEFAULTS = {
    # kind: (Erev mV, alpha tau ms, exponential tau ms)
    "ampa": {"e_rev_mv": 0.0, "tau_alpha_ms": 2.0, "tau_exp_ms": 2.0},
    "gaba": {"e_rev_mv": -75.0, "tau_alpha_ms": 8.0, "tau_exp_ms": 10.0},
}


def synapse_conductance_ns(kind, g_max_ns, t_ms, spike_times_ms,
                           shape="alpha"):
    """Total conductance (nS) at t from summed kernels over spike times.

    alpha: g = gMax * x * exp(1 - x), x = (t - t0)/tau (peak gMax at
    t = t0 + tau). exponential: g = gMax * exp(-(t - t0)/tau).
    """
    spec = SYNAPSE_DEFAULTS[kind]
    tau = spec["tau_alpha_ms"] if shape == "alpha" else spec["tau_exp_ms"]
    g = 0.0
    for t0 in spike_times_ms:
        dt = t_ms - t0
        if dt < 0:
            continue
        if shape == "alpha":
            x = dt / tau
            g += g_max_ns * x * math.exp(1.0 - x)
        else:
            g += g_max_ns * math.exp(-dt / tau)
    return g


def synapse_current_pa(g_ns, v_mv, e_rev_mv):
    """Outward synaptic current (pA) = g * (V - Erev); 1 nS * 1 mV = 1 pA.

    Same sign convention as HH ionic currents: the membrane equation
    subtracts it, i.e. injected current = -this value.
    """
    return g_ns * (v_mv - e_rev_mv)


# --------------------------------------------------------------------------
# Multi-compartment neuron — soma (HH active) + apical/basal dendrites
# --------------------------------------------------------------------------
# Morphology (explicit, textbook-scale pyramidal-cell numbers):
# soma: cylinder d=20 um, L=20 um; apical: d=2 um, L=200 um;
# basal: d=2 um, L=100 um. Ra=100 Ohm*cm, Cm=1 uF/cm^2,
# passive leak density 0.3 mS/cm^2 (same as HH gL), EL=-65 mV.
# NOTE: the passive leak reversal is the resting potential (-65 mV),
# NOT the HH leak battery (-54.387 mV): in the full HH soma the
# -54.387 mV battery is balanced by the Na window current so rest
# sits at -65 mV, but a passive compartment has no such balance and
# its leak must reverse at rest itself. The active soma keeps the HH
# battery; dendrites and the passive soma use E_LEAK_MV = -65 mV.
E_LEAK_MV = -65.0
MULTICOMP = {
    "soma_diameter_um": 20.0, "soma_length_um": 20.0,
    "apical_diameter_um": 2.0, "apical_length_um": 200.0,
    "basal_diameter_um": 2.0, "basal_length_um": 100.0,
    "ra_ohm_cm": 100.0, "cm_uf_per_cm2": 1.0,
    "g_leak_ms_per_cm2": 0.3, "e_leak_mv": -65.0,
    "soma_active": True,
}
# Distance between compartment centres (soma centre to dendrite centre),
# used as the geometric source-sink separation of the cellular dipole:
# soma half-length + dendrite half-length.
APICAL_SEPARATION_UM = (MULTICOMP["soma_length_um"] +
                        MULTICOMP["apical_length_um"]) / 2.0  # 110 um
BASAL_SEPARATION_UM = (MULTICOMP["soma_length_um"] +
                       MULTICOMP["basal_length_um"]) / 2.0    # 60 um


def _cyl_area_um2(d_um, l_um):
    return math.pi * d_um * l_um


def _cyl_cross_um2(d_um):
    return math.pi * (d_um / 2.0) ** 2


def derive_multicomp_morphology(spec=None):
    """Areas, capacitances, leaks and axial conductances from geometry.

    Axial conductance between two compartments = 1 / (R_half_1 +
    R_half_2), R_half = Ra * (L/2) / A_cross, all in SI-derived units
    converted to nS. Returns a dict of plain numbers.
    """
    s = dict(MULTICOMP if spec is None else spec)
    um2_to_cm2 = 1e-8
    a_soma = _cyl_area_um2(s["soma_diameter_um"], s["soma_length_um"]) * um2_to_cm2
    a_api = _cyl_area_um2(s["apical_diameter_um"], s["apical_length_um"]) * um2_to_cm2
    a_bas = _cyl_area_um2(s["basal_diameter_um"], s["basal_length_um"]) * um2_to_cm2
    c_soma_pf = s["cm_uf_per_cm2"] * a_soma * 1e6  # uF/cm^2 * cm^2 -> pF
    c_api_pf = s["cm_uf_per_cm2"] * a_api * 1e6
    c_bas_pf = s["cm_uf_per_cm2"] * a_bas * 1e6
    g_leak_soma_ns = s["g_leak_ms_per_cm2"] * a_soma * 1e6  # mS/cm^2 -> nS
    g_leak_api_ns = s["g_leak_ms_per_cm2"] * a_api * 1e6
    g_leak_bas_ns = s["g_leak_ms_per_cm2"] * a_bas * 1e6

    def axial_ns(d1_um, l1_um, d2_um, l2_um):
        # R = Ra * (L/2) / A_cross, Ra in Ohm*cm, lengths in cm.
        r1 = s["ra_ohm_cm"] * (l1_um / 2.0 * 1e-4) / (_cyl_cross_um2(d1_um) * um2_to_cm2)
        r2 = s["ra_ohm_cm"] * (l2_um / 2.0 * 1e-4) / (_cyl_cross_um2(d2_um) * um2_to_cm2)
        return 1e9 / (r1 + r2)  # Ohm^-1 -> nS

    g_ax_api_ns = axial_ns(s["soma_diameter_um"], s["soma_length_um"],
                           s["apical_diameter_um"], s["apical_length_um"])
    g_ax_bas_ns = axial_ns(s["soma_diameter_um"], s["soma_length_um"],
                           s["basal_diameter_um"], s["basal_length_um"])
    # HH absolute conductances of the soma (densities x soma area).
    g_na_abs_ns = HH_GNA_MS_PER_CM2 * a_soma * 1e6
    g_k_abs_ns = HH_GK_MS_PER_CM2 * a_soma * 1e6
    return {
        "area_soma_cm2": a_soma, "area_apical_cm2": a_api, "area_basal_cm2": a_bas,
        "c_soma_pf": c_soma_pf, "c_apical_pf": c_api_pf, "c_basal_pf": c_bas_pf,
        "g_leak_soma_ns": g_leak_soma_ns, "g_leak_apical_ns": g_leak_api_ns,
        "g_leak_basal_ns": g_leak_bas_ns,
        "g_axial_apical_ns": g_ax_api_ns, "g_axial_basal_ns": g_ax_bas_ns,
        "g_na_soma_ns": g_na_abs_ns, "g_k_soma_ns": g_k_abs_ns,
        "apical_separation_um": APICAL_SEPARATION_UM,
        "basal_separation_um": BASAL_SEPARATION_UM,
    }


def multicomp_rates(_t, y, i_soma_pa, i_api_pa, i_bas_pa, morph, soma_active):
    """dy/dt, y = [Vs, m, h, n, Va, Vb], V in mV, currents in pA.

    Soma: HH ionic currents (absolute conductances) + axial currents +
    injected current, over C_soma (pA/pF = mV/ms). Dendrites: passive
    leak + axial + injected, over their C. Axial current (pA) from
    compartment X to Y = g_axial_nS * (Vx - Vy) (nS*mV = pA).
    """
    vs, m, h, n, va, vb = y
    a_m, b_m, a_h, b_h, a_n, b_n = hh_alpha_beta(vs - HH_VREST_MV)
    if soma_active:
        i_na = morph["g_na_soma_ns"] * m ** 3 * h * (vs - HH_ENA_MV)
        i_k = morph["g_k_soma_ns"] * n ** 4 * (vs - HH_EK_MV)
        # HH leak battery (balanced by the Na window current at rest).
        i_l_soma = morph["g_leak_soma_ns"] * (vs - HH_EL_MV)
    else:
        i_na = 0.0
        i_k = 0.0
        # Passive soma: leak reverses at rest (see E_LEAK_MV note above).
        i_l_soma = morph["g_leak_soma_ns"] * (vs - E_LEAK_MV)
    i_ax_api = morph["g_axial_apical_ns"] * (vs - va)
    i_ax_bas = morph["g_axial_basal_ns"] * (vs - vb)
    dvs = (i_soma_pa - i_na - i_k - i_l_soma - i_ax_api - i_ax_bas) / morph["c_soma_pf"]
    dva = (i_api_pa - morph["g_leak_apical_ns"] * (va - E_LEAK_MV)
           - morph["g_axial_apical_ns"] * (va - vs)) / morph["c_apical_pf"]
    dvb = (i_bas_pa - morph["g_leak_basal_ns"] * (vb - E_LEAK_MV)
           - morph["g_axial_basal_ns"] * (vb - vs)) / morph["c_basal_pf"]
    return np.array([dvs,
                     a_m * (1.0 - m) - b_m * m,
                     a_h * (1.0 - h) - b_h * h,
                     a_n * (1.0 - n) - b_n * n,
                     dva, dvb])


def simulate_multicomp(i_soma_fn, i_api_fn, i_bas_fn, duration_ms,
                       dt_out_ms=0.1, soma_active=True,
                       rtol=1e-10, atol=1e-12):
    """DOP853 multi-compartment run; input fns (t_ms) -> pA.

    Piecewise integration over input breakpoints found on a 0.05 ms
    probe grid (same scheme as simulate_hh). Output every dt_out_ms.
    """
    morph = derive_multicomp_morphology()
    m0, h0, n0 = hh_steady_gating(0.0)
    y0 = np.array([HH_VREST_MV, m0, h0, n0, HH_VREST_MV, HH_VREST_MV])
    probe = np.arange(0.0, duration_ms + 1e-9, 0.05)
    vals = np.array([[i_soma_fn(x), i_api_fn(x), i_bas_fn(x)] for x in probe])
    breaks = [0.0]
    for k in range(1, len(probe)):
        if np.any(vals[k] != vals[k - 1]):
            breaks.append(float(probe[k]))
    breaks.append(float(duration_ms))
    t_all, y_all = [0.0], [y0.copy()]
    state = y0.copy()
    for k in range(len(breaks) - 1):
        start, stop = breaks[k], breaks[k + 1]
        if stop <= start:
            continue
        iv = vals[np.searchsorted(probe, start)]
        sample = _sample_grid(start, stop, dt_out_ms)
        sol = solve_ivp(
            lambda t, y: multicomp_rates(t, y, float(iv[0]), float(iv[1]),
                                         float(iv[2]), morph, soma_active),
            (start, stop), state, method="DOP853", rtol=rtol, atol=atol,
            t_eval=sample)
        if not sol.success:
            raise RuntimeError(sol.message)
        for tt, yy in zip(sol.t, sol.y.T):
            t_all.append(float(tt))
            y_all.append(yy.copy())
        state = sol.y[:, -1]
    t = np.array(t_all)
    y = np.array(y_all)
    i_ax_api = morph["g_axial_apical_ns"] * (y[:, 0] - y[:, 4])
    i_ax_bas = morph["g_axial_basal_ns"] * (y[:, 0] - y[:, 5])
    return {"t_ms": t, "v_soma_mv": y[:, 0], "m": y[:, 1], "h": y[:, 2],
            "n": y[:, 3], "v_apical_mv": y[:, 4], "v_basal_mv": y[:, 5],
            "i_axial_apical_pa": i_ax_api, "i_axial_basal_pa": i_ax_bas,
            "spike_times_ms": _spike_times(t, y[:, 0])}


def passive_steady_state(i_api_pa, i_bas_pa=0.0, i_soma_pa=0.0):
    """Exact steady state of the PASSIVE three-compartment linear system.

    Solves the 3x3 linear equations (soma leak treated as passive here,
    i.e. soma_active=False) for (Vs, Va, Vb). Used as the cable-theory
   对照 for the attenuation test: with current into the apical tip the
    voltage must decay towards the soma.
    """
    morph = derive_multicomp_morphology()
    g_ls = morph["g_leak_soma_ns"]
    g_la = morph["g_leak_apical_ns"]
    g_lb = morph["g_leak_basal_ns"]
    g_aa = morph["g_axial_apical_ns"]
    g_ab = morph["g_axial_basal_ns"]
    el = E_LEAK_MV  # passive compartments reverse at rest (-65 mV)
    # (G) V = I + G*EL  with rows: soma, apical, basal.
    g = np.array([
        [g_ls + g_aa + g_ab, -g_aa, -g_ab],
        [-g_aa, g_la + g_aa, 0.0],
        [-g_ab, 0.0, g_lb + g_ab],
    ])
    rhs = np.array([i_soma_pa, i_api_pa, i_bas_pa]) + el * np.array(
        [g_ls, g_la, g_lb])
    return np.linalg.solve(g, rhs)  # (Vs, Va, Vb) in mV


def cable_length_constant_um(d_um=2.0, r_m_ohm_cm2=None, ra_ohm_cm=100.0):
    """Infinite-cable length constant lambda = sqrt(d * Rm / (4 * Ra)).

    Rm = 1 / gL density = 1 / 0.3 mS/cm^2 = 3333 Ohm*cm^2.
    """
    if r_m_ohm_cm2 is None:
        r_m_ohm_cm2 = 1.0 / (MULTICOMP["g_leak_ms_per_cm2"] * 1e-3)
    d_cm = d_um * 1e-4
    return math.sqrt(d_cm * r_m_ohm_cm2 / (4.0 * ra_ohm_cm)) * 1e4


# --------------------------------------------------------------------------
# Cross-scale coupling (ASSUMED, uncalibrated — same status as PR5)
# --------------------------------------------------------------------------
# Forward: WC/JR region activity E (dimensionless, resting mean E0) ->
# cellular injected current. Two separate gains because LIF takes pA and
# HH takes uA/cm^2; one gain cannot be sensible for both, which is itself
# part of the honest statement: the gains are assumptions, not fits.
WC_BASELINE_E = 0.011  # WC network resting mean E (contract §4.1)
WC_TO_LIF_GAIN_PA_PER_E = 1000.0   # pA per unit E (assumed)
WC_TO_HH_GAIN_UA_PER_CM2_PER_E = 20.0  # uA/cm^2 per unit E (assumed)
# Reverse: cellular firing rate (Hz) -> population drive P (dimensionless).
RATE_TO_P_GAIN_PER_HZ = 0.002  # P units per Hz above baseline (assumed)
RATE_BASELINE_HZ = 0.0
# Amplitude chain (PR5 numbers, reused, not refit): N x coherence = 80,000
# synchronously active pyramidal cells; Pz gain 0.16 uV/(nA*m) (PR6 §1.8).
DIPOLE_N_CELLS = 1_000_000
DIPOLE_COHERENCE = 0.08
PZ_GAIN_UV_PER_NAM = 0.16
# True oddball P300 at Pz for the PR6 gap: 8.89 uV (public EEG constraint).
TRUE_ODDBALL_PZ_UV = 8.89


def wc_to_lif_current_pa(e, gain_pa_per_e=WC_TO_LIF_GAIN_PA_PER_E,
                         baseline_e=WC_BASELINE_E):
    """I_pA = gain * (E - E0). E=0.5 -> 489 pA (just above LIF rheobase
    375 pA, ~60 Hz); E=0.1 -> 89 pA (subthreshold)."""
    return gain_pa_per_e * (e - baseline_e)


def wc_to_hh_current_density_ua_per_cm2(e,
                                        gain=WC_TO_HH_GAIN_UA_PER_CM2_PER_E,
                                        baseline_e=WC_BASELINE_E):
    """HH density = gain * (E - E0). E=0.5 -> 9.78 uA/cm^2, i.e. just at
    the HH sustained-current threshold (~9.8); E=0.1 -> 1.78 (silent)."""
    return gain * (e - baseline_e)


def firing_rate_to_population_drive_p(rate_hz,
                                      gain_per_hz=RATE_TO_P_GAIN_PER_HZ,
                                      baseline_hz=RATE_BASELINE_HZ):
    """dP = gain * (rate - baseline). 60 Hz LIF firing -> dP = 0.12."""
    return gain_per_hz * (rate_hz - baseline_hz)


def cellular_dipole_nam(axial_current_pa, separation_mm):
    """q = I_axial * d * 1e-6 [nA*m] (pA * mm = 1e-6 nA*m)."""
    return axial_current_pa * separation_mm * 1e-6


def implied_scalp_uv(q_nam, pz_gain_uv_per_nam=PZ_GAIN_UV_PER_NAM):
    """Pz scalp potential (uV) for a radial dipole under Pz."""
    return q_nam * pz_gain_uv_per_nam


# --------------------------------------------------------------------------
# Amplitude experiment: what can the cellular route say about the PR6 gap?
# --------------------------------------------------------------------------
def amplitude_experiment():
    """Two cellular-derived numbers, no rescaling anywhere.

    (a) Sustained PSP: constant 75 pA into the apical dendrite for
        500 ms with a PASSIVE soma (clean linear steady state, exact
        linear-solve cross-check available; the active-soma variant is
        reported alongside — it fires one onset spike and then holds a
        subthreshold PSP, mean axial current -87 pA, -0.123 uV).
        Mean axial current over 300-500 ms -> per-cell dipole
        (geometric 110 um separation) -> population q
        (N*coherence = 80,000, PR5 assumption) -> Pz uV.
    (b) Synchronous AP volley: brief 2000 pA / 2 ms soma pulse. Peak
        axial current during the AP -> peak per-cell dipole -> peak
        population Pz uV, with the 1 ms transient duration stated.
    Both are compared with the 55.6 nA*m (8.89 uV at Pz) that the true
    oddball P300 requires, and with the JR route's 1.09 nA*m peak
    (0.174 uV).
    """
    morph = derive_multicomp_morphology()
    # (a) sustained apical drive, passive soma (clean linear PSP)
    tr = simulate_multicomp(lambda _t: 0.0,
                            lambda t: 75.0 if 100.0 <= t < 600.0 else 0.0,
                            lambda _t: 0.0, 600.0, dt_out_ms=0.1,
                            soma_active=False)
    mask = (tr["t_ms"] >= 300.0) & (tr["t_ms"] <= 500.0)
    i_ax_mean = float(np.mean(tr["i_axial_apical_pa"][mask]))
    v_soma_mean = float(np.mean(tr["v_soma_mv"][mask]))
    q_cell = cellular_dipole_nam(i_ax_mean, APICAL_SEPARATION_UM / 1000.0)
    q_pop = q_cell * DIPOLE_N_CELLS * DIPOLE_COHERENCE
    pz_uv = implied_scalp_uv(q_pop)
    # (a2) same drive, active soma (one onset spike, then subthreshold)
    tr_a = simulate_multicomp(lambda _t: 0.0,
                              lambda t: 75.0 if 100.0 <= t < 600.0 else 0.0,
                              lambda _t: 0.0, 600.0, dt_out_ms=0.1,
                              soma_active=True)
    mask_a = (tr_a["t_ms"] >= 300.0) & (tr_a["t_ms"] <= 500.0)
    i_ax_mean_a = float(np.mean(tr_a["i_axial_apical_pa"][mask_a]))
    q_pop_a = (cellular_dipole_nam(i_ax_mean_a, APICAL_SEPARATION_UM / 1000.0)
               * DIPOLE_N_CELLS * DIPOLE_COHERENCE)
    # (b) AP volley
    tr2 = simulate_multicomp(lambda t: 2000.0 if 10.0 <= t < 12.0 else 0.0,
                             lambda _t: 0.0, lambda _t: 0.0, 60.0,
                             dt_out_ms=0.05)
    i_peak = int(np.argmax(np.abs(tr2["i_axial_apical_pa"])))
    i_ax_peak = float(tr2["i_axial_apical_pa"][i_peak])
    q_cell_peak = cellular_dipole_nam(i_ax_peak, APICAL_SEPARATION_UM / 1000.0)
    q_pop_peak = q_cell_peak * DIPOLE_N_CELLS * DIPOLE_COHERENCE
    pz_peak_uv = implied_scalp_uv(q_pop_peak)
    return {
        "sustained_psp": {
            "apical_current_pa": 75.0, "window_ms": [300.0, 500.0],
            "mean_axial_current_pa": i_ax_mean,
            "mean_v_soma_mv": v_soma_mean,
            "separation_mm": APICAL_SEPARATION_UM / 1000.0,
            "q_per_cell_nam": q_cell,
            "q_population_nam": q_pop,
            "pz_uv": pz_uv,
            "n_spikes": len(tr["spike_times_ms"]),
        },
        "sustained_psp_active_soma": {
            "mean_axial_current_pa": i_ax_mean_a,
            "mean_v_soma_mv": float(np.mean(tr_a["v_soma_mv"][mask_a])),
            "q_population_nam": q_pop_a,
            "pz_uv": implied_scalp_uv(q_pop_a),
            "n_spikes": len(tr_a["spike_times_ms"]),
        },
        "ap_volley": {
            "soma_pulse_pa": 2000.0, "pulse_ms": [10.0, 12.0],
            "peak_axial_current_pa": i_ax_peak,
            "peak_latency_ms": float(tr2["t_ms"][i_peak]),
            "q_per_cell_nam": q_cell_peak,
            "q_population_nam": q_pop_peak,
            "pz_peak_uv": pz_peak_uv,
            "n_spikes": len(tr2["spike_times_ms"]),
        },
        "required_for_true_oddball": {
            "pz_uv": TRUE_ODDBALL_PZ_UV,
            "q_nam": TRUE_ODDBALL_PZ_UV / PZ_GAIN_UV_PER_NAM,
        },
        "jr_route_peak_q_nam": 0.174 / PZ_GAIN_UV_PER_NAM,
    }


# --------------------------------------------------------------------------
# NEURON cross-check (built-in hh mechanism)
# --------------------------------------------------------------------------
def neuron_hh_comparison():
    """NEURON soma (L=20 um, d=20 um, hh) vs DOP853, same protocol.

    10 uA/cm^2 step, 10-60 ms; NEURON IClamp in nA = density * area.
    NEURON hh el is set to -54.387 mV to match HH1952 (default -54.3).
    Fixed step dt=0.025 ms, secondorder=2 (Crank-Nicolson). Returns None
    if the neuron package is not importable.
    """
    if importlib.util.find_spec("neuron") is None:
        return None
    from neuron import h
    h.load_file("stdrun.hoc")
    soma = h.Section(name="soma")
    soma.L = 20.0
    soma.diam = 20.0
    soma.insert("hh")
    soma(0.5).hh.el = HH_EL_MV
    h.celsius = 6.3
    h.dt = HH_DT_MS
    h.secondorder = 2
    area_cm2 = math.pi * 20.0 * 20.0 * 1e-8
    stim = h.IClamp(soma(0.5))
    stim.delay = 10.0
    stim.dur = 50.0
    # IClamp amp is in nA: 10 uA/cm^2 * area_cm2 = current in uA; x1000 -> nA.
    stim.amp = 10.0 * area_cm2 * 1000.0
    vec_t = h.Vector()
    vec_v = h.Vector()
    vec_t.record(h._ref_t)
    vec_v.record(soma(0.5)._ref_v)
    h.tstop = 100.0
    h.run()
    t_n = np.array(vec_t)
    v_n = np.array(vec_v)
    ref = simulate_hh(lambda t: 10.0 if 10.0 <= t < 60.0 else 0.0,
                      100.0, dt_out_ms=HH_DT_MS)
    # Interpolate DOP853 trace onto NEURON time grid for the comparison.
    v_ref = np.interp(t_n, ref["t_ms"], ref["v_mv"])
    diff = np.abs(v_n - v_ref)
    sp_n = _spike_times(t_n, v_n)
    sp_r = _spike_times(ref["t_ms"], ref["v_mv"])
    # The fast upstroke (dV/dt ~ hundreds of mV/ms) turns a ~0.02 ms
    # phase difference into mV-level pointwise differences, so also
    # report the difference away from spikes, where dV/dt is small.
    mask = np.ones(len(t_n), dtype=bool)
    for s in sp_r:
        mask &= np.abs(t_n - s) > 5.0
    return {
        "available": True,
        "n_samples": len(t_n),
        "max_abs_diff_mv": float(diff.max()),
        "mean_abs_diff_mv": float(diff.mean()),
        "max_abs_diff_outside_spike_windows_mv": float(diff[mask].max()),
        "neuron_peak_mv": float(v_n.max()),
        "dop853_peak_mv": float(ref["v_mv"].max()),
        "neuron_spike_times_ms": [float(x) for x in sp_n],
        "dop853_spike_times_ms": [float(x) for x in sp_r],
        "max_spike_time_diff_ms": float(max(
            abs(a - b) for a, b in zip(sp_n, sp_r))) if len(sp_n) == len(sp_r) else None,
        "neuron_n_spikes": len(sp_n),
        "dop853_n_spikes": len(sp_r),
    }


# --------------------------------------------------------------------------
# Fixture generation
# --------------------------------------------------------------------------
def _series(t, **cols):
    return {"t_ms": [float(x) for x in t],
            **{k: [float(x) for x in v] for k, v in cols.items()}}


def make_reference():
    morph = derive_multicomp_morphology()
    # LIF: constant 600 pA, 500 ms (fires steadily); rest run at 0 pA.
    lif = simulate_lif(lambda _t: 600.0, 500.0)
    lif_rest = simulate_lif(lambda _t: 0.0, 100.0)
    fi = lif_fi_curve([0.0, 200.0, 300.0, 375.0, 400.0, 500.0, 600.0,
                       800.0, 1000.0, 1500.0, 2000.0])
    # HH: rest, then 10 uA/cm^2 step 10-60 ms, 100 ms total.
    hh_rest = simulate_hh(lambda _t: 0.0, 100.0)
    hh = simulate_hh(lambda t: 10.0 if 10.0 <= t < 60.0 else 0.0, 100.0)
    hh_metrics = hh_ap_metrics(hh)
    hh_rest_v = float(hh_rest["v_mv"][-1])
    # HH convergence floor: RK4-equivalent error is measured by the TS
    # test against this DOP853 trace; here record DOP853 self-error by
    # tightening rtol to 1e-13 and comparing (integrator error floor).
    hh_fine = simulate_hh(lambda t: 10.0 if 10.0 <= t < 60.0 else 0.0, 100.0,
                          rtol=1e-13, atol=1e-15)
    v_fine = np.interp(hh["t_ms"], hh_fine["t_ms"], hh_fine["v_mv"])
    dop853_self_max = float(np.max(np.abs(hh["v_mv"] - v_fine)))
    # HH sustained-current threshold (bisection) and refractory probe.
    thr_1ms = hh_threshold_pulse()
    hh_sustained_sub = simulate_hh(lambda _t: 5.0, 300.0, dt_out_ms=0.1)
    hh_sustained_sup = simulate_hh(lambda _t: 12.0, 300.0, dt_out_ms=0.1)
    # Refractory: two 1 ms pulses at 20 uA/cm^2; second at +3 ms fails,
    # at +15 ms succeeds (verified numerically below in the test file;
    # here record the raw outcomes for the fixture).
    def _two_pulse(dt_ms):
        return simulate_hh(
            lambda t: 20.0 if (10.0 <= t < 11.0 or
                               10.0 + dt_ms <= t < 11.0 + dt_ms) else 0.0,
            60.0, dt_out_ms=0.05)
    refr = {f"gap_{g}ms": len(_two_pulse(g)["spike_times_ms"])
            for g in (3.0, 15.0)}
    # Multi-compartment: passive attenuation (soma passive) + active AP.
    mc_passive = simulate_multicomp(
        lambda _t: 0.0, lambda t: 300.0 if 100.0 <= t < 600.0 else 0.0,
        lambda _t: 0.0, 600.0, soma_active=False)
    mask = mc_passive["t_ms"] >= 550.0
    v_steady = {"v_soma_mv": float(np.mean(mc_passive["v_soma_mv"][mask])),
                "v_apical_mv": float(np.mean(mc_passive["v_apical_mv"][mask])),
                "v_basal_mv": float(np.mean(mc_passive["v_basal_mv"][mask]))}
    ss = passive_steady_state(300.0)
    mc_active = simulate_multicomp(
        lambda t: 1000.0 if 10.0 <= t < 12.0 else 0.0,
        lambda _t: 0.0, lambda _t: 0.0, 60.0, dt_out_ms=0.05)
    mc_metrics = hh_ap_metrics({"t_ms": mc_active["t_ms"],
                                "v_mv": mc_active["v_soma_mv"],
                                "spike_times_ms": mc_active["spike_times_ms"]})
    # Synapse conductance series (single presynaptic spike at 10 ms).
    syn_t = np.arange(0.0, 50.0 + 1e-9, 0.1)
    syn = {
        "ampa_alpha": [synapse_conductance_ns("ampa", 1.0, float(t), [10.0], "alpha")
                       for t in syn_t],
        "gaba_alpha": [synapse_conductance_ns("gaba", 1.0, float(t), [10.0], "alpha")
                       for t in syn_t],
        "ampa_exp": [synapse_conductance_ns("ampa", 1.0, float(t), [10.0], "exponential")
                     for t in syn_t],
        "t_ms": [float(t) for t in syn_t],
    }
    amp = amplitude_experiment()
    neuron = neuron_hh_comparison()
    return {
        "method": "Independent SciPy DOP853; numerical cross-check only",
        "model": "LIF + Hodgkin-Huxley 1952 + 3-compartment pyramidal cell "
                 "+ conductance-based synapses",
        "parameters": {
            "lif": {"c_pf": LIF_C_PF, "g_leak_ns": LIF_GLEAK_NS,
                    "el_mv": LIF_EL_MV, "vth_mv": LIF_VTH_MV,
                    "vreset_mv": LIF_VRESET_MV, "tref_ms": LIF_TREF_MS,
                    "dt_ms": LIF_DT_MS,
                    "rheobase_pa": LIF_GLEAK_NS * (LIF_VTH_MV - LIF_EL_MV)},
            "hh": {"c_uf_per_cm2": HH_C_UF_PER_CM2,
                   "gna_ms_per_cm2": HH_GNA_MS_PER_CM2,
                   "gk_ms_per_cm2": HH_GK_MS_PER_CM2,
                   "gl_ms_per_cm2": HH_GL_MS_PER_CM2,
                   "ena_mv": HH_ENA_MV, "ek_mv": HH_EK_MV, "el_mv": HH_EL_MV,
                   "vrest_mv": HH_VREST_MV, "dt_ms": HH_DT_MS},
            "multicomp": MULTICOMP,
            "morphology_derived": morph,
            "cable_lambda_apical_um": cable_length_constant_um(),
            "synapse": SYNAPSE_DEFAULTS,
            "cross_scale": {
                "wc_baseline_e": WC_BASELINE_E,
                "wc_to_lif_gain_pa_per_e": WC_TO_LIF_GAIN_PA_PER_E,
                "wc_to_hh_gain_ua_per_cm2_per_e": WC_TO_HH_GAIN_UA_PER_CM2_PER_E,
                "rate_to_p_gain_per_hz": RATE_TO_P_GAIN_PER_HZ,
                "rate_baseline_hz": RATE_BASELINE_HZ,
                "dipole_n_cells": DIPOLE_N_CELLS,
                "dipole_coherence": DIPOLE_COHERENCE,
                "pz_gain_uv_per_nam": PZ_GAIN_UV_PER_NAM,
            },
        },
        "metrics": {
            "lif_rest_v_mv": float(lif_rest["v_mv"][-1]),
            "lif_600pa_rate_hz": fi[6]["sim_hz"],
            "lif_600pa_analytic_hz": fi[6]["analytic_hz"],
            "lif_spike_times_600pa_ms": lif["spike_times_ms"],
            "hh_rest_v_mv": hh_rest_v,
            "hh_metrics_10ua": hh_metrics,
            "hh_dop853_self_error_mv": dop853_self_max,
            "hh_threshold_1ms_pulse_ua_per_cm2": thr_1ms,
            "hh_sustained_5ua_n_spikes": len(hh_sustained_sub["spike_times_ms"]),
            "hh_sustained_12ua_n_spikes": len(hh_sustained_sup["spike_times_ms"]),
            "hh_refractory_two_pulse": refr,
            "multicomp_passive_steady_mv": v_steady,
            "multicomp_passive_exact_steady_mv": [float(x) for x in ss],
            "multicomp_passive_attenuation_soma_over_apical":
                (v_steady["v_soma_mv"] - E_LEAK_MV) /
                (v_steady["v_apical_mv"] - E_LEAK_MV),
            "multicomp_active_ap_metrics": mc_metrics,
            "multicomp_active_n_spikes": len(mc_active["spike_times_ms"]),
            "multicomp_active_peak_axial_apical_pa":
                float(np.max(np.abs(mc_active["i_axial_apical_pa"]))),
            "amplitude_experiment": amp,
            "neuron_hh_comparison": neuron,
        },
        "series": {
            "lif_600pa": _series(lif["t_ms"], v_mv=lif["v_mv"]),
            "lif_600pa_spikes_ms": lif["spike_times_ms"],
            "lif_fi": fi,
            "hh_10ua": _series(hh["t_ms"], v_mv=hh["v_mv"], m=hh["m"],
                               h=hh["h"], n=hh["n"],
                               g_na_ms_per_cm2=hh["g_na_ms_per_cm2"],
                               g_k_ms_per_cm2=hh["g_k_ms_per_cm2"]),
            "hh_10ua_spikes_ms": hh["spike_times_ms"],
            "mc_passive": _series(mc_passive["t_ms"],
                                  v_soma_mv=mc_passive["v_soma_mv"],
                                  v_apical_mv=mc_passive["v_apical_mv"],
                                  v_basal_mv=mc_passive["v_basal_mv"]),
            "mc_active": _series(mc_active["t_ms"],
                                 v_soma_mv=mc_active["v_soma_mv"],
                                 v_apical_mv=mc_active["v_apical_mv"],
                                 v_basal_mv=mc_active["v_basal_mv"],
                                 i_axial_apical_pa=mc_active["i_axial_apical_pa"]),
            "synapse": syn,
        },
    }


def main():
    out = Path(__file__).resolve().parents[2] / "tests/pr7/fixtures/cellular-reference.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    result = make_reference()
    out.write_text(json.dumps(result, allow_nan=False, separators=(",", ":")))
    print(json.dumps(result["metrics"], indent=1, default=str))


if __name__ == "__main__":
    main()

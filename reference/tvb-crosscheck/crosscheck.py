"""TVB official-implementation cross-check for the BrainRun Wilson-Cowan engine.

Runs the *official* ``tvb-library`` Simulator (WilsonCowan model,
HeunDeterministic integrator, Linear coupling, Connectivity with
``set_idelays``) on the same weights / tract lengths / initial conditions /
step size as our engine, and compares the E/I trajectories step by step
against our Python reference implementation (``reference/python-model``),
which is already known to agree with the Rust engine to 3.33e-16
(``docs/validation.md`` §3, ``reference/python-model/compare.py``).

What is compared
----------------
* ``free``  : 1000 ms free run, no stimulus.
* ``stim``  : 2000 ms run, pulse on node 40 (lAMYG), amplitude 2.0 model
  units, t in [1000, 1100) ms — the product default stimulus.
* Each scenario is run with the A-set (``theta_e = 0``) and with the demo
  preset (A-set + ``theta_e = 1.0``), G = 0.35, dt = 1 ms, speed 3.0 mm/ms.

How the TVB side is configured (all verified against tvb-library 2.10.0
source, see ``docs/tvb-crosscheck.md`` for the full mapping table)
------------------------------------------------------------------------
* ``WilsonCowan`` parameters are set to the A-set values one by one;
  ``shift_sigmoid`` is set to ``False`` — its default ``True`` changes the
  sigmoid (it subtracts the value at x = 0 so that S(0) = 0) and our engine
  implements the unshifted form.  ``P`` / ``Q`` stay 0.
* ``Linear`` coupling with ``a = G = 0.35``, ``b = 0`` (TVB's default
  ``a = 0.00390625`` is for resting-state fMRI and is *not* used).
* ``Connectivity`` built from ``app/public/brain-assets/connectivity.json``
  (weights, tract_lengths), ``speed = 3.0``; ``set_idelays`` is TVB's own
  ``numpy.rint`` rule.
* ``HeunDeterministic`` with ``dt = 1.0`` (deterministic: no noise).
* ``Raw`` monitor, ``variables_of_interest = ("E", "I")``; it records every
  integration step.
* Explicit zero initial history (``E = I = 0``), so no random initial
  conditions and no use of ``state_variable_range``.
* ``WilsonCowan`` defines no ``state_variable_boundaries``, so the
  integrator's bound/clamp step is a no-op in these runs (verified).

Stimulus — read this before reusing the numbers
------------------------------------------------
TVB's ``Simulator.stimulus`` (``StimuliRegion`` etc.) does **not** enter the
model through ``P``.  It is an additive term on ``dX/dt`` *outside* ``dfun``
(``HeunDeterministic.scheme`` adds ``dt * stimulus`` to the state, and the
stimulus is written into ``stimulus[model.stvar]`` where ``stvar = [0, 1]``
for WilsonCowan, i.e. it drives both E and I).  A ``StimuliRegion`` of
amplitude 2.0 would therefore add ~2.0/ms to ``dE/dt`` and ``dI/dt`` — a
different physical quantity from our ``P = 2.0`` inside the sigmoid
argument, and it cannot reproduce our pulse.  The scheme-level probe in
``probe_stimulus_semantics()`` demonstrates this on the official code.

The ``stim`` scenario below therefore does *not* use ``Simulator.stimulus``.
Instead it uses the official Simulator in three continued segments and
changes the model's per-node ``P`` between segments (``P`` is read fresh by
``WilsonCowan.dfun`` on every call, so this takes effect from the next
step): ``P = 0`` for 0–1000 ms, ``P[40] = 2.0`` for 1000–1100 ms,
``P = 0`` for 1100–2000 ms.  That is the exact ``P(t)`` our engine applies,
driven through the official ``dfun`` / coupling / history / integrator.
It is labelled as such in the output; the ``Simulator.stimulus`` route is
documented as not comparable.

Known structural differences (see docs/tvb-crosscheck.md §4)
-------------------------------------------------------------
1. TVB freezes the delayed coupling across the Heun predictor/corrector:
   one coupling array, computed from history at step ``s``, is used for
   both ``dfun`` calls.  Our engine re-evaluates the coupling at step
   ``s+1`` in the corrector (one step fresher; for idelay == 0 it reads the
   predictor state).  There are no idelay == 0 real edges here (min 2).
2. TVB's ``Connectivity.set_idelays`` also computes delays for weight-0
   edges; ours stores 0 there.  Irrelevant numerically (weight 0), but the
   check below reports it.
3. TVB's ``dfun`` is the numba ``_numba_dfun`` guvectorize kernel; ours is
   NumPy/Rust.  Same equations once ``shift_sigmoid=False``.

Run
---
    /tmp/tvb-venv/bin/python reference/tvb-crosscheck/crosscheck.py
    # (venv: see docs/tvb-crosscheck.md §0 for install notes; the venv is
    #  NOT inside the repository)
Requires: tvb-library, numpy, scipy (via tvb-library), and the BrainRun
Python reference model (``reference/python-model/wilson_cowan.py``).
Writes ``reference/tvb-crosscheck/outputs/crosscheck.json`` and prints a
summary table to stdout.  No product code is touched.
"""

from __future__ import annotations

import json
import logging
import platform
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference" / "python-model"))
from wilson_cowan import Params, Simulator as OurSimulator, StimulusEvent, load_connectivity  # noqa: E402

ASSET = ROOT / "app" / "public" / "brain-assets" / "connectivity.json"
REGIONS = ROOT / "app" / "public" / "brain-assets" / "regions.json"
OUT = Path(__file__).parent / "outputs"

# ---------------------------------------------------------------------------
# Configuration shared by both sides
# ---------------------------------------------------------------------------
DT = 1.0            # ms
SPEED = 3.0         # mm/ms (TVB Connectivity.speed default)
G = 0.35            # Linear coupling slope a (demo preset)
STIM_NODE = 40      # lAMYG
STIM_AMP = 2.0      # model units, on P
STIM_START = 1000.0  # ms
STIM_DUR = 100.0    # ms
FREE_LEN = 1000.0   # ms
STIM_LEN = 2000.0   # ms

A_SET = dict(c_ee=12.0, c_ei=4.0, c_ie=13.0, c_ii=11.0, tau_e=10.0, tau_i=10.0,
             a_e=1.2, b_e=2.8, a_i=1.0, b_i=4.0, theta_e=0.0, theta_i=0.0,
             c_e=1.0, c_i=1.0, r_e=1.0, r_i=1.0, k_e=1.0, k_i=1.0,
             alpha_e=1.0, alpha_i=1.0)

PRESETS = {
    "a_set": dict(A_SET),
    "demo": dict(A_SET, theta_e=1.0),  # demo preset: A-set + theta_e 0 -> 1.0
}


# ---------------------------------------------------------------------------
# TVB side
# ---------------------------------------------------------------------------
def build_tvb_sim(theta_e: float):
    """Build and configure the official TVB Simulator for one preset."""
    from tvb.datatypes.connectivity import Connectivity
    from tvb.simulator import coupling, integrators, models, monitors, simulator

    weights, lengths = load_connectivity(ASSET)
    regions = json.loads(REGIONS.read_text(encoding="utf-8"))
    labels = np.array([r["label"] for r in regions])
    centres = np.array([r["centre"] for r in regions], dtype=np.float64)

    conn = Connectivity(
        weights=weights,
        tract_lengths=lengths,
        speed=np.array([SPEED]),
        region_labels=labels,
        centres=centres,
    )

    p = dict(A_SET, theta_e=theta_e)
    model = models.WilsonCowan(
        c_ee=np.array([p["c_ee"]]), c_ei=np.array([p["c_ei"]]),
        c_ie=np.array([p["c_ie"]]), c_ii=np.array([p["c_ii"]]),
        tau_e=np.array([p["tau_e"]]), tau_i=np.array([p["tau_i"]]),
        a_e=np.array([p["a_e"]]), b_e=np.array([p["b_e"]]),
        a_i=np.array([p["a_i"]]), b_i=np.array([p["b_i"]]),
        theta_e=np.array([p["theta_e"]]), theta_i=np.array([p["theta_i"]]),
        c_e=np.array([p["c_e"]]), c_i=np.array([p["c_i"]]),
        r_e=np.array([p["r_e"]]), r_i=np.array([p["r_i"]]),
        k_e=np.array([p["k_e"]]), k_i=np.array([p["k_i"]]),
        alpha_e=np.array([p["alpha_e"]]), alpha_i=np.array([p["alpha_i"]]),
        P=np.array([0.0]), Q=np.array([0.0]),
        shift_sigmoid=np.array([False]),
        variables_of_interest=("E", "I"),
    )
    coup = coupling.Linear(a=np.array([G]), b=np.array([0.0]))
    integ = integrators.HeunDeterministic(dt=DT)
    mon = monitors.Raw()

    # Explicit zero initial history: (horizon, nvar, nodes, modes).
    # horizon = max idelay + 1; our own rule gives max idelay 46 -> 47.
    from wilson_cowan import build_idelays
    our_idelays = build_idelays(lengths, weights, DT, SPEED)
    horizon = int(our_idelays.max()) + 1
    ic = np.zeros((horizon, 2, weights.shape[0], 1), dtype=np.float64)

    sim = simulator.Simulator(
        model=model, connectivity=conn, coupling=coup, integrator=integ,
        monitors=[mon], initial_conditions=ic,
    )
    sim.configure()

    checks = {
        "tvb_idelays_match_ours_on_weighted_edges": bool(
            np.array_equal(conn.idelays[weights > 0], our_idelays[weights > 0])),
        "max_abs_idelay_diff_weighted_edges": float(
            np.abs(conn.idelays[weights > 0] - our_idelays[weights > 0]).max()),
        "tvb_idelays_nonzero_on_zero_weight_edges": int(
            np.count_nonzero(conn.idelays[weights == 0])),
        "tvb_max_idelay": int(conn.idelays.max()),
        "our_max_idelay": int(our_idelays.max()),
        "horizon": int(conn.horizon),
        "model_stvar_after_configure": [int(v) for v in np.asarray(model.stvar).ravel()],
        "model_cvar": [int(v) for v in np.asarray(model.cvar).ravel()],
        "shift_sigmoid": bool(np.asarray(model.shift_sigmoid).ravel()[0]),
        "state_variable_boundaries": model.state_variable_boundaries,
        "integrator_boundaries": (
            None if integ._integration_state_variable_boundaries is None
            else np.asarray(integ._integration_state_variable_boundaries).tolist()),
        "integrator_dt": float(integ.dt),
        "coupling_a": float(np.asarray(coup.a).ravel()[0]),
        "coupling_b": float(np.asarray(coup.b).ravel()[0]),
        "connectivity_speed": float(np.asarray(conn.speed).ravel()[0]),
        "undirected_flag": bool(conn.undirected),
        # TVB counts the provided 47-row history as past steps, so
        # current_step is 46 after configure and Raw times start at 47 ms;
        # _tvb_run_to_arrays subtracts this exact label offset (uniform-zero
        # history, so the shift is exact, not an approximation).
        "current_step_after_configure": int(sim.current_step),
        "tvb_clock_offset_ms": float(sim.current_step * DT),
    }
    return sim, model, checks


def _tvb_run_to_arrays(sim, length_ms: float, expected_first_t: float = DT):
    """Run a configured sim for length_ms; return (t, E, I) on our time grid.

    Time-label note: TVB counts a provided N-row initial history as past
    steps, so after ``configure()`` ``current_step`` is N-1 (here 46) and the
    first Raw sample is labelled t = 47 ms although it is the first step
    after the t = 0 state.  With a uniform-zero history this is an exact
    label shift (all history rows are the same zeros), so we subtract the
    constant offset ``t[0] - expected_first_t`` and assert it equals
    horizon-1 (46 ms) on every segment, including continuations.
    """
    (t_list, x_list), = sim.run(simulation_length=length_ms)
    t = np.asarray(t_list, dtype=np.float64)
    offset = t[0] - expected_first_t
    assert offset == 46.0, f"unexpected TVB clock offset {offset}"
    t = t - offset
    x = np.asarray(x_list, dtype=np.float64)  # (steps, nvar, nodes, modes)
    E = x[:, 0, :, 0]
    I = x[:, 1, :, 0]
    return t, E, I


def run_tvb_free(theta_e: float):
    sim, model, checks = build_tvb_sim(theta_e)
    t, E, I = _tvb_run_to_arrays(sim, FREE_LEN)
    # TVB Raw records steps 1..N; prepend the t=0 initial state (zeros).
    t = np.concatenate([[0.0], t])
    E = np.vstack([np.zeros((1, E.shape[1])), E])
    I = np.vstack([np.zeros((1, I.shape[1])), I])
    return t, E, I, checks


def run_tvb_stim(theta_e: float):
    """Stimulus via per-node model.P switched between continued Simulator runs.

    Segment 1: P = 0 everywhere, 0-1000 ms.
    Segment 2: P[40] = 2.0, 1000-1100 ms.
    Segment 3: P = 0 everywhere, 1100-2000 ms.
    ``WilsonCowan.dfun`` reads ``self.P`` on every call, so the switch takes
    effect from the first step of the next segment.  Verified by the peak
    response matching our engine's P-pulse (see results JSON).
    """
    sim, model, checks = build_tvb_sim(theta_e)
    t1, E1, I1 = _tvb_run_to_arrays(sim, STIM_START)
    p_on = np.zeros(76, dtype=np.float64)
    p_on[STIM_NODE] = STIM_AMP
    model.P = p_on
    t2, E2, I2 = _tvb_run_to_arrays(sim, STIM_DUR, expected_first_t=STIM_START + DT)
    model.P = np.zeros(76, dtype=np.float64)
    t3, E3, I3 = _tvb_run_to_arrays(sim, STIM_LEN - STIM_START - STIM_DUR,
                                    expected_first_t=STIM_START + STIM_DUR + DT)
    t = np.concatenate([[0.0], t1, t2, t3])
    E = np.vstack([np.zeros((1, E1.shape[1])), E1, E2, E3])
    I = np.vstack([np.zeros((1, I1.shape[1])), I1, I2, I3])
    checks["stimulus_route"] = (
        "per-node model.P switched between continued Simulator runs "
        "(P=0, then P[40]=2.0 for 100 ms, then P=0); NOT Simulator.stimulus")
    checks["P_shape_during_pulse"] = [int(v) for v in np.asarray(p_on).shape]
    return t, E, I, checks


def probe_stimulus_semantics():
    """Scheme-level probe: what does TVB's Simulator.stimulus actually do?

    Calls the official ``HeunDeterministic.scheme`` once from the zero state
    with coupling 0 and a stimulus of 2.0 on the E row of node 40, and the
    same call with stimulus 0.  A ``Simulator.stimulus`` amplitude is added
    to dX/dt *outside* dfun, so one 1 ms step moves E by ~dt * stimulus
    (~1.85 here, dfun feedback included), whereas our P = 2.0 inside the
    sigmoid moves E by ~0.003 in the first ms.  Different quantity, not a
    rescaling of the same thing.
    """
    from tvb.simulator import integrators, models
    import numpy as np

    model = models.WilsonCowan(shift_sigmoid=np.array([False]))
    integ = integrators.HeunDeterministic(dt=1.0)
    integ.configure()
    # Zero state, zero coupling, zero local coupling; stimulus array shaped
    # (nvar, nodes, modes) as the Simulator builds it.
    X = np.zeros((2, 76, 1))
    coupling = np.zeros((2, 76, 1))
    stim = np.zeros((2, 76, 1))
    stim[0, STIM_NODE, 0] = 2.0  # E row only (best case for the stimulus route)
    X_next_stim = integ.scheme(X.copy(), model.dfun, coupling, 0.0, stim)
    X_next_no = integ.scheme(X.copy(), model.dfun, coupling, 0.0, np.zeros((2, 76, 1)))
    # Our engine's first-ms move for a P = 2.0 pulse from the same zero state:
    # one exact Heun step of our Simulator with an event starting at t = 0.
    our = OurSimulator(*load_connectivity(ASSET), Params.demo())
    res1 = our.run(1.0, events=[StimulusEvent(STIM_NODE, 0.0, 1.0, 2.0)])
    first_ms_dE = float(res1.E[1, STIM_NODE] - res1.E[0, STIM_NODE])
    return {
        "tvb_scheme_one_step_dE_node40_with_stimulus_2.0": float(X_next_stim[0, STIM_NODE, 0]),
        "tvb_scheme_one_step_dE_node40_with_stimulus_0.0": float(X_next_no[0, STIM_NODE, 0]),
        "tvb_scheme_one_step_dI_node40_with_stimulus_2.0_on_E_row_only": float(
            X_next_stim[1, STIM_NODE, 0]),
        "our_engine_first_ms_dE_node40_with_P_2.0": first_ms_dE,
        "note": ("TVB stimulus is added to dX/dt outside dfun "
                 "(scheme: X_next = X + dt/2*(f(X)+f(inter)) + dt*stimulus); "
                 "our P enters the sigmoid argument inside dfun."),
    }


# ---------------------------------------------------------------------------
# Frozen-coupling variant (causal check for the one structural difference)
# ---------------------------------------------------------------------------
def frozen_run(weights, lengths, params, duration_ms: float, events):
    """Our Simulator.run, but the corrector reuses the predictor's delayed-E
    matrix — exactly TVB's semantics (one coupling array per step, computed
    from history at step ``s`` and used for both dfun calls).  Comparing this
    variant against TVB isolates the frozen-coupling effect: if the variant
    matches TVB to ~1e-8 while our engine differs by up to 2.7e-02, the whole
    systematic difference is the frozen coupling, not the equations,
    parameters, delays, or stimulus route.
    """
    from wilson_cowan import Simulator as _Sim
    sim = _Sim(weights, lengths, params)
    p = params
    n_steps = int(round(duration_ms / p.dt))
    e_hist = np.zeros((n_steps + 2, sim.n), dtype=np.float64)
    e_hist[0] = sim.E
    E_out = np.zeros((n_steps + 1, sim.n), dtype=np.float64)
    I_out = np.zeros((n_steps + 1, sim.n), dtype=np.float64)
    E_out[0] = sim.E
    I_out[0] = sim.I
    for n in range(n_steps):
        t = n * p.dt
        P = sim._stimulus_vector(t, events)
        e_del1 = sim._delayed_E(e_hist, n)
        dE1, dI1 = sim._deriv(sim.E, sim.I, e_del1, P)
        E_star = sim.E + p.dt * dE1
        I_star = sim.I + p.dt * dI1
        e_hist[n + 1] = E_star
        # FROZEN: reuse e_del1 instead of sim._delayed_E(e_hist, n + 1).
        dE2, dI2 = sim._deriv(E_star, I_star, e_del1, P)
        sim.E = sim.E + (p.dt / 2.0) * (dE1 + dE2)
        sim.I = sim.I + (p.dt / 2.0) * (dI1 + dI2)
        sim._check(sim.E, sim.I)
        sim.step_count += 1
        e_hist[n + 1] = sim.E
        E_out[n + 1] = sim.E
        I_out[n + 1] = sim.I
    return E_out, I_out


# ---------------------------------------------------------------------------
# Our side
# ---------------------------------------------------------------------------
def run_ours(theta_e: float, scenario: str):
    params = Params(theta_e=theta_e)
    weights, lengths = load_connectivity(ASSET)
    sim = OurSimulator(weights, lengths, params)
    if scenario == "free":
        res = sim.run(FREE_LEN, events=[])
    else:
        res = sim.run(STIM_LEN, events=[StimulusEvent(STIM_NODE, STIM_START, STIM_DUR, STIM_AMP)])
    return res.t_ms, res.E, res.I


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------
def compare(t_tvb, E_tvb, I_tvb, t_ours, E_ours, I_ours):
    assert np.array_equal(t_tvb, t_ours), "time grids differ"
    dE = np.abs(E_tvb - E_ours)
    dI = np.abs(I_tvb - I_ours)
    iE, jE = np.unravel_index(np.argmax(dE), dE.shape)
    iI, jI = np.unravel_index(np.argmax(dI), dI.shape)
    profile = {}
    for tt in (10.0, 30.0, 59.0, 100.0, 200.0, 500.0, 1000.0, 1034.0, 1100.0, 1200.0, 2000.0):
        if tt <= t_tvb[-1]:
            profile[f"t={tt:.0f}ms"] = float(dE[int(tt)].max())
    return {
        "steps": int(len(t_tvb) - 1),
        "max_abs_dE": float(dE.max()),
        "rms_dE": float(np.sqrt((dE ** 2).mean())),
        "max_abs_dI": float(dI.max()),
        "rms_dI": float(np.sqrt((dI ** 2).mean())),
        "profile_max_abs_dE": profile,
        "argmax_dE": {"t_ms": float(t_tvb[iE]), "node": int(jE)},
        "argmax_dI": {"t_ms": float(t_tvb[iI]), "node": int(jI)},
        "tvb_peak_E_node40": float(E_tvb[:, STIM_NODE].max()),
        "ours_peak_E_node40": float(E_ours[:, STIM_NODE].max()),
        "tvb_final_mean_E": float(E_tvb[-1].mean()),
        "ours_final_mean_E": float(E_ours[-1].mean()),
        "tvb_final_mean_I": float(I_tvb[-1].mean()),
        "ours_final_mean_I": float(I_ours[-1].mean()),
    }


def main():
    logging.disable(logging.CRITICAL)
    import importlib.metadata as _md
    import numba

    versions = {
        "python": platform.python_version(),
        "tvb-library": _md.version("tvb-library"),
        "numpy": _md.version("numpy"),
        "scipy": _md.version("scipy"),
        "numba": _md.version("numba"),
    }
    print("versions:", versions)

    t0 = time.time()
    probe = probe_stimulus_semantics()
    print("stimulus-semantics probe (one 1 ms Heun step from zero state):")
    for k, v in probe.items():
        print(f"  {k}: {v}")

    results = {"versions": versions, "config": {
        "dt_ms": DT, "speed_mm_per_ms": SPEED, "G": G,
        "stim_node": STIM_NODE, "stim_amplitude": STIM_AMP,
        "stim_start_ms": STIM_START, "stim_duration_ms": STIM_DUR,
        "free_length_ms": FREE_LEN, "stim_length_ms": STIM_LEN,
        "connectivity_asset": "app/public/brain-assets/connectivity.json",
        "our_reference": "reference/python-model/wilson_cowan.py "
                         "(Python vs Rust max deviation 3.33e-16, docs/validation.md §3)",
    }, "stimulus_semantics_probe": probe, "scenarios": {}}

    trajs = {}
    for preset_name, preset in PRESETS.items():
        theta_e = preset["theta_e"]
        for scenario in ("free", "stim"):
            tag = f"{scenario}_{preset_name}"
            print(f"\n[{tag}] running TVB ...", flush=True)
            if scenario == "free":
                t_t, E_t, I_t, checks = run_tvb_free(theta_e)
            else:
                t_t, E_t, I_t, checks = run_tvb_stim(theta_e)
            t_o, E_o, I_o = run_ours(theta_e, scenario)
            row = compare(t_t, E_t, I_t, t_o, E_o, I_o)
            row["checks"] = checks
            results["scenarios"][tag] = row
            trajs[tag] = (t_t, E_t, I_t)
            print(f"{tag:<14} steps={row['steps']:<5} max|dE|={row['max_abs_dE']:.3e} "
                  f"rms_dE={row['rms_dE']:.3e} max|dI|={row['max_abs_dI']:.3e} "
                  f"rms_dI={row['rms_dI']:.3e} "
                  f"argmax_dE t={row['argmax_dE']['t_ms']:.0f}ms node {row['argmax_dE']['node']} "
                  f"peakE40 tvb={row['tvb_peak_E_node40']:.4f} ours={row['ours_peak_E_node40']:.4f}")

    # Causal check: frozen-coupling variant of our engine vs TVB.
    print("\n[frozen-coupling check] ...", flush=True)
    weights, lengths = load_connectivity(ASSET)
    frozen_results = {}
    for tag, theta_e, duration, events in (
            ("free_a_set", 0.0, FREE_LEN, []),
            ("free_demo", 1.0, FREE_LEN, []),
            ("stim_demo", 1.0, STIM_LEN,
             [StimulusEvent(STIM_NODE, STIM_START, STIM_DUR, STIM_AMP)])):
        _, E_t, I_t = trajs[tag]
        E_f, I_f = frozen_run(weights, lengths, Params(theta_e=theta_e), duration, events)
        fr = {"max_abs_dE_vs_tvb": float(np.abs(E_t - E_f).max()),
              "max_abs_dI_vs_tvb": float(np.abs(I_t - I_f).max())}
        frozen_results[tag] = fr
        print(f"{tag:<14} frozen-vs-TVB max|dE|={fr['max_abs_dE_vs_tvb']:.3e} "
              f"max|dI|={fr['max_abs_dI_vs_tvb']:.3e}")
    results["frozen_coupling_check"] = frozen_results

    results["wall_time_s"] = round(time.time() - t0, 1)
    OUT.mkdir(exist_ok=True)
    (OUT / "crosscheck.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT / 'crosscheck.json'}  ({results['wall_time_s']} s)")


if __name__ == "__main__":
    main()

"""Wilson-Cowan neural mass model — Python reference implementation.

Implements the TVB source-code form of the Wilson-Cowan equations
(tvb-library, ``tvb/simulator/models/wilson_cowan.py`` ``dfun``):

    x_e = alpha_e * (c_ee*E - c_ei*I + P - theta_e + coupling_E)
    x_i = alpha_i * (c_ie*E - c_ii*I + Q - theta_i)
    S_e = c_e / (1 + exp(-a_e * (x_e - b_e)))
    S_i = c_i / (1 + exp(-a_i * (x_i - b_i)))
    dE/dt = (-E + (k_e - r_e*E) * S_e) / tau_e
    dI/dt = (-I + (k_i - r_i*I) * S_i) / tau_i

with the long-range coupling entering ONLY the E equation, and the I
equation using ``c_ii * I`` (the TVB online docs misprint this as
``c_ee * I``; the source code uses ``c_ii``).  No ``shift_sigmoid``.

Network coupling (Phase 2 decision, recorded in docs/model-spec.md):
    coupling_E_i(t) = G * sum_j C_ij * E_j(t - d_ij)
i.e. the TVB convention: raw weights times a linear coupling slope G
(TVB's ``Linear`` coupling; its default slope 0.0042 is tuned for
resting-state fMRI and produces no visible single-node propagation in
this configuration — measured, see docs/validation.md — so the demo
uses a larger slope).  d_ij = length_ij / speed, converted to integer
steps with ``idelay_ij = rint(d_ij / dt)`` (round-half-to-even, exactly
the TVB ``Connectivity.set_idelays`` rule).  Conduction speed default
is the TVB ``Connectivity.speed`` default, 3.0 mm/ms.

A row-normalised (mean-field) coupling was tested and REJECTED:
with it, single-node propagation stays below 0.005 even at G = 4-8
(mean-field dilutes one node's signal over ~20 inputs), while the
network stops returning to baseline at G >= 6.  Numbers in
docs/validation.md §2.

IMPORTANT — bistability of the A-set (measured, not assumed): the
A-set single node has THREE fixed points (fsolve + Jacobian,
independent of this integrator): a stable low point E*=0.073, an
unstable saddle E*=0.127, and a stable high point E*=0.475.  Any
pulse of amplitude >= ~0.1 flips a node to the high point
PERMANENTLY.  So with A-set local parameters the product's core loop
(click -> respond -> recover -> click again) breaks: one click
saturates the clicked region forever.  The interactive product
default is therefore ``Params.demo()``: A-set with a single local
parameter changed, theta_e 0 -> 1.0.  That removes the high fixed
point (unique stable point E*=0.011), gives a transient graded
response (peak dE ~0.48, return ~70 ms) and visible network
propagation (pulse: 8/75 nodes > 0.01; 500 ms hold: 18/75 nodes).
``Params()`` keeps the pure A-set as the reference configuration;
the deviation, its reason, and the before/after numbers are recorded
in docs/validation.md §1 and docs/model-spec.md (Phase 2 appendix).

Integration: Heun (predictor-corrector), fixed step dt.
Noise: uniform white noise added to the external input P, amplitude
``noise_amp`` (default 0 = deterministic).  The RNG is SplitMix64,
bit-identical to the Rust implementation, drawn once per node per
derivative evaluation, in node order, predictor draws before
corrector draws.  With ``noise_amp == 0`` the RNG is never used.

PR3 — direct manipulation (mirrors crates/brain-core/src/lib.rs):
``set_weight(i, j, w)`` is SINGLE-SIDED (only C_ij changes, C_ji
untouched; the TVB matrix is only roughly symmetric), range 0–3 with
clamping; ``bias[node]`` is a sustained input added to P on every step,
range −1..+1 with clamping, 0 = no bias.  ``reset()`` clears the bias
but NEVER the weights; only ``reset_weight`` / ``reset_all_weights``
restore TVB originals.  Idelays are built once from the original
weights and never recomputed (see the Rust module docs for why).

No smoothing, no beautification, no hidden activity: every number
returned comes from the equations above.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Parameters (A-set: TVB code defaults, Sanz-Leon et al. 2015 Table 11a)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Params:
    # Local Wilson-Cowan parameters (A-set)
    c_ee: float = 12.0
    c_ei: float = 4.0
    c_ie: float = 13.0
    c_ii: float = 11.0
    tau_e: float = 10.0  # ms
    tau_i: float = 10.0  # ms
    a_e: float = 1.2
    b_e: float = 2.8
    a_i: float = 1.0
    b_i: float = 4.0
    theta_e: float = 0.0
    theta_i: float = 0.0
    c_e: float = 1.0
    c_i: float = 1.0
    r_e: float = 1.0
    r_i: float = 1.0
    k_e: float = 1.0
    k_i: float = 1.0
    alpha_e: float = 1.0
    alpha_i: float = 1.0
    # Network / integration
    # G is the linear coupling slope (TVB convention): coupling_E_i =
    # G * sum_j C_ij * E_j(t - d_ij), with C the raw weights (0-3).
    # NOTE: Params() is the A-set reference configuration.  With A-set
    # local parameters the network sits on the high branch (see module
    # docstring); the interactive product default is Params.demo().
    G: float = 0.35      # global coupling strength (linear slope)
    speed: float = 3.0   # mm/ms, TVB Connectivity.speed default
    dt: float = 1.0      # ms, fixed integration step
    # Stimulus defaults (model units; UI knob mapping is a Phase 3 concern)
    stim_amplitude: float = 2.0
    stim_duration_ms: float = 100.0
    # Noise (off by default; see module docstring)
    noise_amp: float = 0.0
    seed: int = 0

    @classmethod
    def demo(cls) -> "Params":
        """Interactive product default: A-set with theta_e 0 -> 1.0.

        Removes the A-set high fixed point (unique stable point
        E*=0.011), so a click gives a transient graded response that
        returns to baseline, and connected regions respond visibly
        (pulse: 8/75 nodes > 0.01; 500 ms hold: 18/75 nodes; both return
        to baseline).  G=0.35 is the measured balance point: at G=0.4 a
        hold longer than ~150 ms latches the whole network; at G=0.3 a
        pulse reaches only 6 nodes.  Holds >= 1000 ms still latch the
        network even at G=0.35 (documented boundary, Reset restores).
        Full numbers and justification: docs/validation.md §1,
        docs/model-spec.md Phase 2 appendix.
        """
        return cls(theta_e=1.0)


# ---------------------------------------------------------------------------
# Deterministic RNG (SplitMix64) — must match crates/brain-core exactly
# ---------------------------------------------------------------------------

_MASK64 = (1 << 64) - 1


class SplitMix64:
    """SplitMix64 generator. next_f64() returns a float in [0, 1)."""

    def __init__(self, seed: int):
        self.state = seed & _MASK64

    def next_u64(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & _MASK64
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & _MASK64
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & _MASK64
        return z ^ (z >> 31)

    def next_f64(self) -> float:
        return (self.next_u64() >> 11) * (1.0 / 9007199254740992.0)

    def noise_vector(self, n: int) -> np.ndarray:
        """Uniform noise in [-1, 1) per node, in node order."""
        return np.array([2.0 * self.next_f64() - 1.0 for _ in range(n)])


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def load_connectivity(path: str | Path) -> tuple[np.ndarray, np.ndarray]:
    """Load weights/lengths from the Phase 1 pre-processed asset.

    The asset already has the diagonal zeroed and lengths kept only
    where weight > 0.  Raw files under scripts/prepare-brain-data/raw/
    are never used here.
    """
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    weights = np.asarray(data["weights"], dtype=np.float64)
    lengths = np.asarray(data["lengths"], dtype=np.float64)
    if weights.shape != lengths.shape or weights.ndim != 2 or weights.shape[0] != weights.shape[1]:
        raise ValueError(f"weights/lengths must be square and equal-shaped, got {weights.shape} vs {lengths.shape}")
    if np.any(np.diag(weights) != 0.0):
        raise ValueError("weights diagonal must already be zeroed by preprocessing")
    return weights, lengths


def build_idelays(lengths: np.ndarray, weights: np.ndarray, dt: float, speed: float) -> np.ndarray:
    """Integer conduction delays in integration steps.

    idelay = rint((length / speed) / dt), round-half-to-even — the exact
    TVB ``Connectivity.set_idelays`` rule (numpy.rint).  Edges with
    weight == 0 get idelay 0 (unused: their normalised weight is 0).
    """
    delays_ms = np.where(weights > 0.0, lengths / speed, 0.0)
    return np.rint(delays_ms / dt).astype(np.int64)


# ---------------------------------------------------------------------------
# Simulator
# ---------------------------------------------------------------------------


class DivergenceError(RuntimeError):
    """Raised the moment a state becomes non-finite or absurdly large."""


@dataclass
class StimulusEvent:
    """External input P on one node: amplitude while t in [start, start+duration)."""

    node: int
    start_ms: float
    duration_ms: float
    amplitude: float


@dataclass
class RunResult:
    t_ms: np.ndarray          # shape (n_steps+1,), includes t=0
    E: np.ndarray             # shape (n_steps+1, n_nodes)
    I: np.ndarray             # shape (n_steps+1, n_nodes)
    P: np.ndarray             # shape (n_steps+1, n_nodes), external input actually applied
    params: Params
    n_steps: int


class Simulator:
    """Wilson-Cowan network simulator, Heun, fixed dt, delayed coupling."""

    def __init__(
        self,
        weights: np.ndarray,
        lengths: np.ndarray,
        params: Params | None = None,
        e0: float = 0.0,
        i0: float = 0.0,
    ):
        self.params = params or Params()
        p = self.params
        self.n = weights.shape[0]
        self.weights = np.array(weights, dtype=np.float64, copy=True)
        # PR3: TVB originals (restore source; never mutated) and the
        # sustained per-node bias (0 = no bias).
        self.weights_orig = np.array(weights, dtype=np.float64, copy=True)
        self.bias = np.zeros(self.n, dtype=np.float64)
        self.lengths = np.array(lengths, dtype=np.float64, copy=True)
        # Raw-sum coupling (TVB convention): coupling_E_i =
        # G * sum_j C_ij * E_j(t - d_ij).  No normalisation.
        self.idelays = build_idelays(self.lengths, self.weights, p.dt, p.speed)
        self.max_delay = int(self.idelays.max()) if self.n else 0
        self.e0 = float(e0)
        self.i0 = float(i0)
        self.reset()

    # -- state ---------------------------------------------------------
    def reset(self) -> None:
        """Deterministic initial state: E = e0, I = i0 everywhere, history = IC.

        PR3: clears the sustained bias (an applied input) but NEVER the
        weights — edited weights survive a reset by design.
        """
        self.E = np.full(self.n, self.e0, dtype=np.float64)
        self.I = np.full(self.n, self.i0, dtype=np.float64)
        self.step_count = 0
        self.rng = SplitMix64(self.params.seed)
        self.bias = np.zeros(self.n, dtype=np.float64)

    # -- PR3: runtime weight editing (single-sided, range 0–3) ---------
    WEIGHT_MIN = 0.0
    WEIGHT_MAX = 3.0
    BIAS_MIN = -1.0
    BIAS_MAX = 1.0

    def weight(self, i: int, j: int) -> float:
        """Current live weight C_ij."""
        return float(self.weights[i, j])

    def original_weight(self, i: int, j: int) -> float:
        """TVB original weight C_ij (as passed to the constructor)."""
        return float(self.weights_orig[i, j])

    def set_weight(self, i: int, j: int, w: float) -> float:
        """Set one weight, SINGLE-SIDED: only C_ij changes, C_ji untouched.

        Clamps to [0, 3] and returns the value actually stored.  The
        diagonal stays zero and out-of-range indices raise ValueError.
        Takes effect from the next step.
        """
        if not (0 <= i < self.n and 0 <= j < self.n):
            raise ValueError(f"weight index ({i},{j}) out of range for n={self.n}")
        if i == j:
            raise ValueError("diagonal weights stay zero")
        w = min(self.WEIGHT_MAX, max(self.WEIGHT_MIN, float(w)))
        self.weights[i, j] = w
        return w

    def reset_weight(self, i: int, j: int) -> float:
        """Restore one weight to its TVB original value; returns that value."""
        if not (0 <= i < self.n and 0 <= j < self.n):
            raise ValueError(f"weight index ({i},{j}) out of range for n={self.n}")
        if i == j:
            raise ValueError("diagonal weights stay zero")
        w = float(self.weights_orig[i, j])
        self.weights[i, j] = w
        return w

    def reset_all_weights(self) -> None:
        """Restore ALL weights to their TVB original values."""
        self.weights = self.weights_orig.copy()

    # -- PR3: sustained bias input (range −1..+1, 0 = off) --------------
    def bias_value(self, node: int) -> float:
        """Current sustained bias on ``node`` (0 = no bias)."""
        return float(self.bias[node])

    def set_bias(self, node: int, value: float) -> float:
        """Set the sustained bias on ``node``, clamped to [−1, +1];
        returns the value actually stored.  Added to P on every step
        until cleared."""
        if not 0 <= node < self.n:
            raise ValueError(f"bias node {node} out of range for n={self.n}")
        value = min(self.BIAS_MAX, max(self.BIAS_MIN, float(value)))
        self.bias[node] = value
        return value

    def clear_bias(self, node: int) -> None:
        """Clear the sustained bias on one node (back to 0 = no bias)."""
        if not 0 <= node < self.n:
            raise ValueError(f"bias node {node} out of range for n={self.n}")
        self.bias[node] = 0.0

    def clear_all_bias(self) -> None:
        """Clear the sustained bias on all nodes."""
        self.bias = np.zeros(self.n, dtype=np.float64)

    # -- core ----------------------------------------------------------
    def _sigmoid(self, x: np.ndarray, a: float, b: float, c: float) -> np.ndarray:
        # Clip the exponent so both languages agree exactly even for
        # extreme inputs (exp overflow would give inf in one and a huge
        # finite value in the other); 1/(1+exp(700)) ~ 1e-304 ~ 0.
        z = np.clip(-a * (x - b), -700.0, 700.0)
        return c / (1.0 + np.exp(z))

    def _delayed_E(self, e_hist: np.ndarray, step: int) -> np.ndarray:
        """E_delayed[i, j] = E_j at step (step - idelay_ij).

        ``e_hist`` rows are E snapshots, row ``step`` is the current
        state; for the corrector call the caller appends the predictor
        state as the extra last row so index ``step`` resolves to it.
        Steps before t=0 read as the initial state (row 0).
        """
        idx = np.maximum(step - self.idelays, 0)  # (n, n) step indices into e_hist rows
        j = np.arange(self.n)[None, :]
        return e_hist[idx, j]

    def _deriv(
        self,
        E: np.ndarray,
        I: np.ndarray,
        e_delayed: np.ndarray,
        P: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        p = self.params
        coupling = p.G * np.sum(self.weights * e_delayed, axis=1)
        if p.noise_amp != 0.0:
            P = P + p.noise_amp * self.rng.noise_vector(self.n)
        x_e = p.alpha_e * (p.c_ee * E - p.c_ei * I + P - p.theta_e + coupling)
        x_i = p.alpha_i * (p.c_ie * E - p.c_ii * I - p.theta_i)
        s_e = self._sigmoid(x_e, p.a_e, p.b_e, p.c_e)
        s_i = self._sigmoid(x_i, p.a_i, p.b_i, p.c_i)
        dE = (-E + (p.k_e - p.r_e * E) * s_e) / p.tau_e
        dI = (-I + (p.k_i - p.r_i * I) * s_i) / p.tau_i
        return dE, dI

    def _check(self, E: np.ndarray, I: np.ndarray) -> None:
        if not (np.all(np.isfinite(E)) and np.all(np.isfinite(I))):
            raise DivergenceError(f"non-finite state at step {self.step_count} (t={self.step_count * self.params.dt} ms)")
        if np.max(np.abs(E)) > 1e6 or np.max(np.abs(I)) > 1e6:
            raise DivergenceError(f"state magnitude > 1e6 at step {self.step_count}")

    def _stimulus_vector(self, t_ms: float, events: list[StimulusEvent]) -> np.ndarray:
        P = np.zeros(self.n, dtype=np.float64)
        for ev in events:
            if ev.start_ms <= t_ms < ev.start_ms + ev.duration_ms:
                P[ev.node] += ev.amplitude
        return P

    def _applied_p(self, t_ms: float, events: list[StimulusEvent]) -> np.ndarray:
        """External input actually applied: stimulus events PLUS the
        sustained per-node bias (PR3).  This is what ``run`` records."""
        return self._stimulus_vector(t_ms, events) + self.bias

    def run(
        self,
        duration_ms: float,
        events: list[StimulusEvent] | None = None,
        snapshot_every: int = 1,
    ) -> RunResult:
        """Run for ``duration_ms``. Returns full traces (every step if
        snapshot_every == 1).  The simulator is NOT reset first: call
        reset() explicitly when a fresh deterministic run is wanted."""
        p = self.params
        events = events or []
        n_steps = int(round(duration_ms / p.dt))
        # History of E: row s is the state at step s.  We keep one extra
        # row so the corrector can read "step n+1 - idelay" with
        # idelay == 0 as the predictor state.
        e_hist = np.zeros((n_steps + 2, self.n), dtype=np.float64)
        e_hist[0] = self.E
        E_out = np.zeros((n_steps + 1, self.n), dtype=np.float64)
        I_out = np.zeros((n_steps + 1, self.n), dtype=np.float64)
        P_out = np.zeros((n_steps + 1, self.n), dtype=np.float64)
        E_out[0] = self.E
        I_out[0] = self.I
        P_out[0] = self._applied_p(0.0, events)

        for n in range(n_steps):
            t = n * p.dt
            P = self._applied_p(t, events)
            # Predictor (Euler) using delayed E at step n.
            e_del1 = self._delayed_E(e_hist, n)
            dE1, dI1 = self._deriv(self.E, self.I, e_del1, P)
            E_star = self.E + p.dt * dE1
            I_star = self.I + p.dt * dI1
            # Corrector: delayed E at step n+1; row n+1 of e_hist holds
            # the predictor state so idelay == 0 reads E_star.
            e_hist[n + 1] = E_star
            e_del2 = self._delayed_E(e_hist, n + 1)
            dE2, dI2 = self._deriv(E_star, I_star, e_del2, P)
            self.E = self.E + (p.dt / 2.0) * (dE1 + dE2)
            self.I = self.I + (p.dt / 2.0) * (dI1 + dI2)
            self._check(self.E, self.I)
            self.step_count += 1
            e_hist[n + 1] = self.E
            E_out[n + 1] = self.E
            I_out[n + 1] = self.I
            P_out[n + 1] = self._applied_p((n + 1) * p.dt, events)

        t_ms = np.arange(n_steps + 1, dtype=np.float64) * p.dt
        if snapshot_every > 1:
            sl = slice(0, n_steps + 1, snapshot_every)
            return RunResult(t_ms[sl], E_out[sl], I_out[sl], P_out[sl], p, n_steps)
        return RunResult(t_ms, E_out, I_out, P_out, p, n_steps)


def default_params(**overrides) -> Params:
    """A-set defaults with optional field overrides."""
    return replace(Params(), **overrides)

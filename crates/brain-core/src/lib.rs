//! Wilson-Cowan neural mass model engine — Rust implementation.
//!
//! Mirrors `reference/python-model/wilson_cowan.py` operation for
//! operation: same TVB source-code equations, same A-set defaults, same
//! Heun integrator, same delay rule (`rint`, round-half-to-even), same
//! SplitMix64 noise, same draw order.  See `docs/model-spec.md` and
//! `docs/validation.md` for the verified numbers and the documented
//! deviation of the interactive demo preset (`Params::demo`).
//!
//! Coupling is the TVB convention (raw weights, linear slope `G`):
//! `coupling_E_i(t) = G * sum_j C_ij * E_j(t - d_ij)` with
//! `d_ij = length_ij / speed`.  No normalisation, no smoothing, no
//! hidden activity: every number returned comes from the equations.
//!
//! PR3 — direct manipulation (review §5 problem 3, §7 PR3):
//! * Weights are editable at runtime via `set_weight(i, j, w)`.
//!   Semantics are SINGLE-SIDED: only C_ij changes, C_ji is untouched.
//!   The TVB matrix is only roughly symmetric (max |C_ij − C_ji| = 3.0
//!   over the 76×76 matrix), so the direction matters; single-sided is
//!   the semantics the review asked for ("运行时单边权重修改接口").
//!   Idelays are built once from the ORIGINAL weights and never
//!   recomputed: every edge the UI can edit has original weight > 0, so
//!   its delay already exists; setting the weight to 0 only silences the
//!   coupling term (`deriv` skips `w == 0`), and restoring the weight
//!   reuses the original delay.  Range 0–3 (TVB raw weight range);
//!   out-of-range values are clamped to [0, 3].
//! * Bias: `bias[i]` is a sustained external input added to P_i on
//!   every step (added in `step_one`, so it enters the Heun predictor
//!   AND corrector identically and appears in the reported P).  Range
//!   −1..+1, 0 = no bias.  Positive is excitatory (raises E), negative
//!   is inhibitory (lowers E).  This is NOT a pulse: it stays on until
//!   cleared.
//! * `reset()` restores the deterministic initial state and clears the
//!   bias (bias is an applied input, like a stimulus) but NEVER touches
//!   the weights: weights are structural edits and only
//!   `reset_weight` / `reset_all_weights` change them back.  The UI
//!   states this RESET semantics explicitly.
//!
//! PR4 — living default (review §5 problem 1 + problem 4, §7 PR4):
//! * Background activity modes (`BgMode`, `Params::bg_mode`):
//!   Quiet = the old silent baseline (no background drive, behaviour
//!   identical to before); Spontaneous = a per-node Ornstein–Uhlenbeck
//!   process added to P (see `Params::ou_tau_ms` / `ou_sigma`);
//!   Oscillatory = a parameter preset (`Params::oscillatory()`) whose
//!   rhythm comes from the Wilson–Cowan dynamics themselves (or, if no
//!   stable limit cycle exists in this parameter family, an explicitly
//!   labelled external drive — never a fake spontaneous rhythm).
//! * The OU state lives in the engine and is advanced EXACTLY ONCE per
//!   step, in `step_one` — never inside `deriv`, which Heun calls twice
//!   per step (predictor + corrector).  The OU draws come from the same
//!   SplitMix64 RNG as the white noise, in node order, two uniforms per
//!   node (Box–Muller, cosine branch); with `noise_amp == 0` the OU
//!   draws are the only RNG use, so same seed + same parameters gives a
//!   bit-identical activity sequence.
//! * Snapshots (`StateSnapshot`): the full experiment state — params,
//!   live weights, bias, step count, RNG state, OU state, E/I, and the
//!   delayed-coupling history (`e_hist` + `hist_base`) — so restoring
//!   reproduces not just the instant state but the subsequent
//!   trajectory bit-for-bit.
//
//! The library uses `serde` only for the `StateSnapshot` / `Params` JSON
//! encoding (snapshots) and the `brain-core-run` binary.

use std::fmt;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Background activity mode (PR4)
// ---------------------------------------------------------------------------

/// Background activity mode.  Quiet is the pre-PR4 silent baseline;
/// Spontaneous adds a per-node Ornstein–Uhlenbeck drive to P;
/// Oscillatory selects the `Params::oscillatory()` parameter preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum BgMode {
    #[default]
    Quiet,
    Spontaneous,
    Oscillatory,
}

// ---------------------------------------------------------------------------
// Parameters (A-set: TVB code defaults, Sanz-Leon et al. 2015 Table 11a)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Params {
    pub c_ee: f64,
    pub c_ei: f64,
    pub c_ie: f64,
    pub c_ii: f64,
    pub tau_e: f64, // ms
    pub tau_i: f64, // ms
    pub a_e: f64,
    pub b_e: f64,
    pub a_i: f64,
    pub b_i: f64,
    pub theta_e: f64,
    pub theta_i: f64,
    pub c_e: f64,
    pub c_i: f64,
    pub r_e: f64,
    pub r_i: f64,
    pub k_e: f64,
    pub k_i: f64,
    pub alpha_e: f64,
    pub alpha_i: f64,
    /// Linear coupling slope (TVB convention): coupling_E_i =
    /// G * sum_j C_ij * E_j(t - d_ij), C the raw weights (0-3).
    pub g: f64,
    /// mm/ms, TVB Connectivity.speed default.
    pub speed: f64,
    /// ms, fixed integration step.
    pub dt: f64,
    pub stim_amplitude: f64,
    pub stim_duration_ms: f64,
    /// Uniform white-noise amplitude on P (model units); 0 = deterministic.
    pub noise_amp: f64,
    pub seed: u64,
    /// PR4: background activity mode (Quiet = pre-PR4 silent baseline).
    pub bg_mode: BgMode,
    /// PR4: OU correlation time (ms).  The OU process is
    /// `dx = -(x/tau) dt + sigma * sqrt(2 dt / tau) * N(0,1)`,
    /// Euler–Maruyama, advanced once per step in `step_one`.
    pub ou_tau_ms: f64,
    /// PR4: OU stationary standard deviation (model units of P).
    /// The drive added to P_i is the OU state x_i itself, so the
    /// stationary distribution of the background input is N(0, sigma²).
    pub ou_sigma: f64,
    /// PR4: constant background input added to P on every node, every
    /// step (model units of P; 0 = none).  Part of the parameter set,
    /// so it is stored in snapshots and survives `reset()` — unlike
    /// the PR3 bias, which is a user-applied input cleared by reset.
    pub drive_const: f64,
    /// PR4: external sinusoidal drive (Oscillatory mode only): the same
    /// in-phase sine is added to P on every node,
    /// `P_sine(t) = ext_sine_amp * sin(2*pi*ext_sine_freq_hz*t)`,
    /// with t the ABSOLUTE simulation time.  This is an EXTERNAL drive
    /// signal, explicitly labelled as such in the UI and docs — it is
    /// NOT a spontaneous rhythm (no stable limit cycle exists in this
    /// Wilson–Cowan parameter family; see reference/python-model/
    /// pr4_scan*.py).  No RNG is involved, so it is deterministic
    /// regardless of seed.
    pub ext_sine_amp: f64,
    /// PR4: frequency (Hz) of the external sinusoidal drive.
    pub ext_sine_freq_hz: f64,
}

impl Default for Params {
    /// A-set reference configuration.  NOTE: with A-set local
    /// parameters the network sits on the high branch (the A-set single
    /// node is bistable — see docs/validation.md §1).  The interactive
    /// product default is `Params::demo()`, not this.
    fn default() -> Self {
        Params {
            c_ee: 12.0,
            c_ei: 4.0,
            c_ie: 13.0,
            c_ii: 11.0,
            tau_e: 10.0,
            tau_i: 10.0,
            a_e: 1.2,
            b_e: 2.8,
            a_i: 1.0,
            b_i: 4.0,
            theta_e: 0.0,
            theta_i: 0.0,
            c_e: 1.0,
            c_i: 1.0,
            r_e: 1.0,
            r_i: 1.0,
            k_e: 1.0,
            k_i: 1.0,
            alpha_e: 1.0,
            alpha_i: 1.0,
            g: 0.35,
            speed: 3.0,
            dt: 1.0,
            stim_amplitude: 2.0,
            stim_duration_ms: 100.0,
            noise_amp: 0.0,
            seed: 0,
            bg_mode: BgMode::Quiet,
            ou_tau_ms: 100.0,
            ou_sigma: 0.10,
            drive_const: 0.0,
            ext_sine_amp: 0.0,
            ext_sine_freq_hz: 10.0,
        }
    }
}

impl Params {
    /// Interactive product default: A-set with theta_e 0 -> 1.0.
    /// Removes the A-set high fixed point (unique stable point
    /// E*=0.011), so a click gives a transient graded response that
    /// returns to baseline, with visible network propagation
    /// (pulse: 8/75 nodes > 0.01; 500 ms hold: 18/75 nodes).
    /// Full numbers and justification: docs/validation.md §1.
    pub fn demo() -> Self {
        Params {
            theta_e: 1.0,
            ..Params::default()
        }
    }

    /// Oscillatory preset (PR4): demo parameters + an explicitly
    /// labelled external sinusoidal drive.
    ///
    /// The parameter scans (reference/python-model/pr4_scan.py,
    /// pr4_scan2.py, pr4_scan3.py) found NO stable limit cycle in this
    /// Wilson–Cowan parameter family — every candidate (including the
    /// TVB Table 1 set, with and without constant drive P in
    /// {0.2, 0.5, 1.0}, from every initial condition) settles to a
    /// fixed point, single node and 76-node network alike.  The
    /// Table 1 set itself settles at a HIGH fixed point (single node
    /// E*=0.32, network mean E*=0.49), i.e. next to the locked state,
    /// so it is rejected as a preset.  This preset therefore does NOT
    /// claim a spontaneous rhythm: it drives the demo network with a
    /// documented 10 Hz sine of amplitude 0.30 (model units of P), in
    /// phase on all nodes.  Measured on the 76-node network (G=0.35):
    /// mean E oscillates in [0.0113, 0.0211] (peak-to-peak 0.0099, max
    /// single-node peak-to-peak 0.0125) at 10.00 Hz (FFT peak), max mean
    /// E 0.021 over 60 s — far below the 0.15 lock threshold — and a
    /// pulse on top still gives its full transient response (peak
    /// |ΔE[40]| = 0.483, and the network returns to baseline afterwards:
    /// a 0.50 amplitude would NOT return — see
    /// reference/python-model/pr4_pulse_safety.py).  Numbers verified by
    /// reference/python-model/pr4_sine_scan.py; see docs/model-spec.md §9.
    pub fn oscillatory() -> Self {
        Params {
            theta_e: 1.0,
            bg_mode: BgMode::Oscillatory,
            ext_sine_amp: 0.30,
            ext_sine_freq_hz: 10.0,
            ..Params::default()
        }
    }
}

// ---------------------------------------------------------------------------
// Deterministic RNG (SplitMix64) — must match the Python implementation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        SplitMix64 { state: seed }
    }

    /// Raw internal state (PR4: snapshots store it so a restored run
    /// continues the exact same random sequence).
    pub fn state(&self) -> u64 {
        self.state
    }

    /// Restore a state previously read with `state()`.
    pub fn from_state(state: u64) -> Self {
        SplitMix64 { state }
    }

    /// Standard normal draw (Box–Muller, cosine branch) — PR4 OU drive.
    /// Consumes exactly two uniforms, in order.  `u1` is mapped to
    /// (0, 1] so `ln(u1)` is never evaluated at 0.  The Python mirror
    /// uses the identical formula (`math.log` / `math.cos`); the two
    /// implementations are cross-checked bit-for-bit in tests/pr4.
    pub fn next_gaussian(&mut self) -> f64 {
        let u1 = 1.0 - self.next_f64();
        let u2 = self.next_f64();
        (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }

    /// Uniform float in [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64) * (1.0 / 9007199254740992.0)
    }
}

// ---------------------------------------------------------------------------
// Delays
// ---------------------------------------------------------------------------

/// Integer conduction delays in integration steps.
///
/// `idelay = rint((length / speed) / dt)`, round-half-to-even — the exact
/// TVB `Connectivity.set_idelays` rule.  Edges with weight == 0 get
/// idelay 0 (unused: their weight is 0).
pub fn build_idelays(lengths: &[Vec<f64>], weights: &[Vec<f64>], dt: f64, speed: f64) -> Vec<Vec<i64>> {
    let n = weights.len();
    let mut out = vec![vec![0i64; n]; n];
    for i in 0..n {
        for j in 0..n {
            if weights[i][j] > 0.0 {
                let delay_ms = lengths[i][j] / speed;
                out[i][j] = (delay_ms / dt).round_ties_even() as i64;
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Events / results / errors
// ---------------------------------------------------------------------------

/// External input P on one node: amplitude while
/// `t in [start_ms, start_ms + duration_ms)`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StimulusEvent {
    pub node: usize,
    pub start_ms: f64,
    pub duration_ms: f64,
    pub amplitude: f64,
}

#[derive(Debug, Clone)]
pub struct RunResult {
    pub t_ms: Vec<f64>,
    /// E traces, one row per step (row 0 is t=0).
    pub e: Vec<Vec<f64>>,
    pub i: Vec<Vec<f64>>,
    /// External input actually applied, one row per step.
    pub p: Vec<Vec<f64>>,
    pub n_steps: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DivergenceError {
    pub step: usize,
    pub time_ms: f64,
    pub detail: String,
}

impl fmt::Display for DivergenceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "diverged at step {} (t={} ms): {}", self.step, self.time_ms, self.detail)
    }
}

impl std::error::Error for DivergenceError {}

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

pub struct Simulator {
    pub params: Params,
    pub n: usize,
    /// Live coupling matrix (PR3: edited at runtime via `set_weight`).
    weights: Vec<Vec<f64>>,
    /// TVB original weights as passed to `new()` (PR3: restore source).
    /// Never mutated after construction; `reset()` does not touch it.
    weights_orig: Vec<Vec<f64>>,
    /// Sustained per-node bias input added to P every step (PR3).
    /// 0 = no bias. Range −1..+1, clamped on set.
    bias: Vec<f64>,
    #[allow(dead_code)]
    lengths: Vec<Vec<f64>>,
    idelays: Vec<Vec<i64>>,
    /// Largest delay in steps; history is trimmed to `max_idelay + 8`
    /// rows so long interactive runs do not grow memory without bound.
    max_idelay: i64,
    e: Vec<f64>,
    i: Vec<f64>,
    /// History of E: row s is the state at absolute step
    /// `hist_base + s`.  Rows before `hist_base` have been trimmed.
    e_hist: Vec<Vec<f64>>,
    hist_base: usize,
    step_count: usize,
    rng: SplitMix64,
    /// PR4: per-node Ornstein–Uhlenbeck background-drive state (model
    /// units of P).  Zero at reset; advanced once per step in
    /// `step_one` when `bg_mode == Spontaneous`; part of snapshots.
    ou: Vec<f64>,
    e0: f64,
    i0: f64,
}

/// Schema version of the `StateSnapshot` JSON (PR6 R2).  Written by
/// `take_snapshot`; read back by `parseSnapshotSummary` on the TS side.
/// Snapshots written before PR6 have no `version` field and deserialise
/// as 1 via `default_snapshot_version`, so old JSON still restores.
pub const STATE_SNAPSHOT_VERSION: u32 = 1;

fn default_snapshot_version() -> u32 {
    STATE_SNAPSHOT_VERSION
}

/// PR4: a complete, restorable experiment state.  Everything needed to
/// resume the exact trajectory: params, live weights, bias, step count,
/// RNG state, OU state, E/I, and the delayed-coupling history
/// (`e_hist` rows are the states at absolute steps
/// `hist_base .. hist_base + len`).  `weights_orig` is deliberately NOT
/// stored: it never changes after construction, so a restore cannot
/// corrupt the TVB-original reference.  Serialised as JSON for the
/// WASM / localStorage snapshot path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StateSnapshot {
    /// Schema version of this snapshot JSON (PR6 R2).  Missing in
    /// pre-PR6 JSON, in which case serde defaults it to 1.
    #[serde(default = "default_snapshot_version")]
    pub version: u32,
    pub params: Params,
    pub weights: Vec<Vec<f64>>,
    pub bias: Vec<f64>,
    pub step_count: usize,
    pub rng_state: u64,
    pub ou: Vec<f64>,
    pub e: Vec<f64>,
    pub i: Vec<f64>,
    pub e_hist: Vec<Vec<f64>>,
    pub hist_base: usize,
    pub e0: f64,
    pub i0: f64,
}

impl Simulator {
    pub fn new(weights: Vec<Vec<f64>>, lengths: Vec<Vec<f64>>, params: Params) -> Result<Self, String> {
        let n = weights.len();
        if n == 0 || weights.iter().any(|r| r.len() != n) || lengths.len() != n || lengths.iter().any(|r| r.len() != n) {
            return Err(format!("weights/lengths must be non-empty square and equal-shaped, got {n}x?"));
        }
        for i in 0..n {
            if weights[i][i] != 0.0 {
                return Err("weights diagonal must already be zeroed by preprocessing".to_string());
            }
        }
        let idelays = build_idelays(&lengths, &weights, params.dt, params.speed);
        let max_idelay = idelays.iter().flatten().copied().max().unwrap_or(0);
        let mut sim = Simulator {
            params,
            n,
            weights: weights.clone(),
            weights_orig: weights,
            bias: vec![0.0; n],
            lengths,
            idelays,
            max_idelay,
            e: vec![0.0; n],
            i: vec![0.0; n],
            e_hist: Vec::new(),
            hist_base: 0,
            step_count: 0,
            rng: SplitMix64::new(params.seed),
            ou: vec![0.0; n],
            e0: 0.0,
            i0: 0.0,
        };
        sim.reset();
        Ok(sim)
    }

    /// Deterministic initial state: E = e0, I = i0 everywhere, history = IC.
    /// PR3: clears the sustained bias (an applied input) but NEVER the
    /// weights — edited weights survive a reset by design (see module docs).
    /// PR4: also zeroes the OU state and re-seeds the RNG from
    /// `params.seed`, so reset + rerun reproduces the first run exactly.
    pub fn reset(&mut self) {
        self.e = vec![self.e0; self.n];
        self.i = vec![self.i0; self.n];
        self.e_hist = vec![self.e.clone()];
        self.hist_base = 0;
        self.step_count = 0;
        self.rng = SplitMix64::new(self.params.seed);
        self.bias = vec![0.0; self.n];
        self.ou = vec![0.0; self.n];
    }

    // -- PR4: background activity + snapshots ---------------------------
    /// Current OU background-drive state (model units of P; zeros when
    /// the mode is not Spontaneous or before the first step).
    pub fn ou_state(&self) -> &[f64] {
        &self.ou
    }

    /// Raw RNG state (PR4: snapshots; also lets a seed change take
    /// effect without resetting E/I — see `reseed`).
    pub fn rng_state(&self) -> u64 {
        self.rng.state()
    }

    /// Change the deterministic seed: future RNG draws (OU and white
    /// noise) follow the new seed from the next step on.  E/I, OU state,
    /// weights and bias are NOT touched — this is not a reset.  To
    /// replay a run from the start with the new seed, call `reset()`
    /// afterwards (which re-seeds from `params.seed`).
    pub fn reseed(&mut self, seed: u64) {
        self.params.seed = seed;
        self.rng = SplitMix64::new(seed);
    }

    /// Take a complete snapshot of the experiment state (PR4).  Cheap
    /// to take (a few clones of small vectors); the history is already
    /// trimmed to `max_idelay + 8` rows.
    pub fn take_snapshot(&self) -> StateSnapshot {
        StateSnapshot {
            version: STATE_SNAPSHOT_VERSION,
            params: self.params,
            weights: self.weights.clone(),
            bias: self.bias.clone(),
            step_count: self.step_count,
            rng_state: self.rng.state(),
            ou: self.ou.clone(),
            e: self.e.clone(),
            i: self.i.clone(),
            e_hist: self.e_hist.clone(),
            hist_base: self.hist_base,
            e0: self.e0,
            i0: self.i0,
        }
    }

    /// Restore a snapshot taken with `take_snapshot` (PR4).  After this
    /// call the simulator is bit-identical to the moment the snapshot
    /// was taken — same E/I, same history window, same RNG state, same
    /// OU state — so continuing to run reproduces the uninterrupted
    /// trajectory exactly.  Fails (without mutating anything) if the
    /// snapshot's node count differs from this simulator's.
    pub fn restore_snapshot(&mut self, snap: &StateSnapshot) -> Result<(), String> {
        if snap.e.len() != self.n
            || snap.i.len() != self.n
            || snap.ou.len() != self.n
            || snap.weights.len() != self.n
            || snap.bias.len() != self.n
        {
            return Err(format!(
                "snapshot has n={} but this simulator has n={}",
                snap.e.len(),
                self.n
            ));
        }
        if snap.e_hist.iter().any(|row| row.len() != self.n) {
            return Err("snapshot history rows have the wrong width".to_string());
        }
        self.params = snap.params;
        self.weights = snap.weights.clone();
        self.bias = snap.bias.clone();
        self.step_count = snap.step_count;
        self.rng = SplitMix64::from_state(snap.rng_state);
        self.ou = snap.ou.clone();
        self.e = snap.e.clone();
        self.i = snap.i.clone();
        self.e_hist = snap.e_hist.clone();
        self.hist_base = snap.hist_base;
        self.e0 = snap.e0;
        self.i0 = snap.i0;
        Ok(())
    }

    // -- PR3: runtime weight editing (single-sided, range 0–3) ---------
    /// Live weight range (TVB raw weights are 0–3); out-of-range clamped.
    pub const WEIGHT_MIN: f64 = 0.0;
    pub const WEIGHT_MAX: f64 = 3.0;
    /// Sustained bias range (model units of P); out-of-range clamped.
    pub const BIAS_MIN: f64 = -1.0;
    pub const BIAS_MAX: f64 = 1.0;

    /// Current live weight C_ij.
    pub fn weight(&self, i: usize, j: usize) -> f64 {
        self.weights[i][j]
    }

    /// TVB original weight C_ij (as passed to `new()`).
    pub fn original_weight(&self, i: usize, j: usize) -> f64 {
        self.weights_orig[i][j]
    }

    /// Whole live weight matrix (row-major).
    pub fn weights(&self) -> &Vec<Vec<f64>> {
        &self.weights
    }

    /// Set one weight, SINGLE-SIDED: only C_ij changes, C_ji untouched.
    /// Clamps to [0, 3] and returns the value actually stored.
    /// The diagonal stays zero (rejected) and out-of-range indices are
    /// rejected; neither panics.  Takes effect from the next step: the
    /// coupling sum in `deriv` reads `self.weights` live.
    pub fn set_weight(&mut self, i: usize, j: usize, w: f64) -> Result<f64, String> {
        if i >= self.n || j >= self.n {
            return Err(format!("weight index ({i},{j}) out of range for n={}", self.n));
        }
        if i == j {
            return Err("diagonal weights stay zero".to_string());
        }
        let w = w.clamp(Self::WEIGHT_MIN, Self::WEIGHT_MAX);
        self.weights[i][j] = w;
        Ok(w)
    }

    /// Restore one weight to its TVB original value; returns that value.
    pub fn reset_weight(&mut self, i: usize, j: usize) -> Result<f64, String> {
        if i >= self.n || j >= self.n {
            return Err(format!("weight index ({i},{j}) out of range for n={}", self.n));
        }
        if i == j {
            return Err("diagonal weights stay zero".to_string());
        }
        let w = self.weights_orig[i][j];
        self.weights[i][j] = w;
        Ok(w)
    }

    /// Restore ALL weights to their TVB original values.
    pub fn reset_all_weights(&mut self) {
        self.weights = self.weights_orig.clone();
    }

    // -- PR3: sustained bias input (range −1..+1, 0 = off) --------------
    /// Current sustained bias on `node` (0 = no bias).
    pub fn bias(&self, node: usize) -> f64 {
        self.bias[node]
    }

    /// Set the sustained bias on `node`, clamped to [−1, +1]; returns the
    /// value actually stored.  Added to P on every step until cleared.
    pub fn set_bias(&mut self, node: usize, value: f64) -> Result<f64, String> {
        if node >= self.n {
            return Err(format!("bias node {node} out of range for n={}", self.n));
        }
        let value = value.clamp(Self::BIAS_MIN, Self::BIAS_MAX);
        self.bias[node] = value;
        Ok(value)
    }

    /// Clear the sustained bias on one node (back to 0 = no bias).
    pub fn clear_bias(&mut self, node: usize) -> Result<(), String> {
        if node >= self.n {
            return Err(format!("bias node {node} out of range for n={}", self.n));
        }
        self.bias[node] = 0.0;
        Ok(())
    }

    /// Clear the sustained bias on all nodes.
    pub fn clear_all_bias(&mut self) {
        self.bias = vec![0.0; self.n];
    }

    pub fn set_initial(&mut self, e0: f64, i0: f64) {
        self.e0 = e0;
        self.i0 = i0;
        self.reset();
    }

    pub fn step_count(&self) -> usize {
        self.step_count
    }

    pub fn state_e(&self) -> &[f64] {
        &self.e
    }

    pub fn state_i(&self) -> &[f64] {
        &self.i
    }

    fn sigmoid(x: f64, a: f64, b: f64, c: f64) -> f64 {
        // Clip the exponent so both languages agree exactly even for
        // extreme inputs; 1/(1+exp(700)) ~ 1e-304 ~ 0.
        let z = (-a * (x - b)).clamp(-700.0, 700.0);
        c / (1.0 + z.exp())
    }

    /// Delayed E for the coupling sum: E_j at absolute step `step - idelay_ij`.
    /// Rows `hist_base..=hist_base+len-1` of `e_hist` are committed states;
    /// index `hist_base+len` resolves to the predictor row (only reachable
    /// when idelay == 0 in the corrector call).  Steps before t=0 read as
    /// the initial state.
    fn delayed_e(&self, step: i64, i: usize, j: usize, predictor: Option<&[f64]>) -> f64 {
        let idx = step - self.idelays[i][j];
        if idx < 0 {
            return self.e0;
        }
        let idx = idx as usize;
        if idx < self.hist_base {
            // Trimmed away: can only happen for rows older than the
            // largest delay, which are never read (see trim_history).
            return self.e0;
        }
        let local = idx - self.hist_base;
        if local < self.e_hist.len() {
            self.e_hist[local][j]
        } else {
            predictor.expect("delay index beyond history without predictor")[j]
        }
    }

    /// Drop history rows older than the largest delay (+8 rows of margin).
    /// The oldest row still readable after trimming is
    /// `step_count - max_idelay`, which is exactly the oldest delay any
    /// future step can request, so the numbers are unchanged.
    fn trim_history(&mut self) {
        let keep = (self.max_idelay + 8).max(64) as usize;
        if self.e_hist.len() > keep {
            let drop = self.e_hist.len() - keep;
            self.e_hist.drain(..drop);
            self.hist_base += drop;
        }
    }

    /// Advance exactly one fixed step of `dt`, starting at absolute time
    /// `t_ms`.  Returns the external input P actually applied during the
    /// step.  This is the same Heun predictor–corrector step `run()`
    /// performs; `run()` is now a loop over `step_one`, so the numbers
    /// are identical.
    pub fn step_one(&mut self, t_ms: f64, events: &[StimulusEvent]) -> Result<Vec<f64>, DivergenceError> {
        let dt = self.params.dt;
        let step = self.step_count as i64;
        // PR4: advance the OU background drive EXACTLY ONCE per step,
        // here — never inside `deriv`, which Heun calls twice per step.
        // Euler–Maruyama for dx = -(x/tau) dt + sigma*sqrt(2 dt/tau) dW.
        if self.params.bg_mode == BgMode::Spontaneous {
            let tau = self.params.ou_tau_ms;
            let sigma = self.params.ou_sigma;
            let decay = dt / tau;
            let diff = sigma * (2.0 * dt / tau).sqrt();
            for k in 0..self.n {
                let g = self.rng.next_gaussian();
                self.ou[k] += -self.ou[k] * decay + diff * g;
            }
        }
        // PR3: applied P = stimulus events + sustained per-node bias.
        // PR4: + constant drive (if any) + OU state (if Spontaneous).
        // The bias enters the predictor AND the corrector identically.
        let p = self.total_p(t_ms, events);
        // Predictor (Euler) using delayed E at this step.
        let (de1, di1) = self.deriv(&self.e.clone(), &self.i.clone(), step, None, &p);
        let e_star: Vec<f64> = self.e.iter().zip(de1.iter()).map(|(e, d)| e + dt * d).collect();
        let i_star: Vec<f64> = self.i.iter().zip(di1.iter()).map(|(v, d)| v + dt * d).collect();
        // Corrector: delayed E at step+1; the predictor row serves as
        // history row step+1, so idelay == 0 reads E_star.
        let (de2, di2) = self.deriv(&e_star, &i_star, step + 1, Some(&e_star), &p);
        for k in 0..self.n {
            self.e[k] += (dt / 2.0) * (de1[k] + de2[k]);
            self.i[k] += (dt / 2.0) * (di1[k] + di2[k]);
        }
        self.step_count += 1;
        self.check()?;
        self.e_hist.push(self.e.clone());
        self.trim_history();
        Ok(p)
    }

    fn deriv(
        &mut self,
        e: &[f64],
        i: &[f64],
        step: i64,
        predictor: Option<&[f64]>,
        p_vec: &[f64],
    ) -> (Vec<f64>, Vec<f64>) {
        let params = self.params;
        let n = self.n;
        // Coupling: G * sum_j C_ij * E_j(t - d_ij).
        let mut coupling = vec![0.0f64; n];
        for ii in 0..n {
            let mut acc = 0.0f64;
            for j in 0..n {
                let w = self.weights[ii][j];
                if w != 0.0 {
                    acc += w * self.delayed_e(step, ii, j, predictor);
                }
            }
            coupling[ii] = params.g * acc;
        }
        // Noise: uniform in [-1, 1) per node, node order, drawn here
        // (predictor draws precede corrector draws), only if enabled.
        let mut p_eff = p_vec.to_vec();
        if params.noise_amp != 0.0 {
            for k in 0..n {
                p_eff[k] += params.noise_amp * (2.0 * self.rng.next_f64() - 1.0);
            }
        }
        let mut de = vec![0.0f64; n];
        let mut di = vec![0.0f64; n];
        for k in 0..n {
            let x_e = params.alpha_e * (params.c_ee * e[k] - params.c_ei * i[k] + p_eff[k] - params.theta_e + coupling[k]);
            let x_i = params.alpha_i * (params.c_ie * e[k] - params.c_ii * i[k] - params.theta_i);
            let s_e = Self::sigmoid(x_e, params.a_e, params.b_e, params.c_e);
            let s_i = Self::sigmoid(x_i, params.a_i, params.b_i, params.c_i);
            de[k] = (-e[k] + (params.k_e - params.r_e * e[k]) * s_e) / params.tau_e;
            di[k] = (-i[k] + (params.k_i - params.r_i * i[k]) * s_i) / params.tau_i;
        }
        (de, di)
    }

    fn stimulus_vector(&self, t_ms: f64, events: &[StimulusEvent]) -> Vec<f64> {
        let mut p = vec![0.0f64; self.n];
        for ev in events {
            if ev.start_ms <= t_ms && t_ms < ev.start_ms + ev.duration_ms {
                p[ev.node] += ev.amplitude;
            }
        }
        p
    }

    /// External input actually applied during a step: stimulus events
    /// PLUS the sustained per-node bias (PR3) PLUS the constant drive
    /// (PR4, `drive_const`, if any) PLUS the OU background state (PR4,
    /// only in Spontaneous mode).  This is what `step_one` returns and
    /// what `run()` records in `RunResult.p` (see `recorded_p`).
    fn applied_p(&self, t_ms: f64, events: &[StimulusEvent]) -> Vec<f64> {
        let mut p = self.stimulus_vector(t_ms, events);
        for k in 0..self.n {
            p[k] += self.bias[k] + self.params.drive_const;
        }
        p
    }

    /// Total P applied during a step: `applied_p` + the OU state when
    /// Spontaneous mode is on + the external sine drive when
    /// Oscillatory mode is on (same in-phase sine on every node, a
    /// function of the ABSOLUTE simulation time, no RNG involved).
    /// Called in `step_one` AFTER the OU update, so the returned P is
    /// exactly what both Heun stages saw.
    fn total_p(&self, t_ms: f64, events: &[StimulusEvent]) -> Vec<f64> {
        let mut p = self.applied_p(t_ms, events);
        if self.params.bg_mode == BgMode::Spontaneous {
            for k in 0..self.n {
                p[k] += self.ou[k];
            }
        } else if self.params.bg_mode == BgMode::Oscillatory && self.params.ext_sine_amp != 0.0 {
            let sine = self.params.ext_sine_amp
                * (2.0 * std::f64::consts::PI * self.params.ext_sine_freq_hz * t_ms / 1000.0).sin();
            for k in 0..self.n {
                p[k] += sine;
            }
        }
        p
    }

    /// P recorded in `RunResult.p` at time `t_ms`: stimulus + bias +
    /// constant drive at that time, plus the OU state as of the step
    /// that just ended (the OU value that step actually applied).
    fn recorded_p(&self, t_ms: f64, events: &[StimulusEvent]) -> Vec<f64> {
        self.total_p(t_ms, events)
    }

    fn check(&self) -> Result<(), DivergenceError> {
        for (k, v) in self.e.iter().enumerate() {
            if !v.is_finite() || v.abs() > 1e6 {
                return Err(DivergenceError {
                    step: self.step_count,
                    time_ms: self.step_count as f64 * self.params.dt,
                    detail: format!("E[{k}] = {v}"),
                });
            }
        }
        for (k, v) in self.i.iter().enumerate() {
            if !v.is_finite() || v.abs() > 1e6 {
                return Err(DivergenceError {
                    step: self.step_count,
                    time_ms: self.step_count as f64 * self.params.dt,
                    detail: format!("I[{k}] = {v}"),
                });
            }
        }
        Ok(())
    }

    /// Run for `duration_ms`. The simulator is NOT reset first: call
    /// `reset()` explicitly for a fresh deterministic run.
    /// Implemented as a loop over `step_one`, so the trajectory is
    /// identical to stepping the simulator by hand.
    pub fn run(&mut self, duration_ms: f64, events: &[StimulusEvent]) -> Result<RunResult, DivergenceError> {
        let dt = self.params.dt;
        let n_steps = (duration_ms / dt).round() as usize;
        let mut t_ms = Vec::with_capacity(n_steps + 1);
        let mut e_out = Vec::with_capacity(n_steps + 1);
        let mut i_out = Vec::with_capacity(n_steps + 1);
        let mut p_out = Vec::with_capacity(n_steps + 1);
        t_ms.push(self.step_count as f64 * dt);
        e_out.push(self.e.clone());
        i_out.push(self.i.clone());
        p_out.push(self.recorded_p(self.step_count as f64 * dt, events));

        for _ in 0..n_steps {
            let t = self.step_count as f64 * dt;
            self.step_one(t, events)?;
            t_ms.push((self.step_count) as f64 * dt);
            e_out.push(self.e.clone());
            i_out.push(self.i.clone());
            p_out.push(self.recorded_p(self.step_count as f64 * dt, events));
        }

        Ok(RunResult { t_ms, e: e_out, i: i_out, p: p_out, n_steps })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn single_node() -> Simulator {
        Simulator::new(vec![vec![0.0]], vec![vec![0.0]], Params::default()).unwrap()
    }

    #[test]
    fn splitmix_first_value_matches_definition() {
        let mut rng = SplitMix64::new(0);
        assert_eq!(rng.next_u64(), 0xE220A8397B1DCDAF);
    }

    #[test]
    fn idelays_round_half_to_even_like_tvb() {
        // delay = 7.5/3 = 2.5 ms; dt=1 -> rint(2.5) = 2 (ties to even).
        let w = vec![vec![0.0, 1.0], vec![1.0, 0.0]];
        let l = vec![vec![0.0, 7.5], vec![7.5, 0.0]];
        let d = build_idelays(&l, &w, 1.0, 3.0);
        assert_eq!(d[0][1], 2);
        assert_eq!(d[1][0], 2);
        // dt=0.5 -> 2.5/0.5 = 5.
        let d = build_idelays(&l, &w, 0.5, 3.0);
        assert_eq!(d[0][1], 5);
        // Zero-weight edges get idelay 0.
        let w0 = vec![vec![0.0, 0.0], vec![0.0, 0.0]];
        let d = build_idelays(&l, &w0, 1.0, 3.0);
        assert_eq!(d, vec![vec![0, 0], vec![0, 0]]);
    }

    #[test]
    fn single_node_settles_to_low_fixed_point() {
        let mut sim = single_node();
        let r = sim.run(2000.0, &[]).unwrap();
        assert!((r.e.last().unwrap()[0] - 0.0730).abs() < 1e-3);
        assert!((r.i.last().unwrap()[0] - 0.0314).abs() < 1e-3);
    }

    #[test]
    fn determinism_same_seed_same_trajectory() {
        let ev = [StimulusEvent { node: 0, start_ms: 100.0, duration_ms: 100.0, amplitude: 2.0 }];
        let mut sim = single_node();
        let r1 = sim.run(500.0, &ev).unwrap();
        sim.reset();
        let r2 = sim.run(500.0, &ev).unwrap();
        assert_eq!(r1.e, r2.e);
        assert_eq!(r1.i, r2.i);
    }

    #[test]
    fn g_zero_isolation_on_small_network() {
        // 3-node chain: 0 -> 1 -> 2. With G=0, stimulating node 0 must
        // leave nodes 1 and 2 exactly at their unstimulated trajectory.
        let w = vec![
            vec![0.0, 0.0, 0.0],
            vec![2.0, 0.0, 0.0],
            vec![0.0, 1.5, 0.0],
        ];
        let l = vec![
            vec![0.0, 0.0, 0.0],
            vec![30.0, 0.0, 0.0],
            vec![0.0, 30.0, 0.0],
        ];
        let ev = [StimulusEvent { node: 0, start_ms: 500.0, duration_ms: 100.0, amplitude: 2.0 }];
        let mut sim = Simulator::new(w.clone(), l.clone(), Params { g: 0.0, ..Params::default() }).unwrap();
        let base = sim.run(1500.0, &[]).unwrap();
        sim.reset();
        let stim = sim.run(1500.0, &ev).unwrap();
        for s in 0..base.e.len() {
            assert_eq!(stim.e[s][1], base.e[s][1]);
            assert_eq!(stim.e[s][2], base.e[s][2]);
        }
        let peak = stim
            .e
            .iter()
            .zip(base.e.iter())
            .map(|(a, b)| (a[0] - b[0]).abs())
            .fold(0.0f64, f64::max);
        assert!(peak > 0.1);
    }

    #[test]
    fn diagonal_weights_rejected() {
        let w = vec![vec![1.0, 0.0], vec![0.0, 0.0]];
        let l = vec![vec![0.0, 0.0], vec![0.0, 0.0]];
        assert!(Simulator::new(w, l, Params::default()).is_err());
    }

    #[test]
    fn reset_restores_initial_state() {
        let mut sim = single_node();
        sim.run(500.0, &[]).unwrap();
        sim.reset();
        assert_eq!(sim.step_count(), 0);
        assert_eq!(sim.state_e(), &[0.0]);
        assert_eq!(sim.state_i(), &[0.0]);
    }

    #[test]
    fn history_trimming_keeps_numbers_identical() {
        // 3-node chain with a 46-step max delay.  A long run must keep
        // history bounded, and reset + rerun must reproduce it exactly —
        // trimming must not corrupt delayed coupling.
        let w = vec![
            vec![0.0, 0.0, 0.0],
            vec![2.0, 0.0, 0.0],
            vec![0.0, 1.5, 0.0],
        ];
        let l = vec![
            vec![0.0, 0.0, 0.0],
            vec![138.0, 0.0, 0.0],
            vec![0.0, 138.0, 0.0],
        ];
        let ev = [StimulusEvent { node: 0, start_ms: 500.0, duration_ms: 100.0, amplitude: 2.0 }];
        let mut sim = Simulator::new(w, l, Params::demo()).unwrap();
        let r1 = sim.run(1500.0, &ev).unwrap();
        assert!(sim.e_hist.len() as i64 <= (sim.max_idelay + 8).max(64));
        sim.reset();
        let r2 = sim.run(1500.0, &ev).unwrap();
        assert_eq!(r1.e, r2.e);
        assert_eq!(r1.i, r2.i);
    }

    // -- PR3: runtime weight editing + sustained bias -------------------

    fn chain_sim(w10: f64) -> Simulator {
        let w = vec![
            vec![0.0, 0.0, 0.0],
            vec![w10, 0.0, 0.0],
            vec![0.0, 1.5, 0.0],
        ];
        let l = vec![
            vec![0.0, 0.0, 0.0],
            vec![30.0, 0.0, 0.0],
            vec![0.0, 30.0, 0.0],
        ];
        Simulator::new(w, l, Params::demo()).unwrap()
    }

    /// Peak rise of `node`'s E after t=500 ms, relative to its value at
    /// t=500 ms (settled baseline), for a 100 ms pulse on node 0.
    fn chain_peak_delta(w10: f64) -> f64 {
        let ev = [StimulusEvent { node: 0, start_ms: 500.0, duration_ms: 100.0, amplitude: 2.0 }];
        let mut sim = chain_sim(w10);
        let r = sim.run(1500.0, &ev).unwrap();
        let base = r.e[500][1];
        r.e.iter().skip(500).map(|row| row[1] - base).fold(0.0f64, f64::max)
    }

    #[test]
    fn pr3_set_weight_single_sided_and_clamped() {
        let w = vec![vec![0.0, 1.0], vec![2.0, 0.0]];
        let l = vec![vec![0.0, 10.0], vec![10.0, 0.0]];
        let mut sim = Simulator::new(w, l, Params::demo()).unwrap();
        // Clamp above the range; opposite side untouched (single-sided).
        assert_eq!(sim.set_weight(0, 1, 5.0).unwrap(), 3.0);
        assert_eq!(sim.weight(0, 1), 3.0);
        assert_eq!(sim.weight(1, 0), 2.0);
        assert_eq!(sim.original_weight(0, 1), 1.0);
        // Clamp below the range.
        assert_eq!(sim.set_weight(0, 1, -2.0).unwrap(), 0.0);
        // Diagonal and out-of-range indices are rejected, never panic.
        assert!(sim.set_weight(0, 0, 1.0).is_err());
        assert!(sim.set_weight(0, 2, 1.0).is_err());
        assert!(sim.set_weight(2, 0, 1.0).is_err());
        assert_eq!(sim.weight(0, 0), 0.0);
        // Restore one edge / all edges.
        assert_eq!(sim.reset_weight(0, 1).unwrap(), 1.0);
        sim.set_weight(1, 0, 0.5).unwrap();
        sim.reset_all_weights();
        assert_eq!(sim.weight(0, 1), 1.0);
        assert_eq!(sim.weight(1, 0), 2.0);
    }

    #[test]
    fn pr3_weight_zero_kills_downstream_double_enhances() {
        // Baseline: w[1][0] = 1.0, pulse on node 0 reaches node 1.
        // (Measured peak: 0.002967 — small but well above the fixed-point
        // residual; the Python reference gives the identical number.)
        let peak_base = chain_peak_delta(1.0);
        assert!(peak_base > 0.002, "baseline peak too small: {peak_base}");
        // Zero the only edge into node 1: its response must vanish
        // (node 1 then has no inputs at all, so it stays at its fixed
        // point; the residual is only the fixed-point approach).
        let mut sim = chain_sim(1.0);
        sim.set_weight(1, 0, 0.0).unwrap();
        let ev = [StimulusEvent { node: 0, start_ms: 500.0, duration_ms: 100.0, amplitude: 2.0 }];
        let r = sim.run(1500.0, &ev).unwrap();
        let base = r.e[500][1];
        let peak_zero = r.e.iter().skip(500).map(|row| (row[1] - base).abs()).fold(0.0f64, f64::max);
        assert!(peak_zero < 1e-6, "zeroed edge still responds: {peak_zero}");
        // Double the edge: the downstream peak must grow clearly.
        let peak_double = chain_peak_delta(2.0);
        assert!(
            peak_double > peak_base * 1.5,
            "doubled edge did not enhance: base {peak_base}, doubled {peak_double}"
        );
    }

    #[test]
    fn pr3_bias_raises_and_lowers_steady_e() {
        // Demo preset single node: settled E* ≈ 0.011.
        let mut sim = Simulator::new(vec![vec![0.0]], vec![vec![0.0]], Params::demo()).unwrap();
        let r0 = sim.run(2000.0, &[]).unwrap();
        let e_base = r0.e.last().unwrap()[0];
        assert!((e_base - 0.011).abs() < 0.002, "baseline E* moved: {e_base}");
        // Positive (excitatory) bias raises the steady state, and the
        // reported P actually carries the bias.
        // (Measured: 0.011059 -> 0.023128 at +0.5; Python reference agrees.)
        sim.reset();
        assert_eq!(sim.set_bias(0, 0.5).unwrap(), 0.5);
        let r1 = sim.run(2000.0, &[]).unwrap();
        let e_pos = r1.e.last().unwrap()[0];
        assert!(e_pos > e_base + 0.005, "positive bias did not raise E: {e_base} -> {e_pos}");
        assert!((r1.p[100][0] - 0.5).abs() < 1e-12, "reported P lacks bias: {}", r1.p[100][0]);
        // Negative (inhibitory) bias lowers it.
        // (Measured: 0.011059 -> 0.005706 at −0.5.)
        sim.reset();
        assert_eq!(sim.set_bias(0, -0.5).unwrap(), -0.5);
        let r2 = sim.run(2000.0, &[]).unwrap();
        let e_neg = r2.e.last().unwrap()[0];
        assert!(e_neg < e_base - 0.002, "negative bias did not lower E: {e_base} -> {e_neg}");
        assert!(e_neg > 0.0, "E went non-positive under negative bias: {e_neg}");
        // Bias clamps to [−1, +1]; bad node rejected.
        assert_eq!(sim.set_bias(0, 2.0).unwrap(), 1.0);
        assert_eq!(sim.set_bias(0, -2.0).unwrap(), -1.0);
        assert!(sim.set_bias(1, 0.5).is_err());
        // Clearing the bias restores the un-biased trajectory exactly.
        sim.reset(); // reset() also clears bias (PR3 semantics)
        assert_eq!(sim.bias(0), 0.0);
        let r3 = sim.run(2000.0, &[]).unwrap();
        assert_eq!(r3.e, r0.e);
        assert_eq!(r3.i, r0.i);
    }

    #[test]
    fn pr3_reset_preserves_weights_but_clears_bias() {
        let mut sim = chain_sim(1.0);
        sim.set_weight(1, 0, 0.0).unwrap();
        sim.set_bias(0, 0.5).unwrap();
        sim.run(100.0, &[]).unwrap();
        sim.reset();
        assert_eq!(sim.weight(1, 0), 0.0, "reset must NOT restore weights");
        assert_eq!(sim.original_weight(1, 0), 1.0);
        assert_eq!(sim.bias(0), 0.0, "reset must clear bias");
        assert_eq!(sim.step_count(), 0);
        assert_eq!(sim.state_e(), &[0.0, 0.0, 0.0]);
        sim.reset_all_weights();
        assert_eq!(sim.weight(1, 0), 1.0);
    }

    // -- PR4: background activity (OU) + snapshots ----------------------

    fn spont_sim() -> Simulator {
        let params = Params {
            bg_mode: BgMode::Spontaneous,
            ..Params::demo()
        };
        Simulator::new(vec![vec![0.0]], vec![vec![0.0]], params).unwrap()
    }

    #[test]
    fn pr4_ou_deterministic_same_seed_differs_across_seeds() {
        // Same seed + same parameters = bit-identical trajectories;
        // reset + rerun reproduces the first run; a different seed
        // gives a different trajectory.
        let mut sim = spont_sim();
        let r1 = sim.run(2000.0, &[]).unwrap();
        sim.reset();
        let r2 = sim.run(2000.0, &[]).unwrap();
        assert_eq!(r1.e, r2.e);
        assert_eq!(r1.i, r2.i);
        assert_eq!(r1.p, r2.p);
        // The OU actually drives the node (not a silent rerun).
        assert!(
            sim.ou_state().iter().any(|v| *v != 0.0),
            "OU state stayed zero after a spontaneous run"
        );
        sim.reseed(1);
        sim.reset();
        let r3 = sim.run(2000.0, &[]).unwrap();
        assert_ne!(r1.e, r3.e, "different seed gave an identical trajectory");
        // Same seed again reproduces the first run.
        sim.reseed(0);
        sim.reset();
        let r4 = sim.run(2000.0, &[]).unwrap();
        assert_eq!(r1.e, r4.e);
        assert_eq!(r1.p, r4.p);
    }

    #[test]
    fn pr4_ou_single_update_per_step() {
        // The OU state after ONE step must equal a single Euler–
        // Maruyama update driven by the FIRST Gaussian draw from a
        // fresh SplitMix64(seed).  If the OU were (wrongly) advanced
        // inside `deriv`, it would be updated twice per step — with
        // different draws — and this would fail.
        let mut sim = spont_sim();
        let dt = sim.params.dt;
        let tau = sim.params.ou_tau_ms;
        let sigma = sim.params.ou_sigma;
        sim.step_one(0.0, &[]).unwrap();
        let mut rng = SplitMix64::new(0);
        let g0 = rng.next_gaussian();
        let expected = sigma * (2.0 * dt / tau).sqrt() * g0;
        assert!(
            (sim.ou_state()[0] - expected).abs() < 1e-15,
            "OU after 1 step: got {}, expected {} (g0={})",
            sim.ou_state()[0],
            expected,
            g0
        );
        // Second step: one more update, second draw, decay applied.
        let g1 = rng.next_gaussian();
        let expected2 = expected * (1.0 - dt / tau) + sigma * (2.0 * dt / tau).sqrt() * g1;
        sim.step_one(1.0, &[]).unwrap();
        assert!(
            (sim.ou_state()[0] - expected2).abs() < 1e-15,
            "OU after 2 steps: got {}, expected {}",
            sim.ou_state()[0],
            expected2
        );
        // And the RNG state advanced by exactly 4 uniforms (2 per step).
        let mut rng_check = SplitMix64::new(0);
        for _ in 0..4 {
            rng_check.next_f64();
        }
        assert_eq!(sim.rng_state(), rng_check.state());
    }

    #[test]
    fn pr4_spontaneous_differs_from_quiet() {
        let mut quiet = Simulator::new(vec![vec![0.0]], vec![vec![0.0]], Params::demo()).unwrap();
        let rq = quiet.run(2000.0, &[]).unwrap();
        let mut spont = spont_sim();
        let rs = spont.run(2000.0, &[]).unwrap();
        let diff = rq
            .e
            .iter()
            .zip(rs.e.iter())
            .map(|(a, b)| (a[0] - b[0]).abs())
            .fold(0.0f64, f64::max);
        assert!(diff > 1e-4, "spontaneous run is indistinguishable from quiet: {diff}");
    }

    #[test]
    fn pr4_snapshot_roundtrip_exact() {
        // Run, snapshot, run on, restore: the instant state must match
        // the snapshot, and continuing after the restore must reproduce
        // the uninterrupted continuation bit-for-bit (this is what
        // catches a missing delay history or RNG/OU state).
        let mut sim = chain_sim(1.0);
        sim.set_weight(1, 0, 0.5).unwrap();
        sim.set_bias(0, 0.3).unwrap();
        sim.run(1500.0, &[]).unwrap();
        let snap = sim.take_snapshot();
        let snap_e = sim.state_e().to_vec();
        let snap_i = sim.state_i().to_vec();
        let snap_step = sim.step_count();
        // Continue uninterrupted for 500 steps.
        let cont = sim.run(500.0, &[]).unwrap();
        let cont_e = cont.e.last().unwrap().clone();
        let cont_i = cont.i.last().unwrap().clone();
        // Disturb everything the snapshot holds, then restore.
        sim.set_weight(1, 0, 2.5).unwrap();
        sim.set_bias(0, -0.8).unwrap();
        sim.run(100.0, &[]).unwrap();
        sim.restore_snapshot(&snap).unwrap();
        assert_eq!(sim.state_e(), snap_e.as_slice(), "E after restore != snapshot E");
        assert_eq!(sim.state_i(), snap_i.as_slice(), "I after restore != snapshot I");
        assert_eq!(sim.step_count(), snap_step);
        assert_eq!(sim.weight(1, 0), 0.5, "weight not restored");
        assert_eq!(sim.bias(0), 0.3, "bias not restored");
        // Continue after the restore: must match the uninterrupted run.
        let after = sim.run(500.0, &[]).unwrap();
        assert_eq!(after.e.last().unwrap(), &cont_e);
        assert_eq!(after.i.last().unwrap(), &cont_i);
        assert_eq!(after.e, cont.e);
        assert_eq!(after.i, cont.i);
    }

    #[test]
    fn pr4_snapshot_roundtrip_with_ou_and_noise() {
        // Same round-trip, but with the OU drive and white noise on:
        // the RNG state in the snapshot must resume the exact draw
        // sequence (a missing RNG state would diverge here).
        let params = Params {
            bg_mode: BgMode::Spontaneous,
            noise_amp: 0.1,
            ..Params::demo()
        };
        let w = vec![
            vec![0.0, 0.0, 0.0],
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.5, 0.0],
        ];
        let l = vec![
            vec![0.0, 0.0, 0.0],
            vec![30.0, 0.0, 0.0],
            vec![0.0, 30.0, 0.0],
        ];
        let mut sim = Simulator::new(w, l, params).unwrap();
        sim.run(1500.0, &[]).unwrap();
        let snap = sim.take_snapshot();
        let cont = sim.run(500.0, &[]).unwrap();
        sim.restore_snapshot(&snap).unwrap();
        let after = sim.run(500.0, &[]).unwrap();
        assert_eq!(after.e, cont.e, "OU+noise continuation diverged after restore");
        assert_eq!(after.i, cont.i);
        assert_eq!(after.p, cont.p);
    }

    #[test]
    fn pr6_snapshot_version_written_and_old_json_restores_as_v1() {
        // PR6 R2: take_snapshot writes version = STATE_SNAPSHOT_VERSION,
        // and pre-PR6 JSON without the field deserialises as 1 and
        // restores (no silent mis-restore, no rejection of old snapshots).
        let mut sim = chain_sim(1.0);
        sim.run(100.0, &[]).unwrap();
        let snap = sim.take_snapshot();
        assert_eq!(snap.version, STATE_SNAPSHOT_VERSION);
        let json = serde_json::to_string(&snap).unwrap();
        assert!(json.contains("\"version\":1"));
        let old_json = json.replace("\"version\":1,", "");
        assert!(!old_json.contains("\"version\""));
        let old: StateSnapshot = serde_json::from_str(&old_json).unwrap();
        assert_eq!(old.version, 1);
        sim.restore_snapshot(&old).unwrap();
        assert_eq!(sim.step_count(), snap.step_count);
    }

    #[test]
    fn pr4_snapshot_rejects_wrong_size() {
        let mut small = Simulator::new(vec![vec![0.0]], vec![vec![0.0]], Params::demo()).unwrap();
        let snap = small.take_snapshot();
        let mut big = chain_sim(1.0);
        assert!(big.restore_snapshot(&snap).is_err());
        // The failed restore must not have mutated the simulator.
        assert_eq!(big.step_count(), 0);
        assert_eq!(big.state_e(), &[0.0, 0.0, 0.0]);
        let _ = &mut small;
    }

    /// Deterministic synthetic 76-node network with TVB-like density
    /// (~27% nonzero weights in 0–3, lengths 10–150 mm).  The real
    /// network's 60 s validation lives in the Python mirror
    /// (test_pr4.py) and the browser test; this guards the engine
    /// logic on a network of the same size and shape.
    fn synthetic_76() -> (Vec<Vec<f64>>, Vec<Vec<f64>>) {
        let mut rng = SplitMix64::new(12345);
        let n = 76;
        let mut w = vec![vec![0.0; n]; n];
        let mut l = vec![vec![0.0; n]; n];
        for i in 0..n {
            for j in 0..n {
                if i == j {
                    continue;
                }
                if rng.next_f64() < 0.27 {
                    w[i][j] = 0.5 + 2.5 * rng.next_f64();
                    l[i][j] = 10.0 + 140.0 * rng.next_f64();
                }
            }
        }
        (w, l)
    }

    #[test]
    fn pr4_spontaneous_60s_no_lock() {
        // Default Spontaneous parameters, 60 s of simulation time:
        // the network must stay far from the lock threshold (mean E
        // 0.15) and finite, while showing visible ongoing activity.
        let (w, l) = synthetic_76();
        for seed in [0u64, 1, 2] {
            let params = Params {
                bg_mode: BgMode::Spontaneous,
                seed,
                ..Params::demo()
            };
            let mut sim = Simulator::new(w.clone(), l.clone(), params).unwrap();
            let r = sim.run(60000.0, &[]).unwrap();
            let mut max_mean_e = 0.0f64;
            let mut node_e_sum = vec![0.0f64; 76];
            for row in &r.e {
                let m: f64 = row.iter().sum::<f64>() / 76.0;
                if m > max_mean_e {
                    max_mean_e = m;
                }
                assert!(row.iter().all(|v| v.is_finite()), "non-finite E at seed {seed}");
            }
            // Per-node activity: the last 10 s must actually fluctuate.
            let tail = &r.e[r.e.len() - 10000..];
            let mut node_std = vec![0.0f64; 76];
            for row in tail {
                for k in 0..76 {
                    node_e_sum[k] += row[k];
                }
            }
            let means: Vec<f64> = node_e_sum.iter().map(|s| s / tail.len() as f64).collect();
            for row in tail {
                for k in 0..76 {
                    node_std[k] += (row[k] - means[k]).powi(2);
                }
            }
            let median_std = {
                let mut v: Vec<f64> = node_std
                    .iter()
                    .map(|s| (s / tail.len() as f64).sqrt())
                    .collect();
                v.sort_by(|a, b| a.partial_cmp(b).unwrap());
                v[38]
            };
            assert!(
                max_mean_e < 0.15,
                "seed {seed}: spontaneous run approached lock, max mean E = {max_mean_e}"
            );
            assert!(
                median_std > 0.0015,
                // The real network measures 0.0021 at sigma 0.10 (Python
                // test_pr4.py); this synthetic stand-in is slightly
                // quieter (0.00195).  The real-network guard is the
                // Python/browser test, not this one.
                "seed {seed}: spontaneous activity invisible, median node E std = {median_std}"
            );
        }
    }

    #[test]
    fn pr4_oscillatory_60s_no_lock_visible_rhythm() {
        // Oscillatory preset, 60 s: mean E must oscillate visibly at
        // the drive rhythm (peak-to-peak well above the quiet baseline
        // noise) and stay far below the lock threshold.
        let (w, l) = synthetic_76();
        let mut sim = Simulator::new(w, l, Params::oscillatory()).unwrap();
        let r = sim.run(60000.0, &[]).unwrap();
        let means: Vec<f64> = r.e.iter().map(|row| row.iter().sum::<f64>() / 76.0).collect();
        let tail = &means[means.len() - 4000..];
        let ptp = tail.iter().fold(f64::MIN, |a, &b| a.max(b))
            - tail.iter().fold(f64::MAX, |a, &b| a.min(b));
        let max_mean_e = means.iter().fold(f64::MIN, |a, &b| a.max(b));
        assert!(max_mean_e < 0.15, "oscillatory run approached lock: {max_mean_e}");
        assert!(
            ptp > 0.005,
            "oscillatory mean-E swing invisible: peak-to-peak {ptp}"
        );
        assert!(ptp < 0.1, "oscillatory mean-E swing implausibly large: {ptp}");
    }
}

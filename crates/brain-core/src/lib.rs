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
//! The library has no dependencies; `serde` is only used by the
//! `brain-core-run` binary.

use std::fmt;

// ---------------------------------------------------------------------------
// Parameters (A-set: TVB code defaults, Sanz-Leon et al. 2015 Table 11a)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
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
    weights: Vec<Vec<f64>>,
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
    e0: f64,
    i0: f64,
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
            weights,
            lengths,
            idelays,
            max_idelay,
            e: vec![0.0; n],
            i: vec![0.0; n],
            e_hist: Vec::new(),
            hist_base: 0,
            step_count: 0,
            rng: SplitMix64::new(params.seed),
            e0: 0.0,
            i0: 0.0,
        };
        sim.reset();
        Ok(sim)
    }

    /// Deterministic initial state: E = e0, I = i0 everywhere, history = IC.
    pub fn reset(&mut self) {
        self.e = vec![self.e0; self.n];
        self.i = vec![self.i0; self.n];
        self.e_hist = vec![self.e.clone()];
        self.hist_base = 0;
        self.step_count = 0;
        self.rng = SplitMix64::new(self.params.seed);
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
        let p = self.stimulus_vector(t_ms, events);
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
        p_out.push(self.stimulus_vector(self.step_count as f64 * dt, events));

        for _ in 0..n_steps {
            let t = self.step_count as f64 * dt;
            self.step_one(t, events)?;
            t_ms.push((self.step_count) as f64 * dt);
            e_out.push(self.e.clone());
            i_out.push(self.i.clone());
            p_out.push(self.stimulus_vector(self.step_count as f64 * dt, events));
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
}

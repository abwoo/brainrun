//! wasm-bindgen wrapper around `brain-core`.
//!
//! Thin by design: no math lives here.  It owns a `Simulator` (demo preset
//! by default), an event list with absolute simulation times, and the last
//! applied P vector, and exposes exactly what the Web Worker needs:
//! step 1 ms at a time, schedule/clear stimuli, change parameters for
//! subsequent steps, pause/reset, and read E/I/P snapshots.
//!
//! Parameter changes apply from the next step onward.  They are explicit
//! events submitted by the UI; nothing is mutated behind the engine's back.

use brain_core::{BgMode, Params, Simulator, StimulusEvent};
use wasm_bindgen::prelude::*;

/// One simulation instance.  Created from flat 76x76 weights/lengths
/// (row-major, as in `app/public/brain-assets/connectivity.json`).
#[wasm_bindgen]
pub struct WasmSim {
    sim: Simulator,
    /// Stimulus events in absolute simulation time (ms).  Pulses have a
    /// finite duration; holds use a very long duration and are removed
    /// when the pointer is released.
    events: Vec<StimulusEvent>,
    last_p: Vec<f64>,
    diverged: Option<String>,
}

fn flat_to_matrix(flat: &[f64], n: usize) -> Result<Vec<Vec<f64>>, String> {
    if flat.len() != n * n {
        return Err(format!(
            "expected {}x{} = {} values, got {}",
            n,
            n,
            n * n,
            flat.len()
        ));
    }
    Ok((0..n)
        .map(|i| flat[i * n..(i + 1) * n].to_vec())
        .collect())
}

#[wasm_bindgen]
impl WasmSim {
    /// New simulation with the demo preset (A-set + theta_e = 1.0,
    /// G = 0.35, dt = 1 ms).  `weights`/`lengths` are flat 76x76 arrays.
    #[wasm_bindgen(constructor)]
    pub fn new(weights: &[f64], lengths: &[f64]) -> Result<WasmSim, JsValue> {
        let n = 76;
        let w = flat_to_matrix(weights, n).map_err(|e| JsValue::from_str(&e))?;
        let l = flat_to_matrix(lengths, n).map_err(|e| JsValue::from_str(&e))?;
        let sim = Simulator::new(w, l, Params::demo()).map_err(|e| JsValue::from_str(&e))?;
        let last_p = vec![0.0; n];
        Ok(WasmSim {
            sim,
            events: Vec::new(),
            last_p,
            diverged: None,
        })
    }

    /// Number of nodes (76).
    pub fn n_nodes(&self) -> usize {
        self.sim.n
    }

    /// Current simulation time in ms (= steps * dt).
    pub fn time_ms(&self) -> f64 {
        self.sim.step_count() as f64 * self.sim.params.dt
    }

    /// Fixed step size in ms (1.0).
    pub fn dt_ms(&self) -> f64 {
        self.sim.params.dt
    }

    /// Advance exactly one 1 ms step.  Returns `false` if the simulation
    /// has diverged (see `divergence_detail`); further steps are refused.
    pub fn step(&mut self) -> bool {
        if self.diverged.is_some() {
            return false;
        }
        let t = self.time_ms();
        self.prune_events(t);
        match self.sim.step_one(t, &self.events) {
            Ok(p) => {
                self.last_p = p;
                true
            }
            Err(e) => {
                self.diverged = Some(e.to_string());
                false
            }
        }
    }

    /// Advance `ms` milliseconds in 1 ms steps.  Returns the number of
    /// steps actually taken (stops early on divergence).
    pub fn advance(&mut self, ms: f64) -> usize {
        let n = (ms / self.sim.params.dt).round().max(0.0) as usize;
        let mut done = 0;
        for _ in 0..n {
            if !self.step() {
                break;
            }
            done += 1;
        }
        done
    }

    /// Schedule a pulse: amplitude `amplitude` on `node` during
    /// `[start_ms, start_ms + duration_ms)`.
    pub fn add_stimulus(&mut self, node: usize, start_ms: f64, duration_ms: f64, amplitude: f64) {
        self.events.push(StimulusEvent {
            node,
            start_ms,
            duration_ms,
            amplitude,
        });
    }

    /// Remove every event on `node` (used when a hold is released).
    pub fn clear_stimuli_on_node(&mut self, node: usize) {
        self.events.retain(|ev| ev.node != node);
    }

    /// Remove all scheduled events.
    pub fn clear_stimuli(&mut self) {
        self.events.clear();
    }

    /// How many events are currently scheduled (pulses + holds).
    pub fn event_count(&self) -> usize {
        self.events.len()
    }

    /// Global coupling slope G.  Validated range 0–0.4 (Phase 2: at
    /// G >= 0.5 the baseline itself flips to the high state).
    pub fn set_g(&mut self, g: f64) {
        self.sim.params.g = g.clamp(0.0, 0.4);
    }

    pub fn g(&self) -> f64 {
        self.sim.params.g
    }

    /// Inhibitory self-coupling c_ei.  Validated range 3–8 (Phase 2:
    /// c_ei = 2 flips the whole network on stimulation).
    pub fn set_c_ei(&mut self, c_ei: f64) {
        self.sim.params.c_ei = c_ei.clamp(3.0, 8.0);
    }

    pub fn c_ei(&self) -> f64 {
        self.sim.params.c_ei
    }

    /// Default pulse amplitude used by the UI (model units).  The UI maps
    /// its STIMULUS knob nonlinearly onto 0.5–2.0; this only stores the
    /// value, it does not fire any stimulus by itself.
    pub fn set_stim_amplitude(&mut self, amplitude: f64) {
        self.sim.params.stim_amplitude = amplitude.clamp(0.0, 4.0);
    }

    pub fn stim_amplitude(&self) -> f64 {
        self.sim.params.stim_amplitude
    }

    /// Default pulse duration in ms (UI DURATION knob).
    pub fn set_stim_duration_ms(&mut self, duration_ms: f64) {
        self.sim.params.stim_duration_ms = duration_ms.clamp(20.0, 500.0);
    }

    pub fn stim_duration_ms(&self) -> f64 {
        self.sim.params.stim_duration_ms
    }

    /// Reset to the deterministic initial state (E = I = 0 everywhere),
    /// clear all events, clear the sustained bias, clear the divergence
    /// flag.  Parameters AND edited weights are kept (PR3: weights are
    /// structural edits; only reset_weight / reset_all_weights change
    /// them back).  PR4: the background mode is also kept, so reset +
    /// rerun reproduces the first run exactly (same mode, same seed).
    pub fn reset(&mut self) {
        self.sim.reset();
        self.events.clear();
        self.last_p = vec![0.0; self.sim.n];
        self.diverged = None;
    }

    // -- PR4: background activity mode ----------------------------------
    /// Set the background activity mode: 0 = Quiet (pre-PR4 silent
    /// baseline), 1 = Spontaneous (OU drive), 2 = Oscillatory
    /// (explicitly labelled external sinusoidal drive).  Switching
    /// modes only changes `bg_mode` (and, for Oscillatory, the sine
    /// parameters from `Params::oscillatory()`); the local Wilson–Cowan
    /// parameters and the user's knob values are untouched, so no UI
    /// knob needs re-syncing on a mode switch.  Returns the mode
    /// actually set; out-of-range values are ignored (mode unchanged).
    pub fn set_background_mode(&mut self, mode: u8) -> u8 {
        match mode {
            0 => self.sim.params.bg_mode = BgMode::Quiet,
            1 => self.sim.params.bg_mode = BgMode::Spontaneous,
            2 => {
                let osc = Params::oscillatory();
                self.sim.params.bg_mode = BgMode::Oscillatory;
                self.sim.params.ext_sine_amp = osc.ext_sine_amp;
                self.sim.params.ext_sine_freq_hz = osc.ext_sine_freq_hz;
            }
            _ => return self.background_mode(),
        }
        self.background_mode()
    }

    /// Current background activity mode (0 = Quiet, 1 = Spontaneous,
    /// 2 = Oscillatory).
    pub fn background_mode(&self) -> u8 {
        match self.sim.params.bg_mode {
            BgMode::Quiet => 0,
            BgMode::Spontaneous => 1,
            BgMode::Oscillatory => 2,
        }
    }

    /// Change the deterministic seed: future RNG draws follow the new
    /// seed from the next step on.  E/I, OU state, weights and bias are
    /// NOT touched — this is not a reset.  To replay from the start
    /// with the new seed, call `reset()` afterwards.
    pub fn set_seed(&mut self, seed: f64) {
        self.sim.reseed(seed as u64);
    }

    /// Current deterministic seed.
    pub fn seed(&self) -> f64 {
        self.sim.params.seed as f64
    }

    /// OU correlation time (ms) — Spontaneous mode.
    pub fn ou_tau_ms(&self) -> f64 {
        self.sim.params.ou_tau_ms
    }

    /// OU stationary standard deviation (model units of P).
    pub fn ou_sigma(&self) -> f64 {
        self.sim.params.ou_sigma
    }

    /// Constant background input (model units of P; 0 = none).
    pub fn drive_const(&self) -> f64 {
        self.sim.params.drive_const
    }

    /// External sine drive amplitude (model units of P; Oscillatory mode).
    pub fn ext_sine_amp(&self) -> f64 {
        self.sim.params.ext_sine_amp
    }

    /// External sine drive frequency (Hz; Oscillatory mode).
    pub fn ext_sine_freq_hz(&self) -> f64 {
        self.sim.params.ext_sine_freq_hz
    }

    /// Current OU background-drive state (model units of P).
    pub fn snapshot_ou(&self) -> Vec<f64> {
        self.sim.ou_state().to_vec()
    }

    // -- PR4: experiment snapshots ---------------------------------------
    /// Take a complete snapshot of the experiment state as JSON
    /// (params, live weights, bias, step count, RNG state, OU state,
    /// E/I, delay history).  See `brain_core::StateSnapshot`.
    pub fn take_snapshot(&self) -> String {
        serde_json::to_string(&self.sim.take_snapshot())
            .unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
    }

    /// Restore a snapshot taken with `take_snapshot`.  After this call
    /// the simulator is bit-identical to the snapshot moment, so
    /// continuing reproduces the uninterrupted trajectory exactly.
    /// Also clears the divergence flag and any scheduled events (a
    /// restored hold must not re-apply itself).
    pub fn restore_snapshot(&mut self, json: &str) -> Result<(), JsValue> {
        let snap: brain_core::StateSnapshot =
            serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.sim
            .restore_snapshot(&snap)
            .map_err(|e| JsValue::from_str(&e))?;
        self.events.clear();
        self.last_p = vec![0.0; self.sim.n];
        self.diverged = None;
        Ok(())
    }

    // -- PR3: runtime weight editing (single-sided, range 0–3) ---------
    /// Set one coupling weight, SINGLE-SIDED: only C_ij changes, C_ji
    /// is untouched (the TVB matrix is only roughly symmetric, so the
    /// direction matters).  Clamps to [0, 3]; returns the stored value.
    /// Takes effect from the next step.  Survives `reset()`.
    pub fn set_weight(&mut self, i: usize, j: usize, w: f64) -> Result<f64, JsValue> {
        self.sim.set_weight(i, j, w).map_err(|e| JsValue::from_str(&e))
    }

    /// Current live weight C_ij.
    pub fn get_weight(&self, i: usize, j: usize) -> f64 {
        self.sim.weight(i, j)
    }

    /// TVB original weight C_ij.
    pub fn original_weight(&self, i: usize, j: usize) -> f64 {
        self.sim.original_weight(i, j)
    }

    /// All live weights, flat row-major (76×76).
    pub fn get_weights(&self) -> Vec<f64> {
        self.sim.weights().iter().flatten().copied().collect()
    }

    /// Restore one weight to its TVB original value; returns that value.
    pub fn reset_weight(&mut self, i: usize, j: usize) -> Result<f64, JsValue> {
        self.sim.reset_weight(i, j).map_err(|e| JsValue::from_str(&e))
    }

    /// Restore ALL weights to their TVB original values.
    pub fn reset_all_weights(&mut self) {
        self.sim.reset_all_weights();
    }

    // -- PR3: sustained bias input (range −1..+1, 0 = off) --------------
    /// Set the sustained bias on `node` (a continuous input added to P
    /// on every step, NOT a pulse), clamped to [−1, +1]; returns the
    /// stored value.  Cleared by `reset()`.
    pub fn set_bias(&mut self, node: usize, value: f64) -> Result<f64, JsValue> {
        self.sim.set_bias(node, value).map_err(|e| JsValue::from_str(&e))
    }

    /// Current sustained bias on `node` (0 = no bias).
    pub fn get_bias(&self, node: usize) -> f64 {
        self.sim.bias(node)
    }

    /// Clear the sustained bias on one node (back to 0 = no bias).
    pub fn clear_bias(&mut self, node: usize) -> Result<(), JsValue> {
        self.sim.clear_bias(node).map_err(|e| JsValue::from_str(&e))
    }

    /// Clear the sustained bias on all nodes.
    pub fn clear_all_bias(&mut self) {
        self.sim.clear_all_bias();
    }

    /// Current excitatory activity, one value per node.
    pub fn snapshot_e(&self) -> Vec<f64> {
        self.sim.state_e().to_vec()
    }

    /// Current inhibitory activity, one value per node.
    pub fn snapshot_i(&self) -> Vec<f64> {
        self.sim.state_i().to_vec()
    }

    /// External input actually applied during the last step, per node.
    pub fn snapshot_p(&self) -> Vec<f64> {
        self.last_p.clone()
    }

    /// True once a divergence has been detected.
    pub fn diverged(&self) -> bool {
        self.diverged.is_some()
    }

    /// Human-readable divergence detail, or an empty string.
    pub fn divergence_detail(&self) -> String {
        self.diverged.clone().unwrap_or_default()
    }

    /// Mean E across all nodes (used by the UI's "network locked"
    /// indicator; the threshold lives in the worker, not here).
    pub fn mean_e(&self) -> f64 {
        let e = self.sim.state_e();
        e.iter().sum::<f64>() / e.len() as f64
    }

    fn prune_events(&mut self, now_ms: f64) {
        self.events
            .retain(|ev| now_ms < ev.start_ms + ev.duration_ms);
    }
}

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

use brain_core::{Params, Simulator, StimulusEvent};
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
    /// clear all events, clear the divergence flag.  Parameters are kept.
    pub fn reset(&mut self) {
        self.sim.reset();
        self.events.clear();
        self.last_p = vec![0.0; self.sim.n];
        self.diverged = None;
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

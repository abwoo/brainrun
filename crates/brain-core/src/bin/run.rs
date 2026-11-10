//! `brain-core-run`: run the Wilson-Cowan engine from JSON files.
//!
//! Usage:
//!   brain-core-run --connectivity app/public/brain-assets/connectivity.json \
//!                  --scenario scenario.json --output out.json
//!
//! Scenario JSON:
//!   {
//!     "duration_ms": 5000.0,
//!     "params": { "theta_e": 1.0, "g": 0.4, ... },   // full Params object
//!     "events": [ {"node": 40, "start_ms": 1000.0, "duration_ms": 100.0, "amplitude": 2.0} ]
//!   }
//! Output JSON: {"t_ms": [...], "E": [[...]], "I": [[...]], "P": [[...]]}
//! with one row per integration step (row 0 is t=0).

use std::fs;
use std::process::ExitCode;

use brain_core::{Params, Simulator, StimulusEvent};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ScenarioParams {
    c_ee: f64,
    c_ei: f64,
    c_ie: f64,
    c_ii: f64,
    tau_e: f64,
    tau_i: f64,
    a_e: f64,
    b_e: f64,
    a_i: f64,
    b_i: f64,
    theta_e: f64,
    theta_i: f64,
    c_e: f64,
    c_i: f64,
    r_e: f64,
    r_i: f64,
    k_e: f64,
    k_i: f64,
    alpha_e: f64,
    alpha_i: f64,
    #[serde(rename = "G")]
    g: f64,
    speed: f64,
    dt: f64,
    stim_amplitude: f64,
    stim_duration_ms: f64,
    noise_amp: f64,
    seed: u64,
}

impl From<ScenarioParams> for Params {
    fn from(s: ScenarioParams) -> Params {
        Params {
            c_ee: s.c_ee,
            c_ei: s.c_ei,
            c_ie: s.c_ie,
            c_ii: s.c_ii,
            tau_e: s.tau_e,
            tau_i: s.tau_i,
            a_e: s.a_e,
            b_e: s.b_e,
            a_i: s.a_i,
            b_i: s.b_i,
            theta_e: s.theta_e,
            theta_i: s.theta_i,
            c_e: s.c_e,
            c_i: s.c_i,
            r_e: s.r_e,
            r_i: s.r_i,
            k_e: s.k_e,
            k_i: s.k_i,
            alpha_e: s.alpha_e,
            alpha_i: s.alpha_i,
            g: s.g,
            speed: s.speed,
            dt: s.dt,
            stim_amplitude: s.stim_amplitude,
            stim_duration_ms: s.stim_duration_ms,
            noise_amp: s.noise_amp,
            seed: s.seed,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ScenarioEvent {
    node: usize,
    start_ms: f64,
    duration_ms: f64,
    amplitude: f64,
}

#[derive(Debug, Deserialize)]
struct Scenario {
    duration_ms: f64,
    params: ScenarioParams,
    #[serde(default)]
    events: Vec<ScenarioEvent>,
    /// Initial E for all nodes (default 0.0).
    #[serde(default)]
    e0: f64,
    /// Initial I for all nodes (default 0.0).
    #[serde(default)]
    i0: f64,
}

#[derive(Debug, Deserialize)]
struct Connectivity {
    weights: Vec<Vec<f64>>,
    lengths: Vec<Vec<f64>>,
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let mut connectivity_path = None;
    let mut scenario_path = None;
    let mut output_path = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--connectivity" => {
                connectivity_path = Some(args[i + 1].clone());
                i += 2;
            }
            "--scenario" => {
                scenario_path = Some(args[i + 1].clone());
                i += 2;
            }
            "--output" => {
                output_path = Some(args[i + 1].clone());
                i += 2;
            }
            other => {
                eprintln!("unknown argument: {other}");
                return ExitCode::from(2);
            }
        }
    }
    let (Some(connectivity_path), Some(scenario_path), Some(output_path)) =
        (connectivity_path, scenario_path, output_path)
    else {
        eprintln!("usage: brain-core-run --connectivity <path> --scenario <path> --output <path>");
        return ExitCode::from(2);
    };

    let conn_text = match fs::read_to_string(&connectivity_path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("cannot read connectivity {connectivity_path}: {e}");
            return ExitCode::from(1);
        }
    };
    let conn: Connectivity = match serde_json::from_str(&conn_text) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("cannot parse connectivity JSON: {e}");
            return ExitCode::from(1);
        }
    };
    let scen_text = match fs::read_to_string(&scenario_path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("cannot read scenario {scenario_path}: {e}");
            return ExitCode::from(1);
        }
    };
    let scen: Scenario = match serde_json::from_str(&scen_text) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("cannot parse scenario JSON: {e}");
            return ExitCode::from(1);
        }
    };

    let params: Params = scen.params.into();
    let events: Vec<StimulusEvent> = scen
        .events
        .iter()
        .map(|e| StimulusEvent {
            node: e.node,
            start_ms: e.start_ms,
            duration_ms: e.duration_ms,
            amplitude: e.amplitude,
        })
        .collect();
    let mut sim = match Simulator::new(conn.weights, conn.lengths, params) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("cannot build simulator: {e}");
            return ExitCode::from(1);
        }
    };
    if scen.e0 != 0.0 || scen.i0 != 0.0 {
        sim.set_initial(scen.e0, scen.i0);
    }
    let result = match sim.run(scen.duration_ms, &events) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("simulation diverged: {e}");
            return ExitCode::from(1);
        }
    };
    let out = serde_json::json!({
        "t_ms": result.t_ms,
        "E": result.e,
        "I": result.i,
        "P": result.p,
    });
    if let Err(e) = fs::write(&output_path, serde_json::to_string(&out).unwrap()) {
        eprintln!("cannot write output {output_path}: {e}");
        return ExitCode::from(1);
    }
    println!("wrote {} steps to {}", result.n_steps, output_path);
    ExitCode::SUCCESS
}

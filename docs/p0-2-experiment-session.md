# BrainRun P0-2 · ExperimentSession + Worker-authoritative event time

## Scope — first verified vertical slice

- Every LIVE Rust/WASM run has a distinct `runId`, a model and geometry identity, explicit **unregistered** spatial status, seed, lineage parent, and fixed-step Worker clock.
- Worker returns `command_ack` after actually accepting/processing commands. Pulse enqueue ACK is **accepted**, not a claim that the source instantly created EEG. Applied parameter/weight/bias/step/reset commands are **applied** at their actual Worker `sim.time_ms()`.
- Received LIVE snapshots carry Worker `run_id`, and the session ledger rejects old-run late packets. Reset/restore creates a new derived run identity; commands are not assigned to an earlier trajectory.
- Previous visual stimulus markers are corrected to the real Worker acceptance time when ACK arrives. Response baselines retain the timestamp of the **last available snapshot**, which is a different fact.
- Each scientific EEG lab execution creates its own provenance: **independent local-column run**, or **live-derived run with `parentRunId` pointing to the Worker and its actual snapshot cadence**. This does *not* imply 250 Hz source data — it remains explicit 60 Hz snapshot interpolation.
- ERP epochs produced from the current Raw inherit its run identity. Late independent oddball epochs receive **another independent run**; the UI warns about Raw/ERP mismatch.
- Session metadata is run-scoped and has bounded buffers; no experiment state is silently stored in external services or localStorage. Existing manual WASM snapshot format is preserved.
- Advanced UI shows the LIVE run ID, Worker time and count of acknowledged commands. Regular users do not need to understand these details to use the default PLAY mode.

## Scientific boundaries / remaining work

This PR provides **lineage and source truth**, not a false complete integration: JR, cellular, and independent TES/TMS still use independent solvers. Full trial/condition/event integration and export, model snapshots as typed session artifacts, and bridge from native 250/500 Hz solver trace are staged in subsequent P0-2/P0-3 work. In particular, a 60Hz rendered WC E/I snapshot interpolated into 250 Hz is *not* genuine 250Hz electrophysiology. The TVB demo 76-region connectome is not human MRI-registered and may not be called a full-head source.

## Acceptance

- [ ] Session and reset/rewind monotonicity tests (run IDs, old-event exclusion)
- [ ] Actual Worker-ACK time and accepted/applied status in Playwright, no browser wall-time substitution
- [ ] Independent and derived EEG/ERP provenance displays and mismatch warnings
- [ ] PR5/PR6 scientific and UI regression green
- [ ] No previously passing source-model numerical tests weakened
- [ ] Review this PR without merging to main until its prerequisite P0-1B carry-forward is in main

Next: P0-2B validate full typed source/EEG/event/epoch/experiment records, model parameter timeline and artifact export. P0-3 native EEG integration-sampling follows only after the event clock and source lineage is verified.

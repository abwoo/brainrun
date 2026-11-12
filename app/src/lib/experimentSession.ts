/**
 * P0-2: scientifically honest experiment lineage and authoritative simulation clock.
 *
 * One LIVE Wilson–Cowan Worker run has one runId. Only the Worker may assign
 * model time to accepted/applied commands. UI dispatch timestamps are NEVER
 * treated as execution times. Independent JR/EEG/cellular calculations must
 * have their own runId until a validated registration/coupling exists.
 *
 * This ledger is provenance/experiment metadata, NOT a new numerical solver,
 * 250 Hz source sampler, or claim of TVB→MNE human-space registration.
 */
export type ExperimentOrigin = 'live-wasm' | 'independent' | 'live-derived';
export type ExperimentClock = 'worker-ms' | 'independent-model-ms' | 'derived-from-worker-snapshots';
export type ScientificRegistration = 'unregistered' | 'validated';
export interface ExperimentProvenance {
  runId: string;
  parentRunId: string | null;
  origin: ExperimentOrigin;
  clock: ExperimentClock;
  solverId: string;
  anatomyId: string;
  registration: ScientificRegistration;
  seed: number | null;
  /** Informational wall clock; scientific timestamps are NEVER based on this. */
  createdAtIso: string;
}
export interface ExperimentCommand {
  id: number;
  runId: string;
  command: string;
  tMs: number;
  /** Worker queues stimuli with start = tMs; parameter edits apply immediately. */
  status: 'accepted' | 'applied';
}
export interface ExperimentArtifact {
  id: string;
  runId: string;
  kind: 'eeg-raw' | 'events' | 'epochs' | 'psd' | 'tfr' | 'topography' | 'inverse' | 'snapshot';
  /** Actual signal or source time within its parent model; never wall time. */
  tMs: number;
  sourceId: string;
  methodId: string;
}
export interface ExperimentSessionSnapshot {
  provenance: ExperimentProvenance;
  lastModelTimeMs: number | null;
  commands: ExperimentCommand[];
  artifacts: ExperimentArtifact[];
  snapshotTimesMs: number[];
}
export interface SessionInit {
  origin: ExperimentOrigin;
  solverId: string;
  anatomyId: string;
  registration: ScientificRegistration;
  seed: number | null;
  parentRunId?: string | null;
  clock?: ExperimentClock;
}
const clockFor = (origin: ExperimentOrigin): ExperimentClock =>
  origin === 'live-wasm' ? 'worker-ms'
  : origin === 'live-derived' ? 'derived-from-worker-snapshots'
  : 'independent-model-ms';
const assertTime = (t: number): void => {
  if (!Number.isFinite(t) || t < 0) throw new RangeError('Invalid model time in milliseconds');
};
const cap = <T>(xs: T[], size: number): void => {
  if (xs.length > size) xs.splice(0, xs.length - size);
};

/** Pure lineage manager; pass deterministic IDs in tests. No local storage. */
export class ExperimentSession {
  private current: ExperimentProvenance;
  private lastModelTimeMs: number | null = null;
  private commands: ExperimentCommand[] = [];
  private artifacts: ExperimentArtifact[] = [];
  private snapshotTimesMs: number[] = [];
  private readonly listeners = new Set<(session: ExperimentSessionSnapshot) => void>();
  private readonly idFactory: () => string;
  private readonly nowIso: () => string;
  constructor(init: SessionInit, options: {
    idFactory?: () => string;
    nowIso?: () => string;
  } = {}) {
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.current = this.makeProvenance(init);
  }
  private makeProvenance(init: SessionInit): ExperimentProvenance {
    const runId = this.idFactory();
    if (!runId || typeof runId !== 'string') throw new Error('Missing experiment runId');
    if (!init.solverId || !init.anatomyId) throw new Error('Missing scientific model provenance');
    return {
      runId,
      parentRunId: init.parentRunId ?? null,
      origin: init.origin,
      clock: init.clock ?? clockFor(init.origin),
      solverId: init.solverId,
      anatomyId: init.anatomyId,
      registration: init.registration,
      seed: init.seed,
      createdAtIso: this.nowIso(),
    };
  }
  get runId(): string { return this.current.runId; }
  get provenance(): ExperimentProvenance { return { ...this.current }; }
  getSnapshot(): ExperimentSessionSnapshot {
    return {
      provenance: this.provenance,
      lastModelTimeMs: this.lastModelTimeMs,
      commands: this.commands.map(x => ({ ...x })),
      artifacts: this.artifacts.map(x => ({ ...x })),
      snapshotTimesMs: [...this.snapshotTimesMs],
    };
  }
  subscribe(cb: (state: ExperimentSessionSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private publish(): void {
    if (this.listeners.size) {
      const state = this.getSnapshot();
      this.listeners.forEach(cb => cb(state));
    }
  }
  /**
   * Reset/rewind creates a NEW lineage. No 0ms data from another run can
   * appear in the current snapshot, even when an old Worker reply is late.
   */
  newRun(update: Partial<Omit<SessionInit, 'parentRunId'>> = {}, parent = true): string {
    const last = this.current;
    this.current = this.makeProvenance({
      origin: update.origin ?? last.origin,
      solverId: update.solverId ?? last.solverId,
      anatomyId: update.anatomyId ?? last.anatomyId,
      registration: update.registration ?? last.registration,
      seed: update.seed === undefined ? last.seed : update.seed,
      clock: update.clock ?? last.clock,
      parentRunId: parent ? last.runId : null,
    });
    this.lastModelTimeMs = null;
    this.commands = [];
    this.artifacts = [];
    this.snapshotTimesMs = [];
    this.publish();
    return this.current.runId;
  }
  recordModelTime(runId: string, tMs: number): boolean {
    if (runId !== this.runId) return false;
    assertTime(tMs);
    if (this.lastModelTimeMs !== null && tMs < this.lastModelTimeMs) {
      throw new RangeError('Non-monotonic Worker model clock inside run');
    }
    this.lastModelTimeMs = tMs;
    this.snapshotTimesMs.push(tMs);
    cap(this.snapshotTimesMs, 600);
    this.publish();
    return true;
  }
  recordAcknowledgement(
    runId: string, command: ExperimentCommand,
  ): boolean {
    if (runId !== this.runId) return false;
    assertTime(command.tMs);
    if (command.runId !== runId || !Number.isSafeInteger(command.id) || command.id <= 0) {
      throw new RangeError('Invalid accepted command provenance');
    }
    // Command acknowledgements may arrive after an earlier snapshot or with
    // equal timestamps. Do not mistake network delivery time for model time.
    if (this.commands.some(x => x.id === command.id)) {
      throw new Error('Duplicate command acknowledgement');
    }
    this.commands.push({ ...command });
    cap(this.commands, 1000);
    this.publish();
    return true;
  }
  recordArtifact(artifact: ExperimentArtifact): boolean {
    if (artifact.runId !== this.runId) return false;
    assertTime(artifact.tMs);
    if (!artifact.id || !artifact.sourceId || !artifact.methodId) {
      throw new Error('Artifact must name its source and calculation method');
    }
    if (this.artifacts.some(a => a.id === artifact.id)) {
      throw new Error('Duplicate artifact provenance ID');
    }
    this.artifacts.push({ ...artifact });
    cap(this.artifacts, 500);
    this.publish();
    return true;
  }
}
/** A derived signal explicitly retains its source run without conflating clocks. */
export function makeDerivedSession(
  upstream: ExperimentProvenance,
  solverId: string,
  opts: { idFactory?: () => string; nowIso?: () => string } = {},
): ExperimentSession {
  if (!upstream.runId) throw new Error('Derived run has no upstream runId');
  return new ExperimentSession({
    origin:'live-derived',
    solverId,
    anatomyId: upstream.anatomyId,
    registration: upstream.registration,
    seed: upstream.seed,
    parentRunId: upstream.runId,
  }, opts);
}

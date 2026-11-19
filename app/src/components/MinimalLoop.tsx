/**
 * MinimalLoop — the whole minimal 3D closed-loop product (design doc,
 * 2026-11-19 user direction 17:11). One full-page 3D scene, one run/stop
 * button, one status line, one honesty footer line. Nothing else.
 *
 * Replaces ClosedLoopBench + PictorialLoop + BenchDrillDown + PictorialHead
 * + SimulatedHand and all seven drill-down workspaces (brain / cap /
 * experiment / test / amplifier / stimulator / peripheral). Not a patch:
 * the old presentation files are deleted.
 *
 * What is FIXED here (no controls, no toggles, no menus):
 * - protocol: oddball only (standard amp 1, oddball amp 2, ISI 1000 ms,
 *   every 5th trial oddball, 100 ms, auditory nodes rA1/lA1);
 * - subject: g 0.35, c_ei 4.0, spontaneous background, ou_sigma 0.10,
 *   RT 320–440 ms, seed 1 (= DEFAULT_PARAMS + benchSettings defaults);
 * - cap: 10-10 · 64 channels; amplifier: 250 Hz, average reference,
 *   0.5–40 Hz band-pass, gain 1.
 *
 * What is KEPT (display only, physics untouched): the Rust Wilson–Cowan
 * engine + Worker + bench protocol/trigger machinery, one shared
 * recording (native 1 ms acquisition, last 10 s), one clock. The bench
 * recording assembly (assembleBenchRecording) and the analysis tabs are
 * gone with the drill-downs — the waveform here reads the acquired
 * recording directly.
 *
 * IRON RULE (PR #45): no auto-focus effect anywhere, no changing
 * callback in an effect dep array. The overlays never move focus: Esc /
 * backdrop / close button only close them. A node test pins this.
 */
import {
  memo, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useI18n } from '../lib/i18n';
import MinimalScene from './MinimalScene';
import { drawMultiChannelWaveform, drawWaveform, type MultiChannelSeries } from '../lib/benchWaveform';
import { useSphereFixture } from '../lib/benchFixture';
import { selectBenchCapChannels } from '../lib/benchCap';
import { createSimulatedSubject } from '../lib/benchSubject';
import {
  createBenchProtocolEngine, type BenchProtocolEngine, type BenchProtocolEvent,
} from '../lib/benchProtocol';
import { createBenchTrace, type BenchTraceEvent } from '../lib/benchTrace';
import { runNativeExperiment } from '../lib/nativeEeg';
import {
  capturePhysicalProjection, physicalProjectionReady,
} from '../lib/physicalProjection';
import { setPhysicalSource } from '../lib/physicalExperiment';
import { reReferenceRecording, sensoryTargetNodes } from '../lib/eegRecording';
import type { BrainData } from '../lib/brainData';
import { DEFAULT_PARAMS, type SimClient } from '../lib/simClient';
import type { Snapshot } from '../worker/protocol';
import type { EegRecording } from '../lib/eegData';

export interface MinimalLoopProps {
  data: BrainData | null;
  sim: SimClient | null;
  ready: boolean;
  error: string | null;
  snap: Snapshot | null;
}

const TRACE_CAP = 200;
const WAVE_WINDOW_MS = 5000;
/** The 8 channels shown on the recording computer (fixed). */
const WAVE_CHANNELS = ['Fp1', 'Fp2', 'F3', 'F4', 'C3', 'C4', 'Pz', 'Oz'];

/**
 * Wave overlay (recording computer -> enlarged multi-channel waveform).
 *
 * Memoized on purpose (crash investigation, 2026-11-19): the parent
 * re-renders at snapshot rate (~15 Hz) while a protocol runs, and the
 * open overlay must NOT re-render with it — on iOS the page re-rendering
 * underneath an open overlay / native picker is one of the suspected
 * tap-crash mechanisms. These props only change when the recording
 * refreshes (~5 s) or the user closes the overlay, so memo() isolates
 * the open overlay from the snapshot stream. No focus management here:
 * the overlay never moves focus (PR #45 iron rule).
 */
const WaveOverlay = memo(function WaveOverlay(props: {
  title: string; backLabel: string; meta: string; notReadyReason: string;
  waveChannels: MultiChannelSeries[]; onClose: () => void;
}) {
  const { title, backLabel, meta, notReadyReason, waveChannels, onClose } = props;
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas || waveChannels.length === 0) return;
    drawMultiChannelWaveform(canvas, waveChannels);
  }, [waveChannels]);
  return (
    <div className="minimal-overlay" data-testid="minimal-overlay" data-overlay="wave">
      <div className="minimal-overlay-backdrop" aria-hidden="true" onClick={onClose} />
      <div className="minimal-overlay-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="minimal-overlay-header">
          <h2>{title}</h2>
          <button type="button" className="ui-button" data-testid="minimal-overlay-close"
            onClick={onClose}>
            {backLabel}
          </button>
        </header>
        <div className="minimal-overlay-body">
          <p className="minimal-note">{meta}</p>
          {waveChannels.length === 0 ? (
            <p className="minimal-note">{notReadyReason}</p>
          ) : (
            <canvas ref={waveCanvasRef} className="minimal-wave-canvas"
              data-testid="minimal-wave-canvas"
              data-channels={waveChannels.map((c) => c.label).join(',')} />
          )}
        </div>
      </div>
    </div>
  );
});

/**
 * Channel overlay (brain -> all 64 channels; tap one for its large
 * waveform). Memoized for the same reason as WaveOverlay: the 64-button
 * grid + canvas must not re-render at snapshot rate while open.
 */
const ChannelOverlay = memo(function ChannelOverlay(props: {
  title: string; hint: string; backLabel: string; notReadyReason: string;
  capLabels: string[]; selectedChannel: string; selectedSeries: number[] | null;
  onSelectChannel: (label: string) => void; onClose: () => void;
}) {
  const { title, hint, backLabel, notReadyReason, capLabels, selectedChannel,
    selectedSeries, onSelectChannel, onClose } = props;
  const channelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = channelCanvasRef.current;
    if (!canvas || !selectedSeries) return;
    drawWaveform(canvas, selectedSeries);
  }, [selectedSeries, selectedChannel]);
  return (
    <div className="minimal-overlay" data-testid="minimal-overlay" data-overlay="channels">
      <div className="minimal-overlay-backdrop" aria-hidden="true" onClick={onClose} />
      <div className="minimal-overlay-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="minimal-overlay-header">
          <h2>{title}</h2>
          <button type="button" className="ui-button" data-testid="minimal-overlay-close"
            onClick={onClose}>
            {backLabel}
          </button>
        </header>
        <div className="minimal-overlay-body">
          <p className="minimal-note">{hint}</p>
          <div className="minimal-channel-grid">
            {capLabels.map((label) => (
              <button key={label} type="button"
                className={`chip chip-small${selectedChannel === label ? ' chip-on' : ''}`}
                data-testid={`minimal-channel-${label}`}
                aria-pressed={selectedChannel === label}
                onClick={() => onSelectChannel(label)}>
                {label}
              </button>
            ))}
            {capLabels.length === 0 && (
              <span className="minimal-note">{notReadyReason}</span>
            )}
          </div>
          <canvas ref={channelCanvasRef} className="minimal-channel-canvas"
            data-testid="minimal-channel-canvas"
            data-channel={selectedChannel} />
        </div>
      </div>
    </div>
  );
});

export default function MinimalLoop(props: MinimalLoopProps) {
  const { data, sim, ready, error, snap } = props;
  const { locale, t } = useI18n();
  const engineReady = ready && sim !== null;
  const notReadyReason = t('bench.status.notReady');

  // ---------- fixed subject + fixed engine params ----------
  // The engine is the fixed default subject: DEFAULT_PARAMS already is
  // g 0.35 / c_ei 4.0 / ou_sigma 0.10 / ext_sine 0 / 10 Hz, and the
  // default background mode is spontaneous. Apply on engine-ready so a
  // return from #basic (which can change the mode) never leaks in.
  useEffect(() => {
    if (!sim || !ready) return;
    sim.setParams({ ...DEFAULT_PARAMS });
    sim.setBackgroundMode('spontaneous');
  }, [sim, ready]);

  // ---------- head model + cap (fixed 10-10 · 64) ----------
  const { fixture, fixtureError } = useSphereFixture();
  const capSelection = useMemo(() => {
    if (!fixture) return null;
    try {
      return selectBenchCapChannels(fixture, '10-10-64');
    } catch {
      return null;
    }
  }, [fixture]);
  const capLabels: string[] = useMemo(() => capSelection?.labels ?? [], [capSelection]);
  // The cap preset IS the channel state: push it into the shared physical
  // source state so the projection — and therefore the recording — carries
  // exactly these labels.
  useEffect(() => {
    if (!capSelection) return;
    try {
      setPhysicalSource({ montage: capSelection.montage, selectedLabels: [...capSelection.labels] });
    } catch {
      // No cap error surface in the minimal version; the waveform area
      // simply stays empty until the fixture loads.
    }
  }, [capSelection]);

  // ---------- overlays (no focus management: never move focus) ----------
  const [overlay, setOverlay] = useState<null | 'wave' | 'channels'>(null);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  // onClose arrives as a fresh inline closure on every parent render, so it
  // must NOT be an effect dep. Mount-only effect; close read via a ref.
  // No .focus() call here or anywhere else in this file (PR #45 iron rule).
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const closeRef = useRef(closeOverlay);
  closeRef.current = closeOverlay;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- acquisition (native 1 ms path, one shared recording) ----------
  const [acquisition, setAcquisition] = useState<{
    recording: EegRecording; t0Ms: number;
  } | null>(null);
  const acquisitionRef = useRef<{ recording: EegRecording; t0Ms: number } | null>(null);
  const [acqError, setAcqError] = useState<string | null>(null);
  const acquiringRef = useRef(false);
  const [selectedChannel, setSelectedChannel] = useState('Pz');
  const selectedChannelRef = useRef(selectedChannel);
  selectedChannelRef.current = selectedChannel;
  // Stable identity so the memoized ChannelOverlay does not re-render
  // when the parent re-renders at snapshot rate.
  const handleSelectChannel = useCallback((label: string) => setSelectedChannel(label), []);

  const runAcquisition = useCallback(() => {
    if (!sim || !ready || !fixture || acquiringRef.current) return acquisitionRef.current;
    acquiringRef.current = true;
    try {
      const samples = sim.getNativeHistory();
      if (samples.length < 1001) return acquisitionRef.current;
      if (!physicalProjectionReady(fixture)) return acquisitionRef.current;
      const projection = capturePhysicalProjection(fixture);
      const first = samples[0];
      const { recording: rawRec, t0Ms } = runNativeExperiment({
        sfreqHz: 250,
        projection,
        samples,
        node: 0,
        baselineE: first.e[0],
        baselineI: first.i[0],
        markers: sim.getMarkers(),
        noise: null,
        seed: 1,
      });
      const recording = rawRec.reference.mode === 'average'
        ? rawRec
        : reReferenceRecording(rawRec, { mode: 'average' });
      const acquired = { recording, t0Ms };
      acquisitionRef.current = acquired;
      setAcquisition(acquired);
      setAcqError(null);
      if (!recording.channels.some((c) => c.label === selectedChannelRef.current)) {
        setSelectedChannel(recording.channels.some((c) => c.label === 'Pz')
          ? 'Pz' : recording.channels[0]?.label ?? 'Pz');
      }
      return acquired;
    } catch (e) {
      setAcqError(String(e));
      return acquisitionRef.current;
    } finally {
      acquiringRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, ready, fixture]);

  const refreshAll = useCallback(() => {
    runAcquisition();
  }, [runAcquisition]);

  // Closing an overlay catches the recording up: acquisition refreshes
  // are throttled while an overlay is open (crash investigation), so the
  // first refresh after close must not wait for the next 5 s tick.
  const prevOverlayRef = useRef(overlay);
  useEffect(() => {
    if (prevOverlayRef.current !== null && overlay === null) refreshAll();
    prevOverlayRef.current = overlay;
  }, [overlay, refreshAll]);

  // Acquire once the engine + fixture + cap are ready; retry until the
  // native history is long enough (runAcquisition guards <1001 samples).
  const lastAutoRef = useRef(0);
  useEffect(() => {
    if (!engineReady || !fixture || !capSelection) return;
    const now = Date.now();
    if (now - lastAutoRef.current < 500) return;
    lastAutoRef.current = now;
    refreshAll();
  }, [engineReady, fixture, capSelection, refreshAll]);

  // ---------- loop trace (drives the scene's node flashes + particles) ----------
  const traceRef = useRef(createBenchTrace(TRACE_CAP));
  const [traceList, setTraceList] = useState<BenchTraceEvent[]>([]);
  const appendTrace = useCallback((e: Omit<BenchTraceEvent, 'seq'>) => {
    traceRef.current.append(e);
    setTraceList(traceRef.current.list());
  }, []);
  const flowEvents = useMemo(() => traceList.slice(-5), [traceList]);

  // ---------- protocol engine: fixed oddball ----------
  const [protocolRunning, setProtocolRunning] = useState(false);
  const [protocolEverStarted, setProtocolEverStarted] = useState(false);
  const [trialCount, setTrialCount] = useState(0);
  const engineRef = useRef<BenchProtocolEngine | null>(null);
  const snapRef = useRef(snap);
  useEffect(() => { snapRef.current = snap; }, [snap]);

  const handleProtocolEvent = useCallback((e: BenchProtocolEvent) => {
    if (e.kind === 'protocol-started') {
      setProtocolRunning(true);
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'protocol-started',
        label: 'protocol started', value: 'oddball', confirmed: false });
    } else if (e.kind === 'protocol-stopped') {
      setProtocolRunning(false);
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'protocol-stopped',
        label: 'protocol stopped', value: e.reason ?? '', confirmed: false });
    } else if (e.kind === 'stimulus-sent') {
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'trigger',
        label: 'trigger sent', value: `node ${e.node ?? '—'}`, confirmed: false });
      appendTrace({ tMs: e.tMs, hop: 'stimulator', kind: 'command',
        label: 'stimulus command sent', value: `node ${e.node ?? '—'}`, confirmed: false });
      appendTrace({ tMs: e.tMs, hop: 'brain', kind: 'trigger',
        label: 'stimulus reached the brain', value: `node ${e.node ?? '—'}`, confirmed: false });
    } else if (e.kind === 'response') {
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'response',
        label: 'subject responded', value: `RT ${Math.round(e.rtMs ?? 0)} ms`,
        confirmed: e.confirmed ?? false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendTrace]);

  useEffect(() => {
    if (!sim || !ready) { engineRef.current = null; setProtocolRunning(false); return; }
    const subject = createSimulatedSubject({ seed: 1, rtMinMs: 320, rtMaxMs: 440 });
    const engine = createBenchProtocolEngine({
      pulseAt: (node, amplitude, durationMs) => sim.pulseAt(node, amplitude, durationMs),
      configureFeedback: (config) => sim.configureNativeFeedback(config),
      subject,
      onEvent: handleProtocolEvent,
      regions: data?.regions,
    });
    engineRef.current = engine;
    return () => { engine.stop(); engineRef.current = null; };
  }, [sim, ready, data, handleProtocolEvent]);

  // Worker clock drives the engine: confirm ACKs first, then tick.
  useEffect(() => {
    if (!sim || !ready || !snap) return;
    const engine = engineRef.current;
    if (!engine) return;
    engine.confirmFromMarkers(sim.getMarkers());
    engine.tick(snap.t_ms);
  }, [sim, ready, snap]);

  // 250 ms poll: read-only bookkeeping (trial count, running state, new
  // markers -> amplifier hop, live refresh while running). Never decides
  // stimulus timing — that is the snapshot effect above.
  const seenMarkerCountRef = useRef(0);
  const lastAcquireAttemptRef = useRef(0);
  const lastLiveRefreshRef = useRef(0);
  const wasProtocolRunningRef = useRef(false);
  useEffect(() => {
    if (!sim || !ready) return;
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (engine) {
        setTrialCount(engine.trialIndex);
        setProtocolRunning(engine.running);
        const running = engine.running;
        // Crash investigation (2026-11-19): throttle the acquisition
        // refresh while an overlay is open or the tab is backgrounded —
        // the refresh is the heaviest main-thread work, and on iPhone
        // the memory + re-render pressure behind an open overlay is one
        // of the suspected tap-crash mechanisms. The snapshot effect
        // above (engine.tick) keeps running: the protocol clock never
        // pauses, only the display refresh does.
        const throttled = overlayRef.current !== null || document.hidden;
        if (running && acquisitionRef.current && fixture && capSelection && !throttled) {
          const now = Date.now();
          if (now - lastLiveRefreshRef.current >= 5000) {
            lastLiveRefreshRef.current = now;
            refreshAll();
          }
        }
        if (wasProtocolRunningRef.current && !running) refreshAll();
        wasProtocolRunningRef.current = running;
      }
      const markers = sim.getMarkers();
      if (markers.length < seenMarkerCountRef.current) seenMarkerCountRef.current = 0;
      if (markers.length > seenMarkerCountRef.current) {
        const fresh = markers.slice(seenMarkerCountRef.current);
        seenMarkerCountRef.current = markers.length;
        for (const m of fresh) {
          if (m.kind !== 'pulse') continue;
          appendTrace({ tMs: m.t_ms, hop: 'amplifier', kind: 'trigger',
            label: 'trigger logged to event stream', value: `node ${m.node}`, confirmed: true });
        }
      }
      if (!acquisitionRef.current && fixture && capSelection
        && overlayRef.current === null && !document.hidden) {
        const now = Date.now();
        if (now - lastAcquireAttemptRef.current >= 1000) {
          lastAcquireAttemptRef.current = now;
          refreshAll();
        }
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [sim, ready, fixture, capSelection, refreshAll, appendTrace]);

  // ---------- run / stop (the one button) ----------
  const auditoryNodes = useMemo(
    () => (data ? sensoryTargetNodes(data.regions, 'auditory') : []), [data]);
  const runProtocol = useCallback(() => {
    const engine = engineRef.current;
    const startTms = sim?.getLatest()?.t_ms ?? snapRef.current?.t_ms ?? 0;
    if (!engine || !sim || !ready) return;
    engine.start('oddball', {
      node: auditoryNodes[0] ?? 0,
      standardAmplitude: 1, oddballAmplitude: 2,
      isiMs: 1000, oddballEvery: 5, pulseDurationMs: 100,
    }, startTms);
    setProtocolEverStarted(true);
    setProtocolRunning(engine.running);
  }, [sim, ready, auditoryNodes]);
  const stopProtocol = useCallback(() => {
    engineRef.current?.stop();
    setProtocolRunning(false);
  }, []);

  // ---------- waveform series (last 5 s, from the one shared recording) ----------
  const waveChannels: MultiChannelSeries[] = useMemo(() => {
    const rec = acquisition?.recording;
    if (!rec) return [];
    const n = Math.min(rec.timesMs.length, Math.round(WAVE_WINDOW_MS / 1000 * rec.sfreqHz));
    const out: MultiChannelSeries[] = [];
    for (const label of WAVE_CHANNELS) {
      const idx = rec.channels.findIndex((c) => c.label === label);
      if (idx < 0) continue;
      out.push({ label, series: rec.dataUv[idx].slice(-n) });
    }
    // The 64-channel cap is a farthest-point subset of 10-10, so a fixed
    // label may be absent (e.g. F3): fill up to 8 from the recording's own
    // channels so the screen always shows 8 lanes.
    for (let i = 0; i < rec.channels.length && out.length < 8; i++) {
      if (out.some((c) => c.label === rec.channels[i].label)) continue;
      out.push({ label: rec.channels[i].label, series: rec.dataUv[i].slice(-n) });
    }
    return out;
  }, [acquisition]);

  const selectedSeries: number[] | null = useMemo(() => {
    const rec = acquisition?.recording;
    if (!rec) return null;
    const idx = rec.channels.findIndex((c) => c.label === selectedChannel);
    if (idx < 0) return null;
    const n = Math.min(rec.timesMs.length, Math.round(WAVE_WINDOW_MS / 1000 * rec.sfreqHz));
    return rec.dataUv[idx].slice(-n);
  }, [acquisition, selectedChannel]);

  const getWaveData = useCallback(() => waveChannels, [waveChannels]);

  // ---------- status line (one line, plain words) ----------
  const statusText = !engineReady ? notReadyReason
    : protocolRunning ? t('minimal.status.running')
    : protocolEverStarted ? t('minimal.status.stopped')
    : t('minimal.status.notStarted');
  const waveMeta = locale === 'zh-CN'
    ? `${waveChannels.length} 条通道 · 最近 5 秒`
    : `${waveChannels.length} channels · last 5 s`;

  if (!data) {
    return (
      <div className="minimal" data-testid="minimal-loop">
        <p className="minimal-loading">{t('shell.loading')}</p>
      </div>
    );
  }

  return (
    <div className="minimal" data-testid="minimal-loop">
      <MinimalScene
        data={data}
        sim={sim}
        selectedChannel={selectedChannel}
        running={protocolRunning}
        overlayOpen={overlay !== null}
        traceEvents={flowEvents}
        getWaveData={getWaveData}
        trialCount={trialCount}
        onBrainTap={() => setOverlay('channels')}
        onDiscTap={(label) => { setSelectedChannel(label); setOverlay('channels'); }}
        onRecordingTap={() => setOverlay('wave')}
      />

      {/* The one control bar: one run/stop button + one status line. */}
      <div className="minimal-bar">
        <button
          className="minimal-run"
          type="button"
          data-testid="minimal-run-toggle"
          aria-pressed={protocolRunning}
          disabled={!engineReady}
          title={!engineReady ? notReadyReason : undefined}
          onClick={protocolRunning ? stopProtocol : runProtocol}
        >
          {protocolRunning ? t('minimal.stop') : t('minimal.run')}
        </button>
        <p className="minimal-status" data-testid="minimal-status-line" role="status">
          {statusText}
        </p>
      </div>
      {(error ?? acqError ?? fixtureError) && (
        <p className="minimal-error" role="alert">{error ?? acqError ?? fixtureError}</p>
      )}
      <footer className="minimal-footer" data-testid="minimal-footer">{t('bench.footer')}</footer>

      {/* Recording computer -> enlarged multi-channel waveform. */}
      {overlay === 'wave' && (
        <WaveOverlay
          title={t('minimal.waveTitle')}
          backLabel={t('minimal.back')}
          meta={waveMeta}
          notReadyReason={notReadyReason}
          waveChannels={waveChannels}
          onClose={closeOverlay}
        />
      )}

      {/* Brain -> all 64 channels; tap one for its large waveform. */}
      {overlay === 'channels' && (
        <ChannelOverlay
          title={t('minimal.channelTitle')}
          hint={t('minimal.channelHint')}
          backLabel={t('minimal.back')}
          notReadyReason={notReadyReason}
          capLabels={capLabels}
          selectedChannel={selectedChannel}
          selectedSeries={selectedSeries}
          onSelectChannel={handleSelectChannel}
          onClose={closeOverlay}
        />
      )}
    </div>
  );
}

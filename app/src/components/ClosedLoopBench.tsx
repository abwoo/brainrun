import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useI18n } from '../lib/i18n';
import Dropdown from './ui/Dropdown';
import { ControlField, RangeControl } from './ui/ControlField';
import LanguageSwitch from './ui/LanguageSwitch';
import PictorialLoop, { type PictorialNodeId } from './PictorialLoop';
import BenchDrillDown from './BenchDrillDown';
import { drawWaveform } from '../lib/benchWaveform';
import { useSphereFixture } from '../lib/benchFixture';
import {
  EPILEPSY_DIRECTIONS, summarizeCombination, subjectSummaryLine,
  type ComposerState,
} from '../lib/benchSubjects';
import type { BrainData } from '../lib/brainData';
import type {
  BackgroundMode, ResponseSummary, SimClient, StimulusMarker,
} from '../lib/simClient';
import type { Snapshot } from '../worker/protocol';
import {
  getHeadModelSelection, setHeadModelSelection, subscribeHeadModelSelection,
} from '../lib/headModelSelection';
import {
  getBenchSettings, setBenchSettings, subscribeBenchSettings,
  type BenchClosedLoopFeature, type BenchReferenceSel,
} from '../lib/benchSettings';
import { runNativeExperiment, NATIVE_EEG_ID } from '../lib/nativeEeg';
import { ExperimentSession, makeDerivedSession } from '../lib/experimentSession';
import {
  capturePhysicalProjection, physicalProjectionReady,
} from '../lib/physicalProjection';
import { setPhysicalSource } from '../lib/physicalExperiment.ts';
import type { EegEvent, EegRecording, EegReference, EpochSet } from '../lib/eegData';
import ErpTab from './ErpTab';
import TfrTab from './TfrTab';
import TopoTab from './TopoTab';
import InverseTab from './InverseTab';
import WavesTab from './WavesTab';
import {
  recordingToCsv, recordingToJson, reReferenceRecording, rms,
  sensoryTargetNodes, setLiveRecordingStore,
} from '../lib/eegRecording';
import { cooldownRemainingMs, type NativeFeedbackConfig } from '../lib/nativeFeedback';
// ---- Phase 1 bench lib (Implementer A, landed 2026-11-18). Signatures per
// implementation-plan.md §1; the five deviations in A's report are reconciled
// here (optional protocol nodes + regions dep, event `reason`, band-pass edge
// 64 samples, derived-session assembly, single-pulse defaults).
import {
  BENCH_CAP_PRESETS, selectBenchCapChannels,
  type BenchCapPreset, type BenchCapSelection,
} from '../lib/benchCap';
import { bandpassFilter, validateBandpassParams } from '../lib/signalProcessing';
import { createSimulatedSubject } from '../lib/benchSubject';
import {
  createBenchProtocolEngine, findAckMarker, protocolStatusKey,
  type BenchProtocolEngine, type BenchProtocolEvent, type BenchProtocolId,
  type BenchProtocolParams,
} from '../lib/benchProtocol';
import { createBenchTrace, type BenchTraceEvent } from '../lib/benchTrace';
import { isBenchQHighState } from '../lib/benchHighState';
import {
  assembleBenchRecording, benchRecordingToStoreValue,
  type AmplifierConfig, type BenchRecording,
} from '../lib/benchRecording';

/**
 * Closed-loop bench (Phase 1 shell). Props are fixed by implementation-plan.md §2;
 * App.tsx wiring is the coordinator's job. `sim` may be null until the engine is
 * ready — every control that touches the engine is disabled with a reason instead
 * of silently doing nothing.
 */
export interface ClosedLoopBenchProps {
  networkView: ReactNode; data: BrainData | null;
  selectedId: number | null; onSelect: (id: number) => void;
  sim: SimClient | null; ready: boolean; error: string | null;
  snap: Snapshot | null; paused: boolean; onPause: () => void;
  background: BackgroundMode; onBackground: (mode: BackgroundMode) => void;
  strength: number; durationMs: number; onStrength: (v: number) => void; onDuration: (v: number) => void; onPulse: () => void;
  response: ResponseSummary | null; liveMomentNAm: number | null; runId: string | null;
  onReset: () => void; onRecover: () => void;
  onExitToPhysicsHome: () => void;
}

interface Acquisition {
  recording: EegRecording; events: EegEvent[]; t0Ms: number;
  sourcePositionMm: number[]; acquiredAtTms: number;
}
interface StimLogEntry {
  key: number; node: number; amplitude: number; durationMs: number;
  dispatchTms: number; ackTms: number | null; confirmed: boolean;
  /** 本次刺激的 marker 对象（pulseAt 返回值）：ACK 凭引用确认，
   * 不会套住邻试次的 marker；假 pulseAt 不返回值时为 undefined，
   * 回退到窗口匹配。 */
  marker?: StimulusMarker;
}
interface ResponseRow {
  trialIndex: number; stimulusTms: number; responseTms: number;
  rtMs: number; key: string; confirmed: boolean;
}

const TRACE_CAP = 200;
const WAVE_WINDOW_MS = 5000;

function shortRunId(runId: string | null | undefined): string {
  if (!runId) return '—';
  return runId.length > 8 ? runId.slice(0, 8) : runId;
}
function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}
function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ClosedLoopBench(props: ClosedLoopBenchProps) {
  const {
    networkView, data, selectedId, onSelect, sim, ready, error, snap, paused, onPause,
    background, onBackground, strength, durationMs, onStrength, onDuration,
    liveMomentNAm, runId, onReset, onRecover, onExitToPhysicsHome,
  } = props;
  const { locale, t } = useI18n();
  const text = useCallback((zh: string, en: string) => locale === 'zh-CN' ? zh : en, [locale]);
  const engineReady = ready && sim !== null;
  const notReadyReason = text('引擎未就绪：等待 Worker 启动。', 'Engine not ready: waiting for the Worker to start.');

  // ---------- shared head-model store + sphere fixture ----------
  // The fixture is fetched once, module-level cached (benchFixture.ts):
  // PictorialHead fetches it too, for its own cap electrodes.
  const headModel = useSyncExternalStore(subscribeHeadModelSelection, getHeadModelSelection);
  const { fixture, fixtureError } = useSphereFixture();

  // ---------- bench settings (external store; survives workspace switches) ----------
  // Phase 2: every bench setting lives in app/src/lib/benchSettings.ts and is
  // read here via useSyncExternalStore. App.tsx unmounts this component when
  // the workspace changes, so useState settings used to reset to defaults;
  // the store outlives the mount. The setter aliases below keep the rest of
  // this file unchanged; ephemeral run state stays local on purpose.
  const settings = useSyncExternalStore(subscribeBenchSettings, getBenchSettings);
  const {
    capPreset, sampleRate, referenceSel, bandpassOn, lowDraft, highDraft,
    lowHz, highHz, gain, selectedChannel, protocolId, subjectSeed, rtMinMs,
    rtMaxMs, oddballStandardAmp, oddballAmp, oddballIsiMs, oddballEvery,
    oddballDurationMs, flickerFreqHz, flickerAmp, flickerDurationMs,
    clFeature, clThreshold, clAmplitude, clDurationMs, clPeriodMs,
    clCooldownMs, clMaxTriggers, stimTarget,
    g, cEi, ouSigma, extSineAmp, extSineFreqHz,
  } = settings;

  // ---------- cap preset ----------
  const setCapPreset = (v: BenchCapPreset) => setBenchSettings({ capPreset: v });
  const [capSelection, setCapSelection] = useState<BenchCapSelection | null>(null);
  const [capError, setCapError] = useState<string | null>(null);
  useEffect(() => {
    if (!fixture) { setCapSelection(null); return; }
    try {
      setCapSelection(selectBenchCapChannels(fixture, capPreset));
      setCapError(null);
    } catch (e) { setCapSelection(null); setCapError(String(e)); }
  }, [fixture, capPreset]);
  const capLabels: string[] = useMemo(() => capSelection?.labels ?? [], [capSelection]);
  // The cap preset IS the channel state: push it into the shared physical
  // source state so the projection (capturePhysicalProjection) — and therefore
  // the recording — carries exactly these labels. One control, one state;
  // the cap box, the loop strip and the recording can no longer disagree.
  // Sphere only: the template BEM brings its own electrodes and ignores
  // selectedLabels (physicalProjection.ts), so the preset does not apply there.
  useEffect(() => {
    if (headModel !== 'sphere' || !capSelection) return;
    try {
      setPhysicalSource({ montage: capSelection.montage, selectedLabels: [...capSelection.labels] });
    } catch (e) { setCapError(String(e)); }
  }, [headModel, capSelection]);

  // ---------- cap electrodes on the 3D head (Phase 2 item 1) ----------
  // Sphere: the preset's labels → fixture directions. BEM: the template
  // model's own electrodes (the preset does not apply there). Null = the
  // source is not loaded — no markers, and the note below says so.
  // getTemplateModel() is read at render: the model can only be registered
  // from LocalBEMLab (another workspace, which unmounts this component),
  // so a remount re-reads it; nothing registers it while the bench stays
  // mounted.
  // ---------- drill-down + hand state (pictorial bench) ----------
  // Which node overlay is open; null = the picture itself. The bench
  // (engine, protocol, recording) never unmounts while one is open.
  const [drill, setDrill] = useState<
    null | 'brain' | 'cap' | 'experiment' | 'test' | 'amplifier' | 'stimulator'
  >(null);
  const [peripheralOpen, setPeripheralOpen] = useState(false);
  const [handPressing, setHandPressing] = useState(false);
  const handTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (handTimer.current !== null) window.clearTimeout(handTimer.current);
  }, []);

  const openNode = useCallback((node: PictorialNodeId) => {
    if (node === 'peripheral') { setPeripheralOpen(true); return; }
    setDrill(node);
  }, []);
  // PictorialHead fires these on cap/brain clicks (its own picking decides
  // which part was hit); the bench opens the matching drill-down.
  useEffect(() => {
    const onCap = () => setDrill('cap');
    const onBrain = () => setDrill('brain');
    window.addEventListener('pictorial-open-cap', onCap);
    window.addEventListener('pictorial-open-brain', onBrain);
    return () => {
      window.removeEventListener('pictorial-open-cap', onCap);
      window.removeEventListener('pictorial-open-brain', onBrain);
    };
  }, []);

  // ---------- subject composer (design §5): real WC/model parameters ----------
  // A1/A2/B2–B4 write benchSettings AND the live engine via setParams.
  // The composer fields have no defaults in the engine; benchSettings is
  // the single source of truth for what the sliders say.
  const setComposerG = useCallback((v: number) => {
    setBenchSettings({ g: v });
    sim?.setParams({ g: v });
  }, [sim]);
  const setComposerCEi = useCallback((v: number) => {
    setBenchSettings({ cEi: v });
    sim?.setParams({ c_ei: v });
  }, [sim]);
  const setComposerOuSigma = useCallback((v: number) => {
    setBenchSettings({ ouSigma: v });
    sim?.setParams({ ou_sigma: v });
  }, [sim]);
  const setComposerExtSineAmp = useCallback((v: number) => {
    setBenchSettings({ extSineAmp: v });
    sim?.setParams({ ext_sine_amp: v });
  }, [sim]);
  const setComposerExtSineFreqHz = useCallback((v: number) => {
    setBenchSettings({ extSineFreqHz: v });
    sim?.setParams({ ext_sine_freq_hz: v });
  }, [sim]);
  // B1: switching to oscillatory mode resets the engine's sine drive to
  // 0.30 / 10 Hz (Rust set_background_mode); mirror that reset into the
  // composer fields so the sliders never lie about the live values.
  const handleBackgroundMode = useCallback((mode: BackgroundMode) => {
    onBackground(mode);
    if (mode === 'oscillatory') {
      setBenchSettings({ extSineAmp: 0.30, extSineFreqHz: 10 });
    }
  }, [onBackground]);
  const resetSubject = useCallback(() => {
    setBenchSettings({
      g: 0.35, cEi: 4.0, ouSigma: 0.10, extSineAmp: 0, extSineFreqHz: 10,
      subjectSeed: 1, rtMinMs: 320, rtMaxMs: 440,
    });
    sim?.setParams({
      g: 0.35, c_ei: 4.0, ou_sigma: 0.10, ext_sine_amp: 0, ext_sine_freq_hz: 10,
    });
    onBackground('spontaneous');
  }, [sim, onBackground]);
  // Global reset also restores the composer fields: App's onReset restores
  // the ENGINE params to DEFAULT_PARAMS, so the sliders must follow.
  const handleResetAll = useCallback(() => {
    setBenchSettings({
      g: 0.35, cEi: 4.0, ouSigma: 0.10, extSineAmp: 0, extSineFreqHz: 10,
    });
    onReset();
  }, [onReset]);
  const composerState: ComposerState = {
    g, cEi, ouSigma, extSineAmp, extSineFreqHz, background,
    rtMinMs, rtMaxMs,
  };
  const composerSummary = useMemo(
    () => subjectSummaryLine(composerState, locale),
    [composerState, locale],
  );

  // ---------- amplifier state ----------
  const setSampleRate = (v: 250 | 500) => setBenchSettings({ sampleRate: v });
  const setReferenceSel = (v: BenchReferenceSel) => setBenchSettings({ referenceSel: v });
  const reference: EegReference = useMemo(() => referenceSel === 'average'
    ? { mode: 'average' }
    : { mode: 'electrode', label: referenceSel === 'cz' ? 'Cz' : 'M1' }, [referenceSel]);
  // Protocol id mirror for callbacks that run outside render (assembleBench).
  const protocolIdRef = useRef<BenchProtocolId>('single-pulse');
  const setLowDraft = (v: number) => setBenchSettings({ lowDraft: v });
  const setHighDraft = (v: number) => setBenchSettings({ highDraft: v });
  const setLowHz = (v: number) => setBenchSettings({ lowHz: v });
  const setHighHz = (v: number) => setBenchSettings({ highHz: v });
  const bandpassValid = lowDraft > 0 && highDraft > lowDraft && highDraft < sampleRate / 2;
  const setGain = (v: number) => setBenchSettings({ gain: v });
  const setSelectedChannel = (v: string) => setBenchSettings({ selectedChannel: v });
  // M1 is only a real reference when the acquired recording actually carries it:
  // the projection channels come from the physical source state, not the cap preset.
  const [referenceNote, setReferenceNote] = useState<string | null>(null);

  // ---------- acquisition (native 1 ms path) + bench recording ----------
  const [acquisition, setAcquisition] = useState<Acquisition | null>(null);
  const acquisitionRef = useRef<Acquisition | null>(null);
  // M1 is a real reference only when the acquired recording carries it; before
  // the first acquisition, fall back to the cap preset's labels.
  const hasM1 = acquisition
    ? acquisition.recording.channels.some((c) => c.label === 'M1')
    : capLabels.includes('M1');
  const [acquiring, setAcquiring] = useState(false);
  const acquiringRef = useRef(false);
  const [acqError, setAcqError] = useState<string | null>(null);
  const [benchRecording, setBenchRecording] = useState<BenchRecording | null>(null);
  const [benchError, setBenchError] = useState<string | null>(null);
  // Derived session for the bench record (one per upstream live run, reused
  // across re-assemblies so the bench runId stays stable while the live run
  // continues; a reset/new live run derives a fresh one). The raw live
  // session must NOT be passed to assembleBenchRecording (A, 2026-11-18).
  const derivedRef = useRef<{ upstreamRunId: string; session: ExperimentSession } | null>(null);
  const getDerivedSession = useCallback((acq: Acquisition): ExperimentSession => {
    const upstream = sim!.getExperimentSession();
    const upstreamRunId = upstream.provenance.runId;
    const cached = derivedRef.current;
    if (cached && cached.upstreamRunId === upstreamRunId) {
      cached.session.recordModelTime(cached.session.runId, acq.recording.timesMs.at(-1) ?? 0);
      return cached.session;
    }
    const derived = makeDerivedSession(upstream.provenance, NATIVE_EEG_ID);
    derived.recordModelTime(derived.runId, acq.recording.timesMs.at(-1) ?? 0);
    derived.recordArtifact({
      id: 'raw', runId: derived.runId, kind: 'eeg-raw', tMs: 0,
      sourceId: upstreamRunId, methodId: NATIVE_EEG_ID,
    });
    derivedRef.current = { upstreamRunId, session: derived };
    return derived;
  }, [sim]);
  // Extra events in absolute Worker ms (protocol triggers + subject responses).
  // Native marker pulses are already in acquisition.events; assembleBench dedupes.
  const extraEventsRef = useRef<EegEvent[]>([]);
  const extraIdRef = useRef(0);

  const amplifierConfig: AmplifierConfig = useMemo(() => ({
    sampleRateHz: sampleRate,
    reference,
    bandpass: bandpassOn ? { lowHz, highHz } : null,
    gain,
  }), [sampleRate, reference, bandpassOn, lowHz, highHz, gain]);

  const runAcquisition = useCallback((): Acquisition | null => {
    if (!sim || !ready || !fixture || acquiringRef.current) return acquisitionRef.current;
    acquiringRef.current = true;
    setAcquiring(true);
    try {
      const node = selectedId ?? 0;
      const samples = sim.getNativeHistory();
      if (samples.length < 1001) {
        throw new Error(text('原生积分记录不足，请等待至少 1 秒。', 'Not enough native integration history yet; wait at least 1 second.'));
      }
      if (!physicalProjectionReady(fixture)) {
        throw new Error(text('所选头部模型尚未准备好，请先返回物理模型页面等待加载。', 'The selected head model is not ready. Open the physical model and wait for it to load.'));
      }
      const projection = capturePhysicalProjection(fixture);
      const first = samples[0];
      const { recording: rawRec, events, t0Ms, sourcePositionMm } = runNativeExperiment({
        sfreqHz: sampleRate,
        projection,
        samples,
        node,
        baselineE: first.e[node],
        baselineI: first.i[node],
        markers: sim.getMarkers(),
        noise: null,
        seed: 1,
      });
      // Reference switch is a lossless re-reference off raw infinity data,
      // never a rebuild of the µV itself (plan §1.6). M1 only exists when the
      // acquired recording carries that channel; otherwise keep average and say so.
      let recording = rawRec;
      if (referenceSel === 'm1' && !rawRec.channels.some((c) => c.label === 'M1')) {
        setReferenceNote(text('当前记录无 M1 通道，参考保持平均。', 'The current recording has no M1 channel; reference stays on average.'));
      } else {
        setReferenceNote(null);
        recording = referenceSel === 'average' && rawRec.reference.mode === 'average'
          ? rawRec
          : reReferenceRecording(rawRec, reference);
      }
      const acquired: Acquisition = {
        recording, events, t0Ms, sourcePositionMm: [...sourcePositionMm],
        acquiredAtTms: sim.getLatest()?.t_ms ?? snap?.t_ms ?? 0,
      };
      acquisitionRef.current = acquired;
      setAcquisition(acquired);
      setAcqError(null);
      if (!recording.channels.some((c) => c.label === selectedChannel)) {
        setSelectedChannel(recording.channels.some((c) => c.label === 'Pz')
          ? 'Pz' : recording.channels[0]?.label ?? 'Pz');
      }
      return acquired;
    } catch (e) {
      setAcqError(String(e));
      return acquisitionRef.current;
    } finally {
      acquiringRef.current = false;
      setAcquiring(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, ready, fixture, sampleRate, referenceSel, selectedId]);

  const assembleBench = useCallback((acq: Acquisition | null) => {
    if (!sim || !acq || !capSelection) return;
    try {
      // Drop protocol trigger events the Worker already ACKed as markers:
      // the native events carry the corrected ACK time and are authoritative.
      const nativeAbs = new Set(acq.events.map((ev) => Math.round(ev.tMs + acq.t0Ms)));
      const extra = extraEventsRef.current.filter((ev) => {
        if (ev.type !== 'pulse') return true;
        for (const t of nativeAbs) if (Math.abs(ev.tMs - t) <= 500) return false;
        return true;
      });
      // 条件合并：被去重的协议脉冲事件只丢时间（Worker ACK 的时间是权威的），
      // 不丢条件标签——协议的 standard/oddball 条件贴到 500 ms 内与之对应的
      // native 脉冲事件上，否则记录里全是 unclassified，ERP 切分永远拿不到
      // 条件。只改未分类事件的条件，不改时间、不改 runId、不改数值。
      const conditionedNativeEvents = acq.events.map((ev) => {
        if (ev.type !== 'pulse' || ev.condition !== 'unclassified') return ev;
        const absT = ev.tMs + acq.t0Ms;
        const match = extraEventsRef.current.find((x) =>
          x.type === 'pulse' && x.condition !== 'unclassified' && Math.abs(x.tMs - absT) <= 500);
        return match ? { ...ev, condition: match.condition } : ev;
      });
      const br = assembleBenchRecording({
        native: {
          recording: acq.recording, events: conditionedNativeEvents,
          t0Ms: acq.t0Ms, sourcePositionMm: acq.sourcePositionMm,
        },
        extraEvents: extra,
        session: getDerivedSession(acq).getSnapshot(),
        protocol: protocolIdRef.current,
        amplifier: amplifierConfig,
        cap: capSelection,
        headModel,
      });
      setLiveRecordingStore(benchRecordingToStoreValue(br));
      setBenchRecording(br);
      setBenchError(null);
    } catch (e) { setBenchError(String(e)); }
  }, [sim, capSelection, amplifierConfig, headModel, getDerivedSession]);

  const refreshAll = useCallback(() => {
    const acq = runAcquisition();
    if (acq) assembleBench(acq);
  }, [runAcquisition, assembleBench]);

  // Re-acquire when the amplifier chain, source node or head model changes.
  const lastAutoRef = useRef(0);
  useEffect(() => {
    if (!engineReady || !fixture || !capSelection) return;
    const now = Date.now();
    if (now - lastAutoRef.current < 500) return;
    lastAutoRef.current = now;
    refreshAll();
  }, [engineReady, fixture, capSelection, refreshAll]);

  // ---------- loop trace ----------
  const traceRef = useRef(createBenchTrace(TRACE_CAP));
  const [traceList, setTraceList] = useState<BenchTraceEvent[]>([]);
  const appendTrace = useCallback((e: Omit<BenchTraceEvent, 'seq'>) => {
    traceRef.current.append(e);
    setTraceList(traceRef.current.list());
  }, []);

  // ---------- protocol engine + simulated subject ----------
  const setProtocolId = (v: BenchProtocolId) => setBenchSettings({ protocolId: v });
  useEffect(() => { protocolIdRef.current = protocolId; }, [protocolId]);
  const [protocolRunning, setProtocolRunning] = useState(false);
  // 协议状态四态的第三个输入（见 benchProtocol.ts protocolStatusKey）：
  // 本协议是否跑过。runProtocol 置真；换协议清零——下拉在运行中禁用，
  // 所以换协议时协议一定不在跑，清零后新协议如实显示“未开始”。
  const [protocolEverStarted, setProtocolEverStarted] = useState(false);
  useEffect(() => { setProtocolEverStarted(false); }, [protocolId]);
  const [trialCount, setTrialCount] = useState(0);
  const [droppedResponses, setDroppedResponses] = useState(0);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const setSubjectSeed = (v: number) => setBenchSettings({ subjectSeed: v });
  const setRtMinMs = (v: number) => setBenchSettings({ rtMinMs: v });
  const setRtMaxMs = (v: number) => setBenchSettings({ rtMaxMs: v });
  const rtRangeValid = rtMinMs >= 50 && rtMaxMs > rtMinMs && rtMaxMs <= 2000;
  // oddball params
  const setOddballStandardAmp = (v: number) => setBenchSettings({ oddballStandardAmp: v });
  const setOddballAmp = (v: number) => setBenchSettings({ oddballAmp: v });
  const setOddballIsiMs = (v: number) => setBenchSettings({ oddballIsiMs: v });
  const setOddballEvery = (v: number) => setBenchSettings({ oddballEvery: v });
  const setOddballDurationMs = (v: number) => setBenchSettings({ oddballDurationMs: v });
  // flicker params
  const setFlickerFreqHz = (v: number) => setBenchSettings({ flickerFreqHz: v });
  const setFlickerAmp = (v: number) => setBenchSettings({ flickerAmp: v });
  const setFlickerDurationMs = (v: number) => setBenchSettings({ flickerDurationMs: v });
  // closed-loop params
  const setClFeature = (v: BenchClosedLoopFeature) => setBenchSettings({ clFeature: v });
  const setClThreshold = (v: number) => setBenchSettings({ clThreshold: v });
  const setClAmplitude = (v: number) => setBenchSettings({ clAmplitude: v });
  const setClDurationMs = (v: number) => setBenchSettings({ clDurationMs: v });
  const setClPeriodMs = (v: number) => setBenchSettings({ clPeriodMs: v });
  const setClCooldownMs = (v: number) => setBenchSettings({ clCooldownMs: v });
  const setClMaxTriggers = (v: number) => setBenchSettings({ clMaxTriggers: v });

  const engineRef = useRef<BenchProtocolEngine | null>(null);
  const [lastStimulusTms, setLastStimulusTms] = useState<number | null>(null);
  const trialCountRef = useRef(0);

  const handleProtocolEvent = useCallback((e: BenchProtocolEvent) => {
    if (e.kind === 'protocol-started') {
      setProtocolRunning(true);
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'protocol-started',
        label: text('协议开始', 'Protocol started'), value: protocolIdRef.current, confirmed: false });
    } else if (e.kind === 'protocol-stopped') {
      setProtocolRunning(false);
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'protocol-stopped',
        label: text('协议停止', 'Protocol stopped'), value: e.reason ?? '', confirmed: false });
    } else if (e.kind === 'stimulus-sent') {
      setLastStimulusTms(e.tMs);
      // 2026-11-19 修：协议刺激也是真实的刺激器命令，进命令日志——
      // 之前日志只在手动 sendPulse 里记，跑 81 次 oddball 也还是
      // “暂无命令”。dispatchTms/marker 随事件来（见 benchProtocol），
      // ACK 匹配走下面轮询里的引用路径，与手动刺激同一套逻辑。
      setStimLog((prev) => [...prev.slice(-19), {
        key: stimKeyRef.current++, node: e.node ?? 0,
        amplitude: e.amplitude ?? 1, durationMs: e.durationMs ?? 100,
        dispatchTms: e.dispatchTms ?? e.tMs, ackTms: null, confirmed: false,
        marker: e.marker,
      }]);
      extraEventsRef.current.push({
        id: extraIdRef.current++, type: 'pulse',
        condition: e.condition ?? 'unclassified', tMs: e.tMs,
        drive: e.amplitude ?? 1, driveUnit: 'wc',
      });
      const v = `${text('脑区', 'node')} ${e.node ?? '—'} · ${fmt(e.amplitude, 2)} · ${e.durationMs ?? '—'} ms`;
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'trigger',
        label: text('trigger 发出', 'Trigger sent'), value: v, confirmed: false });
      appendTrace({ tMs: e.tMs, hop: 'stimulator', kind: 'command',
        label: text('刺激命令已发送', 'Stimulus command sent'), value: v, confirmed: false });
    } else if (e.kind === 'response') {
      const rt = e.rtMs ?? 0;
      const stimulusTms = e.tMs - rt;
      setResponses((prev) => [...prev.slice(-49), {
        trialIndex: e.trialIndex ?? trialCountRef.current,
        stimulusTms, responseTms: e.tMs, rtMs: rt, key: 'Space',
        confirmed: e.confirmed ?? false,
      }]);
      extraEventsRef.current.push({
        id: extraIdRef.current++, type: 'response', condition: 'unclassified',
        tMs: e.tMs, drive: rt, driveUnit: 'ms',
      });
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'response',
        label: text('受试者按键 Space', 'Subject pressed Space'),
        value: `RT ${fmt(rt, 0)} ms`, confirmed: e.confirmed ?? false });
      // The simulated hand presses on the response (design §3).
      setHandPressing(true);
      if (handTimer.current !== null) window.clearTimeout(handTimer.current);
      handTimer.current = window.setTimeout(() => setHandPressing(false), 250);
    } else if (e.kind === 'feedback-detected') {
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'feedback-detected',
        label: text('闭环特征检出', 'Closed-loop feature detected'),
        value: `${text('脑区', 'node')} ${e.node ?? '—'}`, confirmed: true });
    } else if (e.kind === 'feedback-applied') {
      // 2026-11-19 修：闭环刺激由 Worker 施加、没有客户端 dispatch，
      // 但它仍是真实的刺激器命令，进命令日志；applied 上报本身就是
      // Worker 的确认（施加时刻 applyMs 即 Worker 时间），所以直接记
      // 已确认，不走轮询的 marker 匹配。
      setStimLog((prev) => [...prev.slice(-19), {
        key: stimKeyRef.current++, node: e.node ?? 0,
        amplitude: e.amplitude ?? 1, durationMs: e.durationMs ?? 100,
        dispatchTms: e.applyMs ?? e.tMs, ackTms: e.applyMs ?? e.tMs,
        confirmed: true,
      }]);
      appendTrace({ tMs: e.tMs, hop: 'stimulator', kind: 'feedback-applied',
        label: text('闭环刺激已施加', 'Closed-loop stimulus applied'),
        value: `${text('脑区', 'node')} ${e.node ?? '—'} · ${fmt(e.amplitude, 2)}`, confirmed: true });
    } else if (e.kind === 'trial-skipped') {
      // Phase 3 去重：一次 tick 只发最新到期的一个试次，其余记为跳过并可见。
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'trial-skipped',
        label: text('试次跳过（去重）', 'Trials skipped (dedupe)'),
        value: `${text('跳过', 'skipped')} ${e.skippedCount ?? 0} ${text('个试次，仅发最新一个', 'trials; fired latest only')}`,
        confirmed: false });
    } else if (e.kind === 'feedback-suppressed') {
      // Phase 3 冷却抑制：Worker 侧规则触发但处于冷却期，抑制可见、不静默。
      appendTrace({ tMs: e.tMs, hop: 'experiment-computer', kind: 'feedback-suppressed',
        label: text('闭环触发被冷却抑制', 'Closed-loop trigger suppressed by cooldown'),
        value: `#${e.suppressedCount ?? '—'} · ${text('特征值', 'value')} ${fmt(e.suppressedValue, 2)}`,
        confirmed: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendTrace]);

  useEffect(() => {
    if (!sim || !ready) { engineRef.current = null; setProtocolRunning(false); return; }
    const subject = createSimulatedSubject({
      seed: subjectSeed,
      ...(rtRangeValid ? { rtMinMs, rtMaxMs } : {}),
    });
    const engine = createBenchProtocolEngine({
      pulseAt: (node, amplitude, durationMs) => sim.pulseAt(node, amplitude, durationMs),
      // simClient's public method is configureNativeFeedback (no setNativeFeedback).
      configureFeedback: (config) => sim.configureNativeFeedback(config),
      subject,
      onEvent: handleProtocolEvent,
      // Lets the engine resolve default sensory nodes when a protocol omits them.
      regions: data?.regions,
    });
    engineRef.current = engine;
    return () => { engine.stop(); engineRef.current = null; };
  }, [sim, ready, data, subjectSeed, rtMinMs, rtMaxMs, rtRangeValid, handleProtocolEvent]);

  // Worker feedback messages -> engine feedback events (plan §2: via emitFeedbackEvent).
  // Phase 3: detected/applied 携带 action id 与两个 Worker 时间戳，引擎按 id
  // 配对实测 trigger→command；applied 另带收到时客户端最新快照 tMs，算
  // observation lag；'suppressed' 是 Worker 上报的冷却抑制（见 nativeFeedback）。
  useEffect(() => {
    if (!sim || !ready) return;
    return sim.subscribeNativeFeedback((msg) => {
      const engine = engineRef.current;
      if (!engine) return;
      if (msg.phase === 'detected') {
        engine.emitFeedbackEvent({
          kind: 'feedback-detected', tMs: msg.t_ms,
          node: msg.action?.node, amplitude: msg.action?.amplitude,
          durationMs: msg.action?.durationMs, confirmed: true,
          actionId: msg.action?.id, detectedMs: msg.action?.detectedMs,
        });
      } else if (msg.phase === 'applied') {
        engine.emitFeedbackEvent({
          kind: 'feedback-applied', tMs: msg.t_ms,
          node: msg.action?.node, amplitude: msg.action?.amplitude,
          durationMs: msg.action?.durationMs, confirmed: true,
          actionId: msg.action?.id, detectedMs: msg.action?.detectedMs,
          applyMs: msg.action?.applyMs, observedAtTms: sim.getLatest()?.t_ms,
        });
      } else if (msg.phase === 'suppressed') {
        engine.emitFeedbackEvent({
          kind: 'feedback-suppressed', tMs: msg.t_ms,
          node: msg.state?.config.node, confirmed: true,
          suppressedCount: msg.state?.suppressedCount,
          suppressedValue: msg.state?.lastSuppressedValue ?? undefined,
        });
      } else if (msg.phase === 'configured' || msg.phase === 'stopped') {
        appendTrace({ tMs: msg.t_ms, hop: 'experiment-computer',
          kind: msg.phase === 'configured' ? 'feedback-configured' : 'feedback-stopped',
          label: msg.phase === 'configured'
            ? text('闭环控制器已配置', 'Closed-loop controller configured')
            : text('闭环控制器已停止', 'Closed-loop controller stopped'),
          value: '', confirmed: true });
      }
    });
  }, [sim, ready, appendTrace, text]);

  // ---------- stimulator box ----------
  const setStimTarget = (v: number | null) => setBenchSettings({ stimTarget: v });
  const stimNode = stimTarget ?? selectedId ?? 0;
  const [stimLog, setStimLog] = useState<StimLogEntry[]>([]);
  const stimKeyRef = useRef(0);
  const sendPulse = useCallback(() => {
    if (!sim || !ready) return;
    const dispatchTms = sim.getLatest()?.t_ms ?? snap?.t_ms ?? 0;
    const marker = sim.pulseAt(stimNode, strength, durationMs);
    const key = stimKeyRef.current++;
    setStimLog((prev) => [...prev.slice(-19), {
      key, node: stimNode, amplitude: strength, durationMs,
      dispatchTms, ackTms: null, confirmed: false, marker,
    }]);
    appendTrace({ tMs: dispatchTms, hop: 'stimulator', kind: 'command',
      label: text('手动刺激已发送', 'Manual stimulus sent'),
      value: `${text('脑区', 'node')} ${stimNode} · ${fmt(strength, 2)} · ${durationMs} ms`,
      confirmed: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, ready, stimNode, strength, durationMs, appendTrace]);

  // ---------- Phase 3：协议引擎由 Worker 时钟驱动，不再由前端定时器驱动 ----------
  // 每条 Worker 快照（App.tsx 经 sim.subscribe 推进 snap prop，约 60 Hz）
  // 恰好是一次 engine.tick(snap.t_ms) + confirmFromMarkers：试次 firing 与
  // 响应锚定都发生在 Worker 的模型时间上。React 批量更新可能合并快照
  // （两次 effect 之间跳过一个快照），引擎的去重保证这时只发最新到期的
  // 一个试次、其余记为跳过，永不突发连发。前端定时器不再决定任何刺激时序。
  // Phase 4 — 顺序：先 confirm、后 tick。同一批快照里已到的修正 marker
  // 必须先被消费，否则 tick 先算逾期、已在手里的 ACK 就输给期限。
  useEffect(() => {
    if (!sim || !ready || !snap) return;
    const engine = engineRef.current;
    if (!engine) return;
    engine.confirmFromMarkers(sim.getMarkers());
    engine.tick(snap.t_ms);
  }, [sim, ready, snap]);

  // ---------- 250 ms 轮询：只做观测/记账，不决定刺激时序 ----------
  // Phase 3：试次 firing 与响应锚定已移到 Worker 快照驱动（见上方快照 effect）。
  // 这个定时器只做读数同步（试次数/丢弃响应/运行态）、手动刺激的 ACK 匹配、
  // 新 marker 记入放大器事件流（回路追踪）、采集重试。它不调用 engine.tick、
  // 不发任何刺激——前端只显示，永不决定时序。
  const snapRef = useRef(snap);
  useEffect(() => { snapRef.current = snap; }, [snap]);
  const seenMarkerCountRef = useRef(0);
  const lastAcquireAttemptRef = useRef(0);
  // Live-refresh during runs: wall-clock ms of the last in-run refresh, and
  // whether the protocol was running on the previous tick (to catch the
  // stop transition). The recording assembled once at engine-ready goes
  // stale mid-run (样本数/波形/事件数 freeze); see the interval below.
  const lastLiveRefreshRef = useRef(0);
  const wasProtocolRunningRef = useRef(false);
  useEffect(() => {
    if (!sim || !ready) return;
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (engine) {
        trialCountRef.current = engine.trialIndex;
        setTrialCount(engine.trialIndex);
        setProtocolRunning(engine.running);
        setDroppedResponses(engine.droppedResponses);
        // Live-refresh while a protocol runs: re-acquire every 5 s so the
        // bench display (样本数, live waveform, 事件数) tracks the run,
        // and once on the stop transition so the final state is captured.
        // runAcquisition's <1001-sample guard and the 10 s native-history
        // cap are unchanged: a refresh only ever sees the last 10 s.
        // Re-assembly is the same work as the manual "更新记录" button,
        // only automatic; the derived session is reused per upstream runId.
        const running = engine.running;
        if (running && acquisitionRef.current && fixture && capSelection) {
          const now = Date.now();
          if (now - lastLiveRefreshRef.current >= 5000) {
            lastLiveRefreshRef.current = now;
            refreshAll();
          }
        }
        if (wasProtocolRunningRef.current && !running) {
          refreshAll();
        }
        wasProtocolRunningRef.current = running;
      }
      // Match stimulator commands to Worker-corrected markers (ACK time).
      // Phase 4 — 只认修正过的 marker（见 findAckMarker）：provisional
      // marker 的 t_ms 仍等于点击时的快照时间，认它就等于点击后第一次轮询
      // 就“确认”，ackTms 还是点击时间，与“ACK 时间以 Worker 为准”矛盾。
      // 2026-11-19 修：带 marker 引用的条目（手动 + 全部协议刺激）凭
      // 引用确认——与引擎 confirmFromMarkers 同一套机制，不会套住邻试
      // 次的 marker（flicker 100 ms 一发时窗口匹配会错认）；没有 marker
      // 的条目（假 pulseAt 不返回值）才回退到窗口匹配。
      const markers = sim.getMarkers();
      setStimLog((prev) => {
        if (!prev.some((e) => !e.confirmed)) return prev;
        let changed = false;
        const next = prev.map((e) => {
          if (e.confirmed) return e;
          if (e.marker) {
            if (markers.includes(e.marker) && e.marker.t_ms !== e.dispatchTms) {
              changed = true;
              return { ...e, ackTms: e.marker.t_ms, confirmed: true };
            }
            return e;
          }
          const m = findAckMarker(markers, e.node, e.dispatchTms);
          if (m) { changed = true; return { ...e, ackTms: m.t_ms, confirmed: true }; }
          return e;
        });
        return changed ? next : prev;
      });
      // Trigger hop: every new Worker marker enters the amplifier event stream.
      if (markers.length < seenMarkerCountRef.current) seenMarkerCountRef.current = 0;
      if (markers.length > seenMarkerCountRef.current) {
        const fresh = markers.slice(seenMarkerCountRef.current);
        seenMarkerCountRef.current = markers.length;
        const acq = acquisitionRef.current;
        for (const m of fresh) {
          if (m.kind !== 'pulse') continue;
          const sampleIndex = acq
            ? Math.round((m.t_ms - acq.t0Ms) * sampleRate / 1000)
            : null;
          appendTrace({ tMs: m.t_ms, hop: 'amplifier', kind: 'trigger',
            label: text('trigger 记入事件流', 'Trigger logged to event stream'),
            value: `${text('脑区', 'node')} ${m.node} · ${text('采样点', 'sample')} ${sampleIndex ?? '—'}`,
            confirmed: true });
        }
      }
      // Retry acquisition once native history is long enough.
      if (!acquisitionRef.current && fixture && capSelection) {
        const now = Date.now();
        if (now - lastAcquireAttemptRef.current >= 1000) {
          lastAcquireAttemptRef.current = now;
          refreshAll();
        }
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [sim, ready, fixture, capSelection, sampleRate, refreshAll, appendTrace, text]);

  // ---------- displayed (amplified) trace: band-pass + gain, display only ----------
  const [displayedSeries, setDisplayedSeries] = useState<number[] | null>(null);
  const [displayError, setDisplayError] = useState<string | null>(null);
  useEffect(() => {
    if (!acquisition) { setDisplayedSeries(null); return; }
    const rec = acquisition.recording;
    const idx = rec.channels.findIndex((c) => c.label === selectedChannel);
    if (idx < 0) { setDisplayedSeries(null); return; }
    try {
      let series = [...rec.dataUv[idx]];
      if (bandpassOn) {
        validateBandpassParams({ lowHz, highHz, sfreqHz: rec.sfreqHz });
        series = bandpassFilter(series, { lowHz, highHz, sfreqHz: rec.sfreqHz });
      }
      if (gain !== 1) series = series.map((v) => v * gain);
      setDisplayedSeries(series);
      setDisplayError(null);
    } catch (e) {
      setDisplayedSeries([...rec.dataUv[idx]].map((v) => v * gain));
      setDisplayError(String(e));
    }
  }, [acquisition, selectedChannel, bandpassOn, lowHz, highHz, gain]);
  const latestUv = displayedSeries?.at(-1) ?? null;
  const rmsUv = displayedSeries ? rms(displayedSeries) : null;
  const waveSeries = useMemo(() => {
    if (!displayedSeries || !acquisition) return null;
    const n = Math.min(displayedSeries.length, Math.round(WAVE_WINDOW_MS / 1000 * acquisition.recording.sfreqHz));
    return displayedSeries.slice(-n);
  }, [displayedSeries, acquisition]);

  // ---------- waveform canvas (last 5 s, selected channel) ----------
  // Shared drawWaveform helper (benchWaveform.ts) — the test-computer
  // drill-down canvas and the recording-PC thumbnail in PictorialLoop
  // draw the same series through it. `drill` is a dep so the canvas
  // redraws when the drill-down opens (its <canvas> remounts).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveSeries || !acquisition) return;
    drawWaveform(canvas, waveSeries);
  }, [waveSeries, acquisition, drill]);

  // ---------- protocol run / stop (a second run layer, distinct from global pause) ----------
  const auditoryNodes = useMemo(
    () => (data ? sensoryTargetNodes(data.regions, 'auditory') : []), [data]);
  const visualNodes = useMemo(
    () => (data ? sensoryTargetNodes(data.regions, 'visual') : []), [data]);
  const protocolParams = useMemo((): BenchProtocolParams[BenchProtocolId] => {
    if (protocolId === 'single-pulse') {
      return { node: stimNode, amplitude: strength, durationMs };
    }
    if (protocolId === 'oddball') {
      return {
        node: auditoryNodes[0] ?? stimNode,
        standardAmplitude: oddballStandardAmp, oddballAmplitude: oddballAmp,
        isiMs: oddballIsiMs, oddballEvery, pulseDurationMs: oddballDurationMs,
      };
    }
    if (protocolId === 'flicker') {
      return {
        nodes: visualNodes.length ? visualNodes : [stimNode],
        frequencyHz: flickerFreqHz, amplitude: flickerAmp, pulseDurationMs: flickerDurationMs,
      };
    }
    const config: NativeFeedbackConfig = {
      node: stimNode, feature: clFeature, threshold: clThreshold,
      amplitude: clAmplitude, durationMs: clDurationMs,
      periodMs: clPeriodMs, windowMs: 1000, cooldownMs: clCooldownMs,
      delayMs: 0, maxTriggers: clMaxTriggers,
    };
    return config;
  }, [protocolId, stimNode, strength, durationMs, auditoryNodes, visualNodes,
    oddballStandardAmp, oddballAmp, oddballIsiMs, oddballEvery, oddballDurationMs,
    flickerFreqHz, flickerAmp, flickerDurationMs,
    clFeature, clThreshold, clAmplitude, clDurationMs, clPeriodMs, clCooldownMs, clMaxTriggers]);

  const runProtocol = useCallback(() => {
    const engine = engineRef.current;
    const startTms = sim?.getLatest()?.t_ms ?? snapRef.current?.t_ms ?? 0;
    if (!engine || !sim || !ready) return;
    extraEventsRef.current = [];
    setResponses([]);
    engine.start(protocolId, protocolParams, startTms);
    setProtocolEverStarted(true);
    setProtocolRunning(engine.running);
  }, [sim, ready, protocolId, protocolParams]);
  const stopProtocol = useCallback(() => {
    engineRef.current?.stop();
    setProtocolRunning(false);
  }, []);

  const nextStimulusTms = useMemo(() => {
    if (!protocolRunning || lastStimulusTms === null) return null;
    if (protocolId === 'oddball') return lastStimulusTms + oddballIsiMs;
    if (protocolId === 'flicker') return lastStimulusTms + 1000 / flickerFreqHz;
    return null;
  }, [protocolRunning, protocolId, oddballIsiMs, flickerFreqHz, lastStimulusTms]);

  // ---------- export ----------
  const exportRecording = useCallback((kind: 'json' | 'csv') => {
    const rec = benchRecording?.recording ?? acquisition?.recording;
    if (!rec) return;
    const short = shortRunId(benchRecording?.runId ?? runId);
    download(`bench-${short}.${kind}`,
      kind === 'json' ? recordingToJson(rec) : recordingToCsv(rec),
      kind === 'json' ? 'application/json' : 'text/csv');
  }, [benchRecording, acquisition, runId]);

  const selectedRegion = data?.regions.find((r) => r.id === selectedId) ?? null;
  const channelOptions = useMemo(() => {
    const recChannels = acquisition?.recording.channels.map((c) => c.label) ?? [];
    const inCap = recChannels.filter((l) => capLabels.includes(l));
    return inCap.length ? inCap : recChannels;
  }, [acquisition, capLabels]);
  const lastStim = stimLog.at(-1) ?? null;
  const totalSamples = acquisition?.recording.timesMs.length ?? 0;
  const totalEvents = benchRecording?.events.length ?? acquisition?.events.length ?? 0;

  // Phase 3 — 控制条上的闭环时延小读数（设计 §2d：只在控制条露一个小实时读数，不另开面板）。
  // 每快照重渲染时从引擎与最新 native_feedback 消息现读；只在闭环协议运行中、且至少一个
  // 实测值已到时才显示这一行，其余时间整行不渲染（2026-11-19 修：不再挂 "—"）。
  // trigger→command 与 observation lag 取自 getLoopTiming()，
  // 冷却剩余取自 NativeFeedback 快照；dispatch→ACK 只在开环分发路径上测到，闭环里恒为 null，故不放进这一行。
  const loopTiming = engineRef.current?.getLoopTiming() ?? null;
  const feedbackState = sim?.getNativeFeedback()?.state ?? null;
  const cooldownRemaining = feedbackState ? cooldownRemainingMs(feedbackState, snap?.t_ms ?? 0) : 0;
  // 2026-11-19 修：没有真值就不渲染这一行（而不是挂一个 "—"）——
  // trigger→command 与 observation lag 都是实测值，只在闭环协议跑出
  // 第一个反馈动作后才有；跑之前这行根本不存在。底层测量
  // getLoopTiming() 不动。
  const loopTimingText = protocolId === 'closed-loop' && protocolRunning
    && (loopTiming?.triggerToCommandMs != null
      || loopTiming?.observationLagMs != null)
    ? `${text('触发→命令', 'trigger→command')} ${fmt(loopTiming?.triggerToCommandMs, 0)} ms · ${text('观测滞后', 'observation lag')} ${fmt(loopTiming?.observationLagMs, 0)} ms · ${text('冷却中', 'cooldown')} ${(cooldownRemaining / 1000).toFixed(1)} s`
    : null;

  // 协议状态文案：三处（回路角色行、实验电脑折叠标题、细节读数）共用同一份
  // 派生，见 benchProtocol.ts protocolStatusKey——停过的协议显示“已停止”，
  // 不再误标“已暂停”；运行中全局暂停才显示“已暂停”。
  const protocolStatus = protocolStatusKey(protocolRunning, paused, protocolEverStarted);
  // 主视图唯一的状态行：整句人话，不是状态码。运行中才点协议名，其余
  // 四态各是一句完整的话（未开始 / 已暂停 / 已停止 / 引擎启动中）。
  // 派生仍是 benchProtocol.ts protocolStatusKey 一处（四态：未开始 /
  // 运行中 / 已暂停（运行中 + 全局暂停）/ 已停止（停过））。
  const statusText = !engineReady ? t('bench.status.notReady')
    : protocolStatus === 'running'
      ? `${t('bench.status.running')} ${t(`bench.protocol.${protocolId}`)}${t('bench.status.runningAfter')}`
      : protocolStatus === 'paused' ? t('bench.status.paused')
      : protocolStatus === 'stopped' ? t('bench.status.stopped')
      : t('bench.status.notStarted');

  // q 跟的脑区与 App.tsx 同款口径（点选 ?? 刺激器目标 ?? 0 号），显示时
  // 用同一份 qNode 取标签，两边不会各说各话。
  const qNode = selectedId ?? stimTarget ?? 0;
  const qRegion = data?.regions.find((r) => r.id === qNode) ?? null;
  // 高状态说明（2026-11-19 stuck-q）：网络翻进高活动态后 q 会停在一个
  // 数上不动——那是真实的高稳态，不是卡住了。信号直接用 Worker 自己的
  // 锁定闩（lib/benchHighState.ts），阈值是引擎的 0.15，不是现编的。
  // 说明只在 q 读数有真值时才出现，并把已有的重置（onReset）放到同一
  // 处，点了就能回到安静状态；诊断面板里的重置按钮原样不动。
  const qHighState = liveMomentNAm !== null && isBenchQHighState(snap, qNode);

  // ---------- test-computer views: live waveform + recording analysis ----------
  // The six old analysis tabs are two views of the ONE shared bench recording:
  // (a) the live waveform, (b) this analysis view (ERP / TFR / topo / source /
  // spectrum). Epochs come from the assembled bench recording; a manual
  // re-epoch via ErpTab replaces only the epochs, never the recording.
  // 'independent-late' is refused on purpose: the late-mechanism oddball run
  // is a separate independent model experiment, and the bench keeps one shared
  // recording — ErpTab shows the refusal as its error line.
  // 简化（2026-11-19）：波形常驻主视图，分析常驻诊断面板，不再用视图切换
  // 在两者之间翻页；testView 状态随之删除。
  const [analysisTab, setAnalysisTab] = useState<'erp' | 'tfr' | 'topo' | 'inverse' | 'waves'>('erp');
  const [epochsOverride, setEpochsOverride] = useState<EpochSet | null>(null);
  const [atTimeMs, setAtTimeMs] = useState(400);
  useEffect(() => { setEpochsOverride(null); }, [benchRecording]);
  const analysisRecording = benchRecording?.recording ?? acquisition?.recording ?? null;
  const analysisEvents = benchRecording?.events ?? acquisition?.events ?? [];
  const epochs = epochsOverride ?? benchRecording?.epochs ?? null;
  useEffect(() => {
    if (analysisRecording) setAtTimeMs((prev) => Math.max(analysisRecording.timesMs[0], Math.min(analysisRecording.timesMs.at(-1) ?? 0, prev)));
  }, [analysisRecording]);
  const handleBenchEpochsChange = useCallback((ep: EpochSet, origin: 'raw' | 'independent-late') => {
    if (origin === 'independent-late') {
      throw new Error(text('台子只用一份共享记录：late 机制 oddball 是独立模型实验，不进入台子记录；请用当前记录切分试次。', 'The bench keeps one shared recording: the late-mechanism oddball run is an independent model experiment and does not enter the bench recording; epoch the current recording instead.'));
    }
    setEpochsOverride(ep);
  }, [text]);
  // ---------- loop flow: which ring the signal is in now + last few hops ----------
  // The trace list is the same benchTrace function; only its presentation
  // changed — a flow indicator, not a 200-row log table.
  const flowHops = traceList.slice(-5);
  const flowNow = traceList.at(-1) ?? null;
  // q line: ONE derivation, shown in the head-node chip (PictorialLoop,
  // testid bench-brain-q) and again in the brain drill-down (distinct
  // testid bench-brain-q-drilldown — two elements must not share a testid).
  const qText = liveMomentNAm !== null
    ? `${t('bench.qLabel')} = ${fmt(liveMomentNAm, 3)} nA·m${qRegion ? ` · ${qRegion.label} #${qRegion.id}` : ` · #${qNode}`}`
    : null;
  const composerSummaryFull = summarizeCombination(composerState, locale);

  return (
    <div className="bench" data-testid="closed-loop-bench">
      {/* Slim top bar: title + the workspace actions (were in the diagnostics
          panel; the panel is deleted, so they live here now). */}
      <header className="bench-header bench-header-slim">
        <div>
          <h1>{t('bench.title')}</h1>
          <p className="bench-subtitle">{t('bench.subtitle')}</p>
        </div>
        <div className="bench-header-actions">
          <LanguageSwitch />
          <button className="ui-button" type="button" onClick={onExitToPhysicsHome}>
            {t('bench.backToPhysics')}
          </button>
          <button className="ui-button" type="button" onClick={onPause}
            disabled={!engineReady} title={!engineReady ? notReadyReason : undefined}>
            {paused ? t('shell.resume') : t('shell.pause')}
          </button>
          <button className="ui-button" type="button" onClick={handleResetAll}
            disabled={!engineReady} title={!engineReady ? notReadyReason : undefined}>
            {t('shell.reset')}
          </button>
          <button className="ui-button" type="button" onClick={onRecover}
            disabled={!engineReady} title={!engineReady ? notReadyReason : undefined}>
            {text('恢复快照', 'Restore snapshot')}
          </button>
        </div>
      </header>
      {error && <p className="bench-error" role="alert">{error}</p>}
      {!engineReady && (
        <p className="bench-error" role="status">
          {t('bench.notReady')}{text('：引擎启动后，全部控件可用。', ': all controls become available once the engine starts.')}
        </p>
      )}

      {/* The picture: one big closed-loop diagram + control bar + status. */}
      <PictorialLoop
        headView={networkView}
        flowNow={flowNow}
        protocolRunning={protocolRunning}
        qText={qText}
        qHigh={qHighState}
        onQReset={handleResetAll}
        subjectSummary={composerSummary}
        waveSeries={waveSeries}
        selectedChannel={selectedChannel}
        protocolId={protocolId}
        onProtocolSelect={setProtocolId}
        engineReady={engineReady}
        notReadyReason={notReadyReason}
        onRun={runProtocol}
        onStop={stopProtocol}
        statusText={statusText}
        onOpenNode={openNode}
        handPressing={handPressing}
        footerText={t('bench.footer')}
      />

      {/* ================= drill-downs ================= */}
      {drill === 'brain' && (
        <BenchDrillDown title={t('bench.brain')} drill="brain" onClose={() => setDrill(null)}>
          {qText !== null && (
            <p className="bench-q" data-testid="bench-brain-q-drilldown">{qText}</p>
          )}
          {qHighState && (
            <p className="bench-q-high" data-testid="bench-q-high-state-drilldown">
              {t('bench.qHighState')}{' '}
              <button type="button" className="ui-button" onClick={handleResetAll}
                disabled={!engineReady} title={!engineReady ? notReadyReason : undefined}>
                {t('bench.qHighStateReset')}
              </button>
            </p>
          )}
          <p className="bench-note">{t('bench.drill.brainNote')}</p>
          <p className="bench-note">
            {selectedRegion
              ? `${selectedRegion.label} #${selectedRegion.id} · ${text('已选脑区', 'selected region')}`
              : text('尚未选择脑区。', 'No region selected yet.')}
          </p>
          <h3>{t('bench.drill.manualStim')}</h3>
          <p className="bench-note">{t('bench.drill.manualStimNote')}</p>
          <button className="ui-button ui-button-primary" type="button"
            onClick={sendPulse} disabled={!engineReady}
            title={!engineReady ? notReadyReason : undefined}>
            {t('bench.sendPulse')}
          </button>
          <p className="bench-note">
            {text('目标、幅度与时长在刺激器里调；这里只发送一次。',
              'Target, amplitude and duration are set in the stimulator; this only sends one stimulus.')}
          </p>
        </BenchDrillDown>
      )}

      {drill === 'cap' && (
        <BenchDrillDown title={t('bench.cap')} drill="cap" onClose={() => setDrill(null)}>
          <ControlField label={text('脑电帽预设', 'Cap preset')}
            hint={fixtureError ?? capError ?? undefined}>
            <Dropdown value={capPreset} disabled={!fixture || !engineReady || headModel === 'bem'}
              title={headModel === 'bem'
                ? text('模板 BEM 使用自带电极，帽预设仅适用于球形头模型。', 'The template BEM brings its own electrodes; the cap preset applies to the sphere head model only.')
                : !fixture ? text('头模型资源未加载', 'Head-model asset not loaded') : !engineReady ? notReadyReason : undefined}
              onChange={(e) => setCapPreset(e.target.value as BenchCapPreset)}
              aria-label={text('脑电帽预设', 'Cap preset')}>
              {BENCH_CAP_PRESETS.map((p) => (
                <option key={p.preset} value={p.preset}>
                  {locale === 'zh-CN' ? p.labelZh : p.labelEn}
                </option>
              ))}
            </Dropdown>
          </ControlField>
          <ControlField label={text('头模型', 'Head model')}>
            <Dropdown value={headModel}
              onChange={(e) => setHeadModelSelection(e.target.value as 'sphere' | 'bem')}
              aria-label={text('头模型', 'Head model')}>
              <option value="sphere">{text('球形', 'Sphere')}</option>
              <option value="bem">{text('模板 BEM', 'Template BEM')}</option>
            </Dropdown>
          </ControlField>
          {headModel === 'bem' ? (
            <p className="bench-note">{text('模板 BEM 使用自带电极，帽预设仅适用于球形头模型。', 'The template BEM brings its own electrodes; the cap preset applies to the sphere head model only.')}</p>
          ) : capSelection && (
            <p className="bench-note">
              {capSelection.montage} · {capSelection.channelCount} {text('通道', 'channels')} · {text('含 Cz', 'includes Cz')}: {capLabels.includes('Cz') ? text('是', 'yes') : text('否', 'no')}
            </p>
          )}
          <p className="bench-note">
            {text('电极位置为头模型方向示意，未与演示网络解剖配准。',
              'Electrode positions are a head-model direction sketch, not anatomically registered to the demo network.')}
          </p>
          <h3>{text('通道', 'Channels')}</h3>
          <div className="bench-channel-grid">
            {capLabels.map((label) => (
              <button key={label} type="button"
                className={`chip chip-small${selectedChannel === label ? ' chip-on' : ''}`}
                aria-pressed={selectedChannel === label}
                onClick={() => setSelectedChannel(label)}>
                {label}
              </button>
            ))}
            {capLabels.length === 0 && (
              <span className="bench-note">{text('脑电帽电极尚未加载。', 'Cap electrodes not loaded yet.')}</span>
            )}
          </div>
        </BenchDrillDown>
      )}

      {drill === 'experiment' && (
        <BenchDrillDown title={t('bench.experimentComputer')} drill="experiment" onClose={() => setDrill(null)}>
          <h3>{t('bench.drill.step1')}</h3>
          <p className="bench-note">
            {t(`bench.protocol.${protocolId}`)} · {t(`bench.protocolDesc.${protocolId}`)}
          </p>
          {protocolId === 'oddball' && (
            <>
              <RangeControl label={text('标准刺激幅度', 'Standard amplitude')} unit=""
                value={oddballStandardAmp} min={0.5} max={2} step={0.1}
                disabled={!engineReady || protocolRunning} onChange={setOddballStandardAmp} />
              <RangeControl label={text('oddball 幅度', 'Oddball amplitude')} unit=""
                value={oddballAmp} min={0.5} max={2} step={0.1}
                disabled={!engineReady || protocolRunning} onChange={setOddballAmp} />
              <RangeControl label={text('试次间隔 ISI', 'Inter-stimulus interval')} unit="ms"
                value={oddballIsiMs} min={200} max={5000} step={50}
                disabled={!engineReady || protocolRunning} onChange={setOddballIsiMs} />
              <RangeControl label={text('每 N 个试次出一个 oddball', 'Oddball every N trials')} unit=""
                value={oddballEvery} min={2} max={10} step={1}
                disabled={!engineReady || protocolRunning} onChange={setOddballEvery} />
              <RangeControl label={text('刺激时长', 'Stimulus duration')} unit="ms"
                value={oddballDurationMs} min={20} max={500} step={10}
                disabled={!engineReady || protocolRunning} onChange={setOddballDurationMs} />
              <p className="bench-note">
                {text('听觉节点', 'Auditory nodes')}: {auditoryNodes.length
                  ? auditoryNodes.map((n) => data?.regions[n]?.label ?? String(n)).join(', ')
                  : text('未找到（检查脑区数据）', 'not found (check region data)')}
              </p>
            </>
          )}
          {protocolId === 'flicker' && (
            <>
              <RangeControl label={text('闪烁频率', 'Flicker frequency')} unit="Hz"
                value={flickerFreqHz} min={1} max={30} step={0.5}
                disabled={!engineReady || protocolRunning} onChange={setFlickerFreqHz} />
              <RangeControl label={text('幅度', 'Amplitude')} unit=""
                value={flickerAmp} min={0.5} max={2} step={0.1}
                disabled={!engineReady || protocolRunning} onChange={setFlickerAmp} />
              <RangeControl label={text('刺激时长', 'Stimulus duration')} unit="ms"
                value={flickerDurationMs} min={20} max={500} step={10}
                disabled={!engineReady || protocolRunning} onChange={setFlickerDurationMs} />
              <p className="bench-note">
                {text('视觉节点', 'Visual nodes')}: {visualNodes.length
                  ? visualNodes.map((n) => data?.regions[n]?.label ?? String(n)).join(', ')
                  : text('未找到（检查脑区数据）', 'not found (check region data)')}
              </p>
            </>
          )}
          {protocolId === 'closed-loop' && (
            <>
              <ControlField label={text('特征', 'Feature')}>
                <Dropdown value={clFeature} disabled={!engineReady || protocolRunning}
                  onChange={(e) => setClFeature(e.target.value as 'instant' | 'rms')}
                  aria-label={text('特征', 'Feature')}>
                  <option value="instant">{text('瞬时值', 'Instant value')}</option>
                  <option value="rms">{text('均方根', 'RMS')}</option>
                </Dropdown>
              </ControlField>
              <RangeControl label={text('触发阈值', 'Trigger threshold')} unit=""
                value={clThreshold} min={0} max={1} step={0.001}
                disabled={!engineReady || protocolRunning} onChange={setClThreshold} />
              <RangeControl label={text('幅度', 'Amplitude')} unit=""
                value={clAmplitude} min={0.5} max={2} step={0.1}
                disabled={!engineReady || protocolRunning} onChange={setClAmplitude} />
              <RangeControl label={text('刺激时长', 'Stimulus duration')} unit="ms"
                value={clDurationMs} min={20} max={500} step={10}
                disabled={!engineReady || protocolRunning} onChange={setClDurationMs} />
              <RangeControl label={text('评估周期', 'Evaluation period')} unit="ms"
                value={clPeriodMs} min={100} max={5000} step={100}
                disabled={!engineReady || protocolRunning} onChange={setClPeriodMs} />
              <RangeControl label={text('冷却时间', 'Cooldown')} unit="ms"
                value={clCooldownMs} min={0} max={5000} step={100}
                disabled={!engineReady || protocolRunning} onChange={setClCooldownMs} />
              <RangeControl label={text('最多触发次数', 'Max triggers')} unit=""
                value={clMaxTriggers} min={1} max={100} step={1}
                disabled={!engineReady || protocolRunning} onChange={setClMaxTriggers} />
            </>
          )}
          {protocolId === 'single-pulse' && (
            <p className="bench-note">
              {text('单脉冲用刺激器盒的目标、幅度和时长，开始即发一次，随后自动停止。',
                'Single pulse uses the stimulator box target, amplitude and duration; it fires once on start, then stops itself.')}
            </p>
          )}

          <h3>{t('bench.drill.step2')}</h3>
          <p className="bench-note">{t('bench.composer.modelVariant')}</p>
          <h4>{t('bench.composer.groupA')}</h4>
          <RangeControl label={t('bench.composer.g')} unit=""
            value={g} min={0} max={0.4} step={0.01}
            disabled={!engineReady} onChange={setComposerG}
            hint={t('bench.composer.gHint')} />
          <RangeControl label={t('bench.composer.cEi')} unit=""
            value={cEi} min={3} max={8} step={0.1}
            disabled={!engineReady} onChange={setComposerCEi}
            hint={t('bench.composer.cEiHint')} />
          <h4>{t('bench.composer.groupB')}</h4>
          <ControlField label={t('bench.composer.background')}>
            <div className="bench-segmented" role="group" aria-label={t('bench.composer.background')}>
              {(['quiet', 'spontaneous', 'oscillatory'] as const).map((mode) => (
                <button key={mode} type="button"
                  className={`chip chip-small${background === mode ? ' chip-on' : ''}`}
                  aria-pressed={background === mode}
                  disabled={!engineReady}
                  onClick={() => handleBackgroundMode(mode)}>
                  {mode === 'quiet' ? text('安静', 'Quiet')
                    : mode === 'spontaneous' ? text('自发', 'Spontaneous')
                    : text('振荡', 'Oscillatory')}
                </button>
              ))}
            </div>
          </ControlField>
          <RangeControl label={t('bench.composer.ouSigma')} unit=""
            value={ouSigma} min={0.02} max={0.15} step={0.005}
            disabled={!engineReady} onChange={setComposerOuSigma}
            hint={t('bench.composer.ouSigmaHint')} />
          <RangeControl label={t('bench.composer.extSineAmp')} unit=""
            value={extSineAmp} min={0} max={0.4} step={0.01}
            disabled={!engineReady || background !== 'oscillatory'} onChange={setComposerExtSineAmp}
            hint={t('bench.composer.extSineAmpHint')} />
          <RangeControl label={t('bench.composer.extSineFreqHz')} unit="Hz"
            value={extSineFreqHz} min={1} max={30} step={0.5}
            disabled={!engineReady || background !== 'oscillatory'} onChange={setComposerExtSineFreqHz}
            hint={t('bench.composer.extSineFreqHzHint')} />
          <h4>{t('bench.composer.groupC')}</h4>
          <RangeControl label={t('bench.composer.rtMin')} unit="ms"
            value={rtMinMs} min={50} max={1000} step={10}
            disabled={!engineReady || protocolRunning} onChange={setRtMinMs} />
          <RangeControl label={t('bench.composer.rtMax')} unit="ms"
            value={rtMaxMs} min={50} max={2000} step={10}
            disabled={!engineReady || protocolRunning} onChange={setRtMaxMs} />
          <RangeControl label={t('bench.composer.seed')} unit=""
            value={subjectSeed} min={1} max={9999} step={1}
            disabled={!engineReady || protocolRunning} onChange={setSubjectSeed}
            hint={text('同一种子给出同一串反应时。', 'The same seed gives the same reaction-time sequence.')} />
          {!rtRangeValid && (
            <p className="bench-note">{text('反应时范围无效：需满足 50 ≤ 下限 < 上限 ≤ 2000 ms。', 'Invalid RT range: requires 50 ≤ min < max ≤ 2000 ms.')}</p>
          )}
          <p className="bench-note">
            <strong>{t('bench.composer.summaryLabel')}：</strong>{composerSummaryFull}
          </p>
          <p className="bench-note">{t('bench.composer.modelVariantShort')}</p>
          <h4>{t('bench.composer.directionsTitle')}</h4>
          <ul className="bench-directions">
            {EPILEPSY_DIRECTIONS.map((d) => (
              <li key={d.id}>
                <strong>{locale === 'zh-CN' ? d.titleZh : d.titleEn}</strong>
                {' '}{locale === 'zh-CN' ? d.bodyZh : d.bodyEn}
              </li>
            ))}
          </ul>
          <div className="bench-actions">
            <button className="ui-button" type="button" onClick={resetSubject}
              disabled={!engineReady}>
              {t('bench.composer.resetSubject')}
            </button>
          </div>

          <h3>{t('bench.drill.step3')}</h3>
          <div className="bench-actions">
            <button className="ui-button ui-button-primary" type="button"
              onClick={runProtocol} disabled={!engineReady || protocolRunning}
              title={!engineReady ? notReadyReason : undefined}>
              <span className="pict-step-badge-inline">2</span> {t('bench.runProtocol')}
            </button>
            <button className="ui-button" type="button"
              onClick={stopProtocol} disabled={!engineReady || !protocolRunning}>
              {t('bench.stopProtocol')}
            </button>
          </div>
          <p className="bench-status" role="status">{statusText}</p>
          <div className="bench-readout">
            <p>{text('试次数', 'Trials')}: {trialCount}</p>
            <p>{text('下一次刺激（模型时间）', 'Next stimulus (model time)')}: {nextStimulusTms !== null ? `${fmt(nextStimulusTms, 0)} ms` : '—'}</p>
            <p>{text('丢弃的响应', 'Dropped responses')}: {droppedResponses}</p>
            {loopTimingText !== null && (
              <p data-testid="bench-loop-timing">
                {text('闭环延迟', 'Closed-loop latency')}: {loopTimingText}
              </p>
            )}
          </div>
          <p className="bench-note">
            {text('全局暂停（顶栏）停的是整个仿真；协议运行/停止只管当前协议，两者不是同一个按钮。',
              'The header pause stops the whole simulation; protocol run/stop only controls the current protocol. They are not the same button.')}
          </p>
          <p className="bench-note">{t('bench.drill.handNote')}</p>
          <p className="bench-note">
            {text('模拟受试者只对 oddball 试次按 Space 键；反应时是仿真假设，不是生理测量。',
              'The simulated subject only presses Space on oddball trials; reaction time is a simulation assumption, not a physiological measurement.')}
          </p>
          <div className="bench-table-wrap">
            <table className="bench-table">
              <thead>
                <tr>
                  <th>{text('试次', 'Trial')}</th><th>{text('刺激 t', 'Stimulus t')}</th>
                  <th>{text('响应 t', 'Response t')}</th><th>RT</th><th>{text('按键', 'Key')}</th>
                </tr>
              </thead>
              <tbody>
                {responses.length === 0 && (
                  <tr><td colSpan={5}>{text('暂无按键记录', 'No key presses yet')}</td></tr>
                )}
                {responses.slice(-8).map((r) => (
                  <tr key={`${r.trialIndex}-${r.responseTms}`}>
                    <td>{r.trialIndex}</td>
                    <td>{fmt(r.stimulusTms, 0)} ms</td>
                    <td>{fmt(r.responseTms, 0)} ms</td>
                    <td>{fmt(r.rtMs, 0)} ms</td>
                    <td>{r.key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BenchDrillDown>
      )}

      {drill === 'test' && (
        <BenchDrillDown title={t('bench.testComputer')} drill="test" onClose={() => setDrill(null)}>
          <h3>{t('bench.waveform')}</h3>
          <p className="bench-note">
            {text('通道', 'Channel')} {selectedChannel} · {sampleRate} Hz · {text('近 5 秒', 'last 5 s')}
            {bandpassOn ? ` · ${text('带通', 'band-pass')} ${lowHz}–${highHz} Hz` : ''}
          </p>
          <ControlField label={text('波形通道', 'Waveform channel')}>
            <Dropdown value={selectedChannel} disabled={channelOptions.length === 0}
              onChange={(e) => setSelectedChannel(e.target.value)}
              aria-label={text('波形通道', 'Waveform channel')}>
              {channelOptions.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </Dropdown>
          </ControlField>
          <canvas ref={canvasRef} className="bench-wave" aria-label={t('bench.waveform')} />
          <div className="bench-readout">
            <p>{text('瞬时值', 'Instant value')} {fmt(latestUv, 2)} µV · {text('选中通道', 'selected channel')} {selectedChannel}</p>
            <p>{text('均方根', 'RMS')} {fmt(rmsUv, 2)} µV · {sampleRate} Hz</p>
            <p>{text('瞬时值是最新一个采样点，均方根是整段波形的平均幅度，两者不是同一个数。', 'Instant value is the latest sample; RMS is the average amplitude over the whole trace — two different numbers.')}</p>
            <p>{text('滤波状态', 'Filter')}: {bandpassOn
              ? `${text('带通', 'band-pass')} ${lowHz}–${highHz} Hz`
              : text('直通（无带通）', 'Bypass (no band-pass)')}</p>
            <p>{text('参考', 'Reference')}: {referenceSel === 'average'
              ? text('平均', 'average') : referenceSel === 'cz' ? 'Cz' : 'M1'}</p>
          </div>
          {displayError && <p className="bench-error" role="alert">{displayError}</p>}

          <h3>{t('bench.recording')}</h3>
          <div className="bench-readout">
            <p>runId {shortRunId(benchRecording?.runId ?? runId)}</p>
            <p>{text('模型时间', 'Model time')} {fmt(snap?.t_ms ?? null, 0)} ms</p>
            <p>{text('样本数', 'Samples')} {totalSamples} · {text('事件数', 'Events')} {totalEvents} · {text('试次数', 'Trials')} {trialCount}</p>
            <p>{text('协议', 'Protocol')}: {protocolId ? t(`bench.protocol.${protocolId}`) : '—'}</p>
            <p>{text('头模型', 'Head model')}: {headModel} · {text('脑电帽', 'Cap')}: {capSelection?.preset ?? '—'}</p>
          </div>
          <div className="bench-actions">
            <button className="ui-button" type="button" onClick={() => refreshAll()}
              disabled={!engineReady || acquiring}>{t('bench.updateRecording')}</button>
            <button className="ui-button" type="button" onClick={() => exportRecording('json')}
              disabled={!benchRecording && !acquisition}>{t('bench.exportJson')}</button>
            <button className="ui-button" type="button" onClick={() => exportRecording('csv')}
              disabled={!benchRecording && !acquisition}>{t('bench.exportCsv')}</button>
          </div>
          {benchRecording ? (
            <div className="bench-table-wrap" data-testid="bench-recording-events">
              <p className="bench-note">
                {text('最近一次组装的记录事件（相对时间，模型时钟）', 'Events in the last assembled recording (relative time, model clock)')}
                {` · pulse ${benchRecording.events.filter((e) => e.type === 'pulse').length} · response ${benchRecording.events.filter((e) => e.type === 'response').length}`}
              </p>
              <table className="bench-table">
                <thead>
                  <tr>
                    <th>#</th><th>{text('类型', 'Type')}</th><th>{text('相对时间', 'Relative t')}</th>
                    <th>{text('条件', 'Condition')}</th><th>runId</th>
                  </tr>
                </thead>
                <tbody>
                  {benchRecording.events.length === 0 && (
                    <tr><td colSpan={5}>{text('记录里暂无事件', 'No events in the recording yet')}</td></tr>
                  )}
                  {benchRecording.events.slice(-12).map((e) => (
                    <tr key={e.id} data-event-type={e.type} data-event-tms={e.tMs}
                      data-event-runid={e.runId ?? ''}>
                      <td>{e.id}</td>
                      <td>{e.type}</td>
                      <td>{fmt(e.tMs, 0)} ms</td>
                      <td>{e.condition}</td>
                      <td>{shortRunId(e.runId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="bench-note">{text('暂无已组装记录，点击“更新记录”组装当前采集。', 'No assembled recording yet; press “Update recording” to assemble the current acquisition.')}</p>
          )}
          {benchError && <p className="bench-error" role="alert">{benchError}</p>}

          <h3>{text('记录分析', 'Recording analysis')}</h3>
          <p className="bench-note">
            {text('同一份共享记录的分析视图：ERP / 时频 / 地形 / 源定位 / 频谱。试次直接取自台子记录，不另跑独立模型。',
              'Analysis of the one shared recording: ERP / time-frequency / topography / source localization / spectrum. Trials come straight from the bench recording, not from a separate model run.')}
          </p>
          <div className="bench-view-toggle" role="tablist" aria-label={text('记录分析', 'Recording analysis')}>
            {([
              ['erp', 'ERP'],
              ['tfr', text('时频', 'Time-frequency')],
              ['topo', text('地形', 'Topography')],
              ['inverse', text('源定位', 'Source localization')],
              ['waves', text('频谱', 'Spectrum')],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={analysisTab === key}
                className={`chip chip-small${analysisTab === key ? ' chip-on' : ''}`}
                onClick={() => setAnalysisTab(key)}>
                {label}
              </button>
            ))}
          </div>
          {analysisTab === 'erp' && (
            <ErpTab recording={analysisRecording} events={analysisEvents} epochs={epochs}
              onEpochsChange={handleBenchEpochsChange} channel={selectedChannel} />
          )}
          {analysisTab === 'tfr' && <TfrTab epochs={epochs} channel={selectedChannel} />}
          {analysisTab === 'topo' && (
            <TopoTab recording={analysisRecording} atTimeMs={atTimeMs} onAtTimeMsChange={setAtTimeMs} fixture={fixture} />
          )}
          {analysisTab === 'inverse' && (
            <InverseTab recording={analysisRecording} fixture={fixture} atTimeMs={atTimeMs} />
          )}
          {analysisTab === 'waves' && <WavesTab recording={analysisRecording} channel={selectedChannel} />}

          <h3>{t('bench.trace')}</h3>
          <ol className="bench-flow-hops" aria-label={text('最近几跳', 'Recent hops')}>
            {flowHops.length === 0 && (
              <li className="bench-flow-hop">{text('运行一次协议或发送一次刺激，信号就开始走。', 'Run a protocol or send one stimulus and the signal starts moving.')}</li>
            )}
            {flowHops.map((e, i) => (
              <li key={e.seq} className={`bench-flow-hop${i === flowHops.length - 1 ? ' bench-flow-hop-now' : ''}`}>
                {e.hop} · {e.label} · {fmt(e.tMs, 0)} ms
              </li>
            ))}
          </ol>
          <div className="bench-actions">
            <button className="ui-button" type="button"
              onClick={() => { traceRef.current.clear(); setTraceList([]); }}>
              {t('bench.clearTrace')}
            </button>
          </div>
        </BenchDrillDown>
      )}

      {drill === 'amplifier' && (
        <BenchDrillDown title={t('bench.amplifier')} drill="amplifier" onClose={() => setDrill(null)}>
          <p className="bench-note">{t('bench.drill.amplifierNote')}</p>
          <ControlField label={text('采样率', 'Sample rate')}>
            <Dropdown value={String(sampleRate)} disabled={!engineReady}
              title={!engineReady ? notReadyReason : undefined}
              onChange={(e) => setSampleRate(Number(e.target.value) as 250 | 500)}
              aria-label={text('采样率', 'Sample rate')}>
              <option value="250">250 Hz</option>
              <option value="500">500 Hz</option>
            </Dropdown>
          </ControlField>
          <ControlField label={text('参考', 'Reference')}>
            <Dropdown
              value={referenceSel}
              disabled={!engineReady}
              title={!engineReady ? notReadyReason : undefined}
              onChange={(e) => setReferenceSel(e.target.value as BenchReferenceSel)}
              aria-label={text('参考', 'Reference')}>
              <option value="average">{text('平均参考', 'Average reference')}</option>
              <option value="cz">Cz</option>
              <option value="m1" disabled={!hasM1}>
                {text('乳突 M1（单侧）', 'Mastoid M1 (single-sided)')}
              </option>
            </Dropdown>
          </ControlField>
          {!hasM1 && (
            <p className="bench-note">{text('当前导联无 M1', 'No M1 in the current montage')}</p>
          )}
          <ControlField label={text('带通滤波', 'Band-pass filter')}>
            <button className="ui-button" type="button" disabled={!engineReady}
              title={!engineReady ? notReadyReason : undefined}
              onClick={() => setBenchSettings({ bandpassOn: !bandpassOn })}>
              {bandpassOn ? text('带通：开', 'Band-pass: on') : text('带通：关', 'Band-pass: off')}
            </button>
          </ControlField>
          <RangeControl label={text('带通下限', 'Band-pass low')} unit="Hz"
            value={lowDraft} min={0.1} max={10} step={0.1}
            disabled={!engineReady || !bandpassOn}
            onChange={setLowDraft} />
          <RangeControl label={text('带通上限', 'Band-pass high')} unit="Hz"
            value={highDraft} min={10} max={125} step={0.5}
            disabled={!engineReady || !bandpassOn}
            onChange={setHighDraft} />
          <button className="ui-button" type="button"
            disabled={!engineReady || !bandpassOn || !bandpassValid}
            title={!bandpassValid ? text('需满足 0 < 低 < 高 < 采样率/2', 'Requires 0 < low < high < sample rate / 2') : undefined}
            onClick={() => { setLowHz(lowDraft); setHighHz(highDraft); }}>
            {t('bench.applyBandpass')}
          </button>
          {!bandpassValid && (
            <p className="bench-note">{text('带通无效：需满足低 < 高。', 'Invalid band-pass: low must be below high.')}</p>
          )}
          <RangeControl label={text('增益', 'Gain')} unit="×"
            value={gain} min={0.5} max={5} step={0.1}
            disabled={!engineReady} onChange={setGain}
            hint={text('增益只放大显示，不改记录里的 µV。', 'Gain scales the display only, never the recorded µV.')} />
          {referenceNote && <p className="bench-note">{referenceNote}</p>}
          <div className="bench-readout">
            <p>{text('瞬时值', 'Instant value')} {fmt(latestUv, 2)} µV · {text('选中通道', 'selected channel')} {selectedChannel}</p>
            <p>{text('均方根', 'RMS')} {fmt(rmsUv, 2)} µV · {sampleRate} Hz</p>
            <p>{text('滤波状态', 'Filter')}: {bandpassOn
              ? `${text('带通', 'band-pass')} ${lowHz}–${highHz} Hz`
              : text('直通（无带通）', 'Bypass (no band-pass)')}</p>
            <p>{text('参考', 'Reference')}: {referenceSel === 'average'
              ? text('平均', 'average') : referenceSel === 'cz' ? 'Cz' : 'M1'}</p>
          </div>
          {displayError && <p className="bench-error" role="alert">{displayError}</p>}
          {acqError && <p className="bench-error" role="alert">{acqError}</p>}
          <button className="ui-button" type="button" onClick={refreshAll}
            disabled={!engineReady || acquiring}>
            {acquiring ? text('采集中…', 'Acquiring…') : t('bench.refreshAcquisition')}
          </button>
        </BenchDrillDown>
      )}

      {drill === 'stimulator' && (
        <BenchDrillDown title={t('bench.stimulator')} drill="stimulator" onClose={() => setDrill(null)}>
          <p className="bench-note">{t('bench.drill.returnPathNote')}</p>
          <p className="bench-note">
            {lastStim
              ? `${text('上一次', 'Last')}: ${text('脑区', 'node')} ${lastStim.node} · ${fmt(lastStim.amplitude, 2)} · ${lastStim.durationMs} ms`
              : text('就绪', 'Ready')}
          </p>
          <ControlField label={text('目标脑区', 'Target region')}>
            <Dropdown value={String(stimNode)} disabled={!engineReady || !data}
              title={!engineReady ? notReadyReason : undefined}
              onChange={(e) => { setStimTarget(Number(e.target.value)); onSelect(Number(e.target.value)); }}
              aria-label={text('目标脑区', 'Target region')}>
              {(data?.regions ?? []).map((r) => (
                <option key={r.id} value={String(r.id)}>{r.label}</option>
              ))}
            </Dropdown>
          </ControlField>
          <RangeControl label={text('幅度', 'Amplitude')} unit=""
            value={strength} min={0.5} max={2} step={0.05}
            disabled={!engineReady} onChange={onStrength} />
          <RangeControl label={text('时长', 'Duration')} unit="ms"
            value={durationMs} min={20} max={500} step={10}
            disabled={!engineReady} onChange={onDuration} />
          <button className="ui-button ui-button-primary" type="button"
            onClick={sendPulse} disabled={!engineReady}
            title={!engineReady ? notReadyReason : undefined}>
            {t('bench.sendPulse')}
          </button>
          <p className="bench-note">
            {text('经 sim.pulseAt 直达 Worker；ACK 时间以 Worker 为准，不是点击时间。',
              'Goes to the Worker via sim.pulseAt; the ACK time is the Worker time, not the click time.')}
          </p>
          <h3>{text('命令日志', 'Command log')}</h3>
          <div className="bench-table-wrap">
            <table className="bench-table">
              <thead>
                <tr>
                  <th>{text('目标', 'Target')}</th><th>{text('幅度', 'Amplitude')}</th>
                  <th>{text('时长', 'Duration')}</th><th>ACK</th>
                </tr>
              </thead>
              <tbody>
                {stimLog.length === 0 && (
                  <tr><td colSpan={4}>{text('暂无命令', 'No commands yet')}</td></tr>
                )}
                {stimLog.slice(-8).map((e) => (
                  <tr key={e.key}>
                    <td>{data?.regions[e.node]?.label ?? e.node}</td>
                    <td>{fmt(e.amplitude, 2)}</td>
                    <td>{e.durationMs} ms</td>
                    <td>{e.ackTms !== null ? `${fmt(e.ackTms, 0)} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BenchDrillDown>
      )}

      {peripheralOpen && (
        <BenchDrillDown title={text('外周生理传感器', 'Peripheral physiology sensors')} drill="peripheral"
          onClose={() => setPeripheralOpen(false)}>
          <p className="bench-note">{t('bench.peripheralReserved')}</p>
        </BenchDrillDown>
      )}
    </div>
  );
}

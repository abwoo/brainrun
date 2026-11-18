/**
 * BrainRun — single entry: the closed-loop bench (default) + #basic fallback.
 *
 * Phase 4 cut the old entries: the four modes (PLAY/WAVES/EEG/EXPLORE), the
 * 15 one-click scenarios, the six standalone labs (cellular / dipole / EEG
 * analysis / experiment / head-sphere / local BEM) and the #advanced
 * workspace are gone; their functions live in the bench now. lib/ code is
 * untouched by the cut (scenarios.ts etc. stay, with no UI entry).
 * PhysicsHome (#basic) stays as the fallback for now, including its
 * embedded head-model views; its navigation into #advanced is removed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PhysicsHome from './components/PhysicsHome';
import ClosedLoopBench from './components/ClosedLoopBench';
import { useI18n } from './lib/i18n';
import BrainScene from './components/BrainScene';
import type { BrainData } from './lib/brainData';
import { loadBrainData } from './lib/brainData';
import { DEFAULT_PARAMS, KNOB_MAP, SimClient } from './lib/simClient';
import type {
  BackgroundMode,
  ResponseGroups,
  ResponseSummary,
  ResponseWindow,
} from './lib/simClient';
import { DEFAULT_BACKGROUND_MODE } from './lib/simClient';
import { equivalentMomentNAm } from './lib/localCorticalColumn';
import type { Snapshot } from './worker/protocol';
import type { SnapshotSummary } from './lib/simClient';
import './App.css';

export default function App() {
  const { locale } = useI18n();
  const [workspace, setWorkspace] = useState<'bench' | 'basic'>(() =>
    window.location.hash.startsWith('#basic') ? 'basic' : 'bench',
  );
  useEffect(() => {
    const route = () =>
      setWorkspace(window.location.hash.startsWith('#basic') ? 'basic' : 'bench');
    window.addEventListener('hashchange', route);
    return () => window.removeEventListener('hashchange', route);
  }, []);
  const [data, setData] = useState<BrainData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [simReady, setSimReady] = useState(false);
  const [runOverview, setRunOverview] = useState<{
    runId: string; tMs: number | null; confirmed: number;
  } | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  // 参数归一化值 k in [0,1]；默认值对应演示预设。只剩刺激强度与持续
  // 时间两档进台子（c_ei / G 的滑杆随 #advanced 一起砍掉，引擎参数未动）。
  const [kStim, setKStim] = useState(() => KNOB_MAP.stimulusK(DEFAULT_PARAMS.stim_amplitude));
  const [kDur, setKDur] = useState(() => KNOB_MAP.durationK(DEFAULT_PARAMS.stim_duration_ms));

  // PR4：背景活动模式（默认 Spontaneous，见 DEFAULT_BACKGROUND_MODE）。
  const [bgMode, setBgMode] = useState<BackgroundMode>(DEFAULT_BACKGROUND_MODE);

  // PR2：响应数据（基线 / 窗口 / 汇总 / 三类标记），由 250 ms 轮询从
  // SimClient 的真实快照历史里读出；无刺激时全为 null（“尚未刺激”）。
  const [resp, setResp] = useState<{
    baseline: { t_ms: number; node: number } | null;
    baselineE: Float64Array | null;
    window: ResponseWindow | null;
    summary: ResponseSummary | null;
    groups: ResponseGroups | null;
  }>({
    baseline: null,
    baselineE: null,
    window: null,
    summary: null,
    groups: null,
  });
  const respSigRef = useRef('');

  const simRef = useRef<SimClient | null>(null);
  const lastUiUpdateRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadBrainData()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 仿真客户端：数据就绪后启动 Worker。
  useEffect(() => {
    if (!data) return;
    const sim = new SimClient();
    simRef.current = sim;
    sim.attachDebugBridge();
    sim.onReady(() => {
      setSimReady(true);
      const session = sim.getExperimentSession();
      setRunOverview({
        runId: session.provenance.runId,
        tMs: session.lastModelTimeMs, confirmed: session.commands.length,
      });
    });
    sim.start(data.connectivity.weights, data.connectivity.lengths);
    // 约 15 Hz 更新 React 面板（时间、读数）；快照本身 60 Hz，
    // 3D 着色与波形由各自订阅直接消费，不经过 React。
    const unsub = sim.subscribe((s) => {
      const now = Date.now();
      if (now - lastUiUpdateRef.current >= 66) {
        lastUiUpdateRef.current = now;
        setSnap(s);
        setPaused(s.paused);
        const session = sim.getExperimentSession();
        setRunOverview({
          runId: session.provenance.runId,
          tMs: session.lastModelTimeMs, confirmed: session.commands.length,
        });
      }
      if (s.diverged) setSimError(s.divergence_detail);
    });
    const errTimer = window.setInterval(() => {
      const err = sim.getError();
      if (err) setSimError(err);
    }, 1000);
    return () => {
      window.clearInterval(errTimer);
      unsub();
      sim.stop();
      simRef.current = null;
      setRunOverview(null);
    };
  }, [data]);

  // PR2：每 250 ms 从 SimClient 读响应数据（基线 / 窗口 / 汇总 / 三类标记）。
  // 数据不变时不更新 state。PR4：同一轮询里把引擎确认的背景模式同步回来。
  const modeParamsSigRef = useRef('');
  useEffect(() => {
    if (!data || !simReady) return;
    const poll = () => {
      const sim = simRef.current;
      if (!sim) return;
      const b = sim.getBaseline();
      const w = sim.getLastResponseWindow();
      const s = sim.getResponseSummary();
      const g = sim.getResponseGroups();
      const sig = [
        b ? `${b.t_ms}:${b.node}` : 'none',
        w ? `${w.snapshots.length}:${w.snapshots.length ? w.snapshots[w.snapshots.length - 1].t_ms : 0}` : 'nowin',
        s ? s.responders.map((r) => `${r.node}:${r.peakDeltaE.toFixed(4)}`).join(',') : 'nosum',
      ].join('|');
      if (sig !== respSigRef.current) {
        respSigRef.current = sig;
        setResp({
          baseline: b ? { t_ms: b.t_ms, node: b.node } : null,
          baselineE: b ? b.e : null,
          window: w,
          summary: s,
          groups: g,
        });
      }
      const mp = sim.getModeParams();
      const mpSig = JSON.stringify(mp);
      if (mpSig !== modeParamsSigRef.current) {
        modeParamsSigRef.current = mpSig;
        if (mp) setBgMode(mp.mode);
      }
    };
    poll();
    const timer = window.setInterval(poll, 250);
    return () => window.clearInterval(timer);
  }, [data, simReady]);

  // PR8-LINK：HEAD/DIPOLE 直播偶极矩的基线——选区切换时捕获该脑区当时的
  // E/I（静息参考）；q 由 live E/I 经 PR5 假设链算（equivalentMomentNAm）。
  // 基线只在选区变化时重捕，不随快照漂移；未捕获到之前 moment 为 null。
  const liveQBaselineRef = useRef<{ node: number; e: number; i: number } | null>(null);
  useEffect(() => {
    if (selectedId === null) {
      liveQBaselineRef.current = null;
      return;
    }
    if (snap && liveQBaselineRef.current?.node !== selectedId) {
      liveQBaselineRef.current = {
        node: selectedId,
        e: snap.e[selectedId],
        i: snap.i[selectedId],
      };
    }
  }, [selectedId, snap]);
  const liveMomentNAm = useMemo(() => {
    if (selectedId === null || snap === null) return null;
    const b = liveQBaselineRef.current;
    if (!b || b.node !== selectedId) return null;
    try {
      return equivalentMomentNAm(snap.e[selectedId], snap.i[selectedId], b.e, b.i);
    } catch {
      return null;
    }
  }, [snap, selectedId]);

  const handlePulse = useCallback((node: number) => {
    simRef.current?.pulse(node);
  }, []);
  const handleHoldStart = useCallback((node: number) => {
    simRef.current?.holdStart(node);
  }, []);
  const handleHoldEnd = useCallback((node: number) => {
    simRef.current?.holdEnd(node);
  }, []);
  const handleHoldRetract = useCallback((node: number) => {
    simRef.current?.retractHold(node);
  }, []);

  // PR4：切换背景活动模式。只改 bg_mode（振荡档同时带上正弦参数），
  // 不动局部参数与旋钮值；引擎经 mode_applied 确认后，轮询会把
  // modeParams / bgMode 同步回来。
  const handleBackgroundMode = useCallback((mode: BackgroundMode) => {
    const sim = simRef.current;
    if (!sim || !simReady) return;
    setBgMode(mode);
    sim.setBackgroundMode(mode);
  }, [simReady]);

  // PR4：把快照恢复后的状态同步回界面（参数旋钮、背景模式），并清掉
  // 属于恢复前轨迹的响应数据。权重/偏置随 #advanced 一起砍掉，不再同步。
  const syncFromSnapshot = useCallback((summary: SnapshotSummary) => {
    const p = summary.params;
    setKStim(KNOB_MAP.stimulusK(p.stim_amplitude));
    setKDur(KNOB_MAP.durationK(p.stim_duration_ms));
    setBgMode(summary.mode);
    respSigRef.current = '';
    setResp({ baseline: null, baselineE: null, window: null, summary: null, groups: null });
    setSnap(null);
  }, []);

  // Branch restores and shared client commands must synchronize the same
  // controls as this component's own restore button.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim || !simReady) return;
    return sim.subscribeRestored(syncFromSnapshot);
  }, [simReady, syncFromSnapshot]);

  const handleRestoreSnapshot = useCallback(
    (id: 'manual' | 'auto' | 'pulse-baseline') => {
      const sim = simRef.current;
      if (!sim || !simReady) return;
      sim.restoreSnapshot(id).then(syncFromSnapshot).catch(() => undefined);
    },
    [simReady, syncFromSnapshot],
  );

  const handlePlayPause = () => {
    const sim = simRef.current;
    if (!sim || !simReady) return;
    if (paused) {
      sim.resume();
      setPaused(false);
    } else {
      sim.pause();
      setPaused(true);
    }
  };

  const handleReset = () => {
    const sim = simRef.current;
    // 恢复默认参数、清除刺激、恢复确定性初始状态、清空曲线。
    setKStim(KNOB_MAP.stimulusK(DEFAULT_PARAMS.stim_amplitude));
    setKDur(KNOB_MAP.durationK(DEFAULT_PARAMS.stim_duration_ms));
    sim?.setParams({ ...DEFAULT_PARAMS });
    sim?.reset();
    setSnap(null);
    setPaused(false);
    setSimError(null);
    setSelectedId(null);
    // PR2：RESET 清掉视图响应数据（基线、窗口、标记随之下一次刺激重建）。
    respSigRef.current = '';
    setResp({ baseline: null, baselineE: null, window: null, summary: null, groups: null });
    setResetSignal((n) => n + 1);
  };

  if (workspace === 'bench') return <ClosedLoopBench
    data={data} selectedId={selectedId} onSelect={setSelectedId}
    sim={simRef.current} ready={simReady} error={simError ?? loadError}
    snap={snap} paused={paused} onPause={handlePlayPause}
    background={bgMode} onBackground={handleBackgroundMode}
    strength={Number(KNOB_MAP.stimulusAmplitude(kStim).toFixed(2))} durationMs={Math.round(KNOB_MAP.durationMs(kDur))}
    onStrength={value => { setKStim(KNOB_MAP.stimulusK(value)); simRef.current?.setParams({ stim_amplitude: value }); }}
    onDuration={value => { setKDur(KNOB_MAP.durationK(value)); simRef.current?.setParams({ stim_duration_ms: value }); }}
    onPulse={() => { if (selectedId !== null) handlePulse(selectedId); }}
    response={resp.summary} liveMomentNAm={liveMomentNAm} runId={runOverview?.runId ?? null}
    onReset={() => { const id = selectedId; handleBackgroundMode(DEFAULT_BACKGROUND_MODE); handleReset(); setSelectedId(id); }}
    onRecover={() => handleRestoreSnapshot('pulse-baseline')}
    onExitToPhysicsHome={() => { window.location.hash = 'basic'; setWorkspace('basic'); }}
    networkView={data ? <BrainScene pointerStimulates={false} data={data} autoRotate={false}
      showConnections={true} selectedId={selectedId} resetSignal={resetSignal} onSelect={setSelectedId}
      sim={simRef.current} onPulse={handlePulse} onHoldStart={handleHoldStart} onHoldEnd={handleHoldEnd}
      onHoldRetract={handleHoldRetract} colorMode="delta" baselineE={resp.baselineE} replayE={null}
      responseGroups={resp.summary ? resp.groups : null} biasList={[]} /> :
      <p className="model-loading">{locale === 'zh-CN' ? '正在加载脑区模型…' : 'Loading the region model…'}</p>}
  />;
  return <PhysicsHome
    data={data} selectedId={selectedId} onSelect={setSelectedId}
    sim={simRef.current} ready={simReady} error={simError ?? loadError}
    strength={Number(KNOB_MAP.stimulusAmplitude(kStim).toFixed(2))} durationMs={Math.round(KNOB_MAP.durationMs(kDur))}
    onStrength={value => { setKStim(KNOB_MAP.stimulusK(value)); simRef.current?.setParams({ stim_amplitude: value }); }}
    onDuration={value => { setKDur(KNOB_MAP.durationK(value)); simRef.current?.setParams({ stim_duration_ms: value }); }}
    onPulse={() => { if (selectedId !== null) handlePulse(selectedId); }}
    onReset={() => { const id = selectedId; handleBackgroundMode(DEFAULT_BACKGROUND_MODE); handleReset(); setSelectedId(id); }}
    onPause={handlePlayPause} paused={paused} background={bgMode} onBackground={handleBackgroundMode}
    response={resp.summary} onRecover={() => handleRestoreSnapshot('pulse-baseline')}
    onRestore={syncFromSnapshot}
    networkView={data ? <BrainScene pointerStimulates={false} data={data} autoRotate={false}
      showConnections={true} selectedId={selectedId} resetSignal={resetSignal} onSelect={setSelectedId}
      sim={simRef.current} onPulse={handlePulse} onHoldStart={handleHoldStart} onHoldEnd={handleHoldEnd}
      onHoldRetract={handleHoldRetract} colorMode="delta" baselineE={resp.baselineE} replayE={null}
      responseGroups={resp.summary ? resp.groups : null} biasList={[]} /> :
      <p className="model-loading">{locale === 'zh-CN' ? '正在加载脑区模型…' : 'Loading the region model…'}</p>}
  />;
}

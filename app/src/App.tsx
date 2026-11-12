/**
 * Brain Physics Playground — Phase 3：真实闭环。
 *
 * 布局：左 65-70% 为 3D 大脑，右 30-35% 为三块仪表
 * （LIVE ACTIVITY / PARAMETERS / REGION-CONNECTION）。
 * 仿真跑在 Web Worker 里的 Rust/WASM 引擎（演示预设 θ_e=1.0，G=0.35）；
 * 所有颜色、波形、读数都只读快照，没有第二套活动生成逻辑。
 * PLAY 控制仿真时钟；相机自动旋转是独立的“旋转”开关。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrainScene from './components/BrainScene';
import ActivityChart from './components/ActivityChart';
import ParamControl from './components/ParamControl';
import CellularLab from './components/CellularLab';
import DipoleLab from './components/DipoleLab';
import EegAnalysisLab from './components/EegAnalysisLab';
import type { EegLabTab } from './components/EegAnalysisLab';
import ExperimentLab from './components/ExperimentLab';
import ExplorePanel from './components/ExplorePanel';
import HeadSphereLab from './components/HeadSphereLab';
import LocalBEMLab from './components/LocalBEMLab';
import ScenarioLauncher, {
  scenarioResultToRecord,
  type ExperimentRecord,
} from './components/ScenarioLauncher';
import StimLab from './components/StimLab';
import WavesTab from './components/WavesTab';
import type { EegRecording } from './lib/eegData';
import {
  APP_MODES,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  getScenario,
  runScenarioCompute,
  transitionMode,
  type AppMode,
  type KeyNumber,
  type LabTarget,
} from './lib/scenarios';
import type { BrainData } from './lib/brainData';
import { loadBrainData, topConnections } from './lib/brainData';
import { DEFAULT_PARAMS, DELTA_FULL, KNOB_MAP, RESPONSE_THRESHOLD, SimClient } from './lib/simClient';
import type {
  BackgroundMode,
  ModeParams,
  ReplayState,
  ResponseGroups,
  ResponseSummary,
  ResponseWindow,
  SnapshotSummary,
} from './lib/simClient';
import { BIAS_DEFAULT_ON, BIAS_MAX, BIAS_MIN, DEFAULT_BACKGROUND_MODE, WEIGHT_MAX, WEIGHT_MIN } from './lib/simClient';
import { validateSphereFixture, type SphereFixture } from './lib/sphereForward';
import { equivalentMomentNAm } from './lib/localCorticalColumn';
import type { Snapshot } from './worker/protocol';
import './App.css';

/**
 * PR3 — 小型滑杆 + 数字框控件（沿用 PR2 ParamControl 的交互模式：
 * 横向滑杆 + 直接输数值 + −/+ 步进 + 双击恢复默认值）。
 *
 * 刻意不用 `.param` / `.param-*` 类名：PR2 测试断言全页恰好 4 个
 * `.param`（四个主参数），权重/偏置行必须不计入；功能模式相同，
 * 样式类独立（`.edge-*`，见 App.css）。
 * 滚轮改值不在此实现（四个主参数保留滚轮）；滑杆、数字框、步进、
 * 双击恢复已覆盖精确输入与快速调整。
 */
interface ValueSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  decimals: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}

function ValueSlider({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  decimals,
  disabled,
  onChange,
}: ValueSliderProps) {
  const [text, setText] = useState(value.toFixed(decimals));
  const numberRef = useRef<HTMLInputElement>(null);

  // 外部值变化时同步数字框；正在框里打字时不抢。
  useEffect(() => {
    if (document.activeElement !== numberRef.current) setText(value.toFixed(decimals));
  }, [value, decimals]);

  const k = (value - min) / (max - min);

  /** 提交数字框：解析失败回落当前值；越界 clamp 到范围边界。 */
  const commitNumber = () => {
    const v = parseFloat(text);
    if (Number.isNaN(v)) {
      setText(value.toFixed(decimals));
      return;
    }
    const clamped = Math.min(max, Math.max(min, v));
    setText(clamped.toFixed(decimals));
    onChange(clamped);
  };

  const stepBy = (dv: number) => {
    if (disabled) return;
    onChange(Math.min(max, Math.max(min, value + dv)));
  };

  return (
    <div className="edge-row">
      <div className="edge-controls">
        <button
          type="button"
          className="edge-step"
          aria-label={`${label} 减小`}
          disabled={disabled}
          title="减小"
          onClick={() => stepBy(-step)}
        >
          −
        </button>
        <input
          type="range"
          className="edge-slider"
          min={0}
          max={1000}
          step={1}
          value={Math.round(k * 1000)}
          aria-label={label}
          disabled={disabled}
          title="拖动改值 · 双击恢复原始值"
          onChange={(e) =>
            onChange(min + (Number(e.target.value) / 1000) * (max - min))
          }
          onDoubleClick={() => {
            if (!disabled) onChange(defaultValue);
          }}
        />
        <button
          type="button"
          className="edge-step"
          aria-label={`${label} 增大`}
          disabled={disabled}
          title="增大"
          onClick={() => stepBy(step)}
        >
          +
        </button>
        <input
          type="number"
          className="edge-number mono"
          ref={numberRef}
          aria-label={`${label} 数值`}
          min={min}
          max={max}
          step={step}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitNumber}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitNumber();
              numberRef.current?.blur();
            }
          }}
        />
        <span className="edge-value mono">{value.toFixed(decimals)}</span>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<BrainData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [showConnections, setShowConnections] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [simReady, setSimReady] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [showModelInfo, setShowModelInfo] = useState(false);
  const [showDipoleLab, setShowDipoleLab] = useState(false);
  const [showHeadSphereLab, setShowHeadSphereLab] = useState(false);
  const [showEegLab, setShowEegLab] = useState(false);
  const [showLocalBEM, setShowLocalBEM] = useState(false);
  // PR7：多尺度与高级实验台（计划 PR-13–15）。
  const [showCellularLab, setShowCellularLab] = useState(false);
  const [showStimLab, setShowStimLab] = useState(false);
  const [showExperimentLab, setShowExperimentLab] = useState(false);
  // PR8-A：四个模式（计划 §16.1，默认 PLAY）与渐进式展示（§16.2，
  // 默认只展示 3D 大脑 + 少量控制 + 实时测量窗口 + 简单操作说明）。
  const [mode, setMode] = useState<AppMode>('play');
  const [showMore, setShowMore] = useState(false);
  // PR8-A：一键科学场景（§16.3）——启动器弹窗、实验记录、球形正向模型。
  const [showScenarioLauncher, setShowScenarioLauncher] = useState(false);
  const [scenarioRecords, setScenarioRecords] = useState<ExperimentRecord[]>([]);
  const [runningScenarioId, setRunningScenarioId] = useState<number | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [scenarioFixture, setScenarioFixture] = useState<SphereFixture | null>(null);
  const [scenarioFixtureError, setScenarioFixtureError] = useState<string | null>(null);
  // PR8-A：EEG 模式内联实验台的初始 tab（S8–S11 的“打开实验台”用）与
  // WAVES 模式的 Alpha 记录（S4 跑完 JR 极限环后交来，WavesTab 画真实 PSD）。
  const [eegInitialTab, setEegInitialTab] = useState<EegLabTab>('eeg');
  const [wavesRecording, setWavesRecording] = useState<EegRecording | null>(null);
  // PR7：对照实验用的球形正向模型 fixture（与 EegAnalysisLab 同一来源；
  // 打开对照实验时才加载，null 时源定位对照不可用，其余两节可用）。
  const [expFixture, setExpFixture] = useState<SphereFixture | null>(null);
  const [expFixtureError, setExpFixtureError] = useState<string | null>(null);

  // PR7：打开对照实验时加载球形正向模型（只加载一次；失败时源定位
  // 对照不可用，其余两节照常可用，不静默编造 fixture）。
  useEffect(() => {
    if (!showExperimentLab || expFixture || expFixtureError) return;
    const controller = new AbortController();
    fetch(import.meta.env.BASE_URL + 'forward-assets/sphere-model.json', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('模型资源缺失：请先运行 scientific/forward/generate_sphere_model.py');
        const data = (await r.json()) as SphereFixture;
        validateSphereFixture(data);
        setExpFixture(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setExpFixtureError(String(e));
      });
    return () => controller.abort();
  }, [showExperimentLab, expFixture, expFixtureError]);

  // PR8-A：打开一键场景启动器时加载球形正向模型（只加载一次；与
  // EegAnalysisLab / ExperimentLab 同一来源、同一 model_id。失败时
  // 需要它的场景禁用、不编造 fixture）。
  useEffect(() => {
    if (!showScenarioLauncher || scenarioFixture || scenarioFixtureError) return;
    const controller = new AbortController();
    fetch(import.meta.env.BASE_URL + 'forward-assets/sphere-model.json', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('模型资源缺失：请先运行 scientific/forward/generate_sphere_model.py');
        const data = (await r.json()) as SphereFixture;
        validateSphereFixture(data);
        setScenarioFixture(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setScenarioFixtureError(String(e));
      });
    return () => controller.abort();
  }, [showScenarioLauncher, scenarioFixture, scenarioFixtureError]);
  const [paused, setPaused] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [holdMs, setHoldMs] = useState<number | null>(null);

  // PR2：着色视图（绝对活动 E / 活动变化 ΔE）。
  const [colorMode, setColorMode] = useState<'absolute' | 'delta'>('absolute');
  // PR2：回放状态（只改变观看速度，不改变物理方程）。
  const [replay, setReplay] = useState<ReplayState>({
    active: false,
    playing: false,
    speed: 1,
    tMs: 0,
    baselineT_ms: null,
    windowT0_ms: null,
    windowT1_ms: null,
  });
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
  const replayRef = useRef(replay);
  replayRef.current = replay;
  const respRef = useRef(resp);
  respRef.current = resp;
  // 轮询去重签名：响应数据不变时不触发 React 重渲染（避免每 250 ms
  // 重建 3D 响应标记）。
  const respSigRef = useRef('');

  // 参数归一化值 k in [0,1]；默认值对应演示预设。
  const [kStim, setKStim] = useState(() => KNOB_MAP.stimulusK(DEFAULT_PARAMS.stim_amplitude));
  const [kDur, setKDur] = useState(() => KNOB_MAP.durationK(DEFAULT_PARAMS.stim_duration_ms));
  const [kExcInh, setKExcInh] = useState(() => KNOB_MAP.c_eiK(DEFAULT_PARAMS.c_ei));
  const [kConn, setKConn] = useState(() => KNOB_MAP.gK(DEFAULT_PARAMS.g));

  // PR3：已改的连接权重（key `${i},${j}` → 当前值；只存与 TVB 原始值
  // 不同的边）。RESET 不动它——权重只能由恢复动作改回。
  const [weightEdits, setWeightEdits] = useState<Record<string, number>>({});
  // PR3：持续偏置输入（node → 幅度；只存非零项）。RESET 清掉它。
  const [biasMap, setBiasMap] = useState<Record<number, number>>({});
  // PR4：背景活动模式（默认 Spontaneous，见 DEFAULT_BACKGROUND_MODE）、
  // 确定性随机种子、引擎确认的模式参数（OU τ/σ、正弦幅度/频率——
  // 界面显示引擎实际用的值，不自己写死数字）、快照信息。
  const [bgMode, setBgMode] = useState<BackgroundMode>(DEFAULT_BACKGROUND_MODE);
  const [seed, setSeed] = useState(0);
  const [modeParams, setModeParams] = useState<ModeParams | null>(null);
  const [snapInfo, setSnapInfo] = useState<{
    manual: { t_ms: number; savedAtWall: number } | null;
    auto: { t_ms: number; savedAtWall: number } | null;
  }>({ manual: null, auto: null });
  const [snapMsg, setSnapMsg] = useState<string | null>(null);

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
    // PR2：回放状态经调试桥可读（getReplayState），供测试验证峰值一致。
    sim.setReplayStateProvider(() => {
      const r = replayRef.current;
      const w = respRef.current.window;
      return {
        active: r.active,
        playing: r.playing,
        speed: r.speed,
        tMs: r.tMs,
        baselineT_ms: r.baselineT_ms,
        windowT0_ms: w?.t0_ms ?? null,
        windowT1_ms: w?.t1_ms ?? null,
      };
    });
    sim.onReady(() => setSimReady(true));
    sim.start(data.connectivity.weights, data.connectivity.lengths);
    // 约 15 Hz 更新 React 面板（时间、读数、锁定横幅）；快照本身 60 Hz，
    // 3D 着色与波形由各自订阅直接消费，不经过 React。
    const unsub = sim.subscribe((s) => {
      const now = Date.now();
      if (now - lastUiUpdateRef.current >= 66) {
        lastUiUpdateRef.current = now;
        setSnap(s);
        setPaused(s.paused);
        const hold = sim.getHold();
        setHoldMs(hold ? hold.heldMs : null);
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
    };
  }, [data]);

  // PR2：每 250 ms 从 SimClient 读响应数据（基线 / 窗口 / 汇总 / 三类标记）。
  // 数据不变时不更新 state；新刺激到来时若正在回放旧窗口，回到直播。
  // PR4：同一轮询里读快照信息与模式参数（变化才更新 state）。
  const snapInfoSigRef = useRef('');
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
      const info = sim.getSnapshotInfo();
      const infoSig = JSON.stringify(info);
      if (infoSig !== snapInfoSigRef.current) {
        snapInfoSigRef.current = infoSig;
        setSnapInfo(info);
      }
      const mp = sim.getModeParams();
      const mpSig = JSON.stringify(mp);
      if (mpSig !== modeParamsSigRef.current) {
        modeParamsSigRef.current = mpSig;
        setModeParams(mp);
        if (mp) setBgMode(mp.mode);
      }
      const r = replayRef.current;
      if (r.active && w && r.baselineT_ms !== null && w.baselineT_ms !== r.baselineT_ms) {
        setReplay((prev) => ({ ...prev, active: false, playing: false }));
      }
    };
    poll();
    const timer = window.setInterval(poll, 250);
    return () => window.clearInterval(timer);
  }, [data, simReady]);

  // PR2：回放时钟——每 100 ms 按速度推进回放时刻，到窗口末尾自动停住。
  // 只推进“看哪一帧”，不触碰引擎；引擎时钟与快照历史不受影响。
  const replayT1 = resp.window?.t1_ms ?? null;
  const replayBaselineT = resp.window?.baselineT_ms ?? null;
  useEffect(() => {
    if (!replay.active || !replay.playing || replayT1 === null) return;
    const timer = window.setInterval(() => {
      setReplay((prev) => {
        if (!prev.active || !prev.playing) return prev;
        const next = prev.tMs + 100 * prev.speed;
        if (next >= replayT1) return { ...prev, tMs: replayT1, playing: false };
        return { ...prev, tMs: next };
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [replay.active, replay.playing, replay.speed, replayT1, replayBaselineT]);

  const selected = selectedId !== null && data ? data.regions[selectedId] : null;
  const connections =
    selectedId !== null && data ? topConnections(data, selectedId, 5) : [];
  const selectedE = selectedId !== null && snap ? snap.e[selectedId] : null;
  const selectedI = selectedId !== null && snap ? snap.i[selectedId] : null;
  const selectedP = selectedId !== null && snap ? snap.p[selectedId] : null;
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
  // PR3：选中脑区的持续偏置（0 = 无偏置）与全网已改权重数。
  const selectedBias = selectedId !== null ? (biasMap[selectedId] ?? 0) : 0;
  const modifiedWeightCount = Object.keys(weightEdits).length;
  const biasList = useMemo(
    () =>
      Object.entries(biasMap).map(([node, value]) => ({
        node: Number(node),
        value,
      })),
    [biasMap],
  );

  // PR2：回放当前时刻的录制快照（窗口内最近一条 ≤ 回放时刻的快照）。
  // 直播时为 null，BrainScene 改读直播快照。
  const replaySnapshot = useMemo(() => {
    if (!replay.active || !resp.window) return null;
    let cur: { t_ms: number; e: Float64Array; i: Float64Array } | null = null;
    for (const s of resp.window.snapshots) {
      if (s.t_ms <= replay.tMs) cur = s;
      else break;
    }
    return cur;
  }, [replay.active, replay.tMs, resp.window]);
  const replayE = replaySnapshot ? replaySnapshot.e : null;
  const replayReady = resp.window !== null && resp.window.snapshots.length >= 2;
  const baselineRegion =
    resp.baseline !== null && data ? data.regions[resp.baseline.node] : null;

  const startReplay = useCallback(() => {
    const w = respRef.current.window;
    if (!w || w.snapshots.length < 2) return;
    setReplay({
      active: true,
      playing: true,
      speed: 1,
      tMs: w.t0_ms,
      baselineT_ms: w.baselineT_ms,
      windowT0_ms: w.t0_ms,
      windowT1_ms: w.t1_ms,
    });
  }, []);
  const stopReplay = useCallback(() => {
    setReplay((prev) => ({ ...prev, active: false, playing: false }));
  }, []);

  const handlePulse = useCallback((node: number) => {
    // 新刺激到来：正在回放旧窗口就回到直播，新响应以这次刺激为准。
    setReplay((prev) => (prev.active ? { ...prev, active: false, playing: false } : prev));
    simRef.current?.pulse(node);
  }, []);
  const handleHoldStart = useCallback((node: number) => {
    setReplay((prev) => (prev.active ? { ...prev, active: false, playing: false } : prev));
    simRef.current?.holdStart(node);
  }, []);
  const handleHoldEnd = useCallback((node: number) => {
    simRef.current?.holdEnd(node);
    setHoldMs(null);
  }, []);
  const handleHoldRetract = useCallback((node: number) => {
    simRef.current?.retractHold(node);
    setHoldMs(null);
  }, []);

  // PR3：改一条连接权重（单边：只改 C[i][j]，不改 C[j][i]）。
  const handleWeightChange = useCallback(
    (i: number, j: number, w: number) => {
      const sim = simRef.current;
      if (!sim || !data) return;
      const stored = sim.setWeight(i, j, w);
      const orig = data.connectivity.weights[i][j];
      const key = `${i},${j}`;
      setWeightEdits((prev) => {
        const next = { ...prev };
        if (Math.abs(stored - orig) > 1e-9) next[key] = stored;
        else delete next[key];
        return next;
      });
    },
    [data],
  );
  const handleWeightReset = useCallback((i: number, j: number) => {
    simRef.current?.resetWeight(i, j);
    const key = `${i},${j}`;
    setWeightEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const handleWeightResetAll = useCallback(() => {
    simRef.current?.resetAllWeights();
    setWeightEdits({});
  }, []);

  // PR3：持续偏置输入（与点击脉冲不同：一直加到关掉或归零为止）。
  const handleBiasToggle = useCallback(() => {
    const sim = simRef.current;
    if (!sim || selectedId === null) return;
    const cur = biasMap[selectedId] ?? 0;
    if (cur !== 0) {
      sim.clearBias(selectedId);
      setBiasMap((prev) => {
        const next = { ...prev };
        delete next[selectedId];
        return next;
      });
    } else {
      sim.setBias(selectedId, BIAS_DEFAULT_ON);
      setBiasMap((prev) => ({ ...prev, [selectedId]: BIAS_DEFAULT_ON }));
    }
  }, [biasMap, selectedId]);
  const handleBiasChange = useCallback(
    (v: number): number => {
      const sim = simRef.current;
      if (!sim || selectedId === null) return 0;
      const stored = sim.setBias(selectedId, v); // 0 = 清除偏置
      setBiasMap((prev) => {
        const next = { ...prev };
        if (stored === 0) delete next[selectedId];
        else next[selectedId] = stored;
        return next;
      });
      return stored;
    },
    [selectedId],
  );

  // PR4：切换背景活动模式。只改 bg_mode（振荡档同时带上正弦参数），
  // 不动局部参数与旋钮值；引擎经 mode_applied 确认后，轮询会把
  // modeParams / bgMode 同步回来。
  const handleBackgroundMode = useCallback((mode: BackgroundMode) => {
    const sim = simRef.current;
    if (!sim || !simReady) return;
    setBgMode(mode);
    sim.setBackgroundMode(mode);
  }, [simReady]);

  // PR4：换随机种子。从下一刻起按新种子抽取（OU 与白噪声）；要从头
  // 按新种子重跑，请再点 RESET（reset 按 params.seed 重置 RNG）。
  const handleSeedChange = useCallback(
    (v: number) => {
      const sim = simRef.current;
      if (!sim || !simReady) return;
      const s = Math.max(0, Math.floor(v));
      setSeed(s);
      sim.setSeed(s);
    },
    [simReady],
  );

  // PR4：把快照恢复后的状态同步回界面（参数旋钮、权重修改、偏置、
  // 背景模式），并清掉属于恢复前轨迹的响应/回放数据。
  const syncFromSnapshot = useCallback(
    (summary: SnapshotSummary) => {
      const p = summary.params;
      setKStim(KNOB_MAP.stimulusK(p.stim_amplitude));
      setKDur(KNOB_MAP.durationK(p.stim_duration_ms));
      setKExcInh(KNOB_MAP.c_eiK(p.c_ei));
      setKConn(KNOB_MAP.gK(p.g));
      setBgMode(summary.mode);
      setModeParams(summary.modeParams);
      if (data) {
        const edits: Record<string, number> = {};
        summary.weights.forEach((row, i) => {
          row.forEach((w, j) => {
            const orig = data.connectivity.weights[i]?.[j];
            if (orig !== undefined && Math.abs(w - orig) > 1e-9) {
              edits[`${i},${j}`] = w;
            }
          });
        });
        setWeightEdits(edits);
      }
      const biases: Record<number, number> = {};
      summary.bias.forEach((v, node) => {
        if (v !== 0) biases[node] = v;
      });
      setBiasMap(biases);
      setReplay({
        active: false,
        playing: false,
        speed: 1,
        tMs: 0,
        baselineT_ms: null,
        windowT0_ms: null,
        windowT1_ms: null,
      });
      respSigRef.current = '';
      setResp({ baseline: null, baselineE: null, window: null, summary: null, groups: null });
      setHoldMs(null);
      setSnap(null);
    },
    [data],
  );

  const handleSaveSnapshot = useCallback(() => {
    const sim = simRef.current;
    if (!sim || !simReady) return;
    setSnapMsg('正在保存快照…');
    sim
      .saveSnapshot()
      .then((info) => {
        setSnapMsg(`快照已保存（仿真时间 ${(info.t_ms / 1000).toFixed(1)} s，存在浏览器 localStorage 里）`);
      })
      .catch(() => setSnapMsg('快照保存失败'));
  }, [simReady]);

  const handleRestoreSnapshot = useCallback(
    (id: 'manual' | 'auto') => {
      const sim = simRef.current;
      if (!sim || !simReady) return;
      setSnapMsg('正在恢复快照…');
      sim
        .restoreSnapshot(id)
        .then((summary) => {
          syncFromSnapshot(summary);
          setSnapMsg(
            id === 'auto'
              ? `已恢复到按住前状态（仿真时间 ${(summary.t_ms / 1000).toFixed(1)} s）`
              : `快照已恢复（仿真时间 ${(summary.t_ms / 1000).toFixed(1)} s）`,
          );
        })
        .catch(() => setSnapMsg('没有可恢复的快照'));
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
    setKExcInh(KNOB_MAP.c_eiK(DEFAULT_PARAMS.c_ei));
    setKConn(KNOB_MAP.gK(DEFAULT_PARAMS.g));
    sim?.setParams({ ...DEFAULT_PARAMS });
    sim?.reset();
    setSnap(null);
    setPaused(false);
    setSimError(null);
    setSelectedId(null);
    setHoldMs(null);
    // PR3 — RESET 的语义（界面上写明）：恢复仿真状态、清除刺激与偏置
    // 输入，但保留用户改过的连接权重；权重只能由恢复动作改回。
    // SimClient.reset() 已清引擎侧偏置，这里只清 App 侧的偏置状态。
    setBiasMap({});
    // 注意：这里刻意不碰 weightEdits、不调 resetAllWeights。
    // PR2：RESET 清掉视图回放与响应数据（基线、窗口、标记随之下一次刺激重建）。
    setReplay({
      active: false,
      playing: false,
      speed: 1,
      tMs: 0,
      baselineT_ms: null,
      windowT0_ms: null,
      windowT1_ms: null,
    });
    respSigRef.current = '';
    setResp({ baseline: null, baselineE: null, window: null, summary: null, groups: null });
    setResetSignal((n) => n + 1);
    // PR4：RESET 清掉自动快照（按住前状态已作废），手动快照保留；
    // 快照信息由轮询从 SimClient 重新读回。
    setSnapMsg(null);
  };

  // PR8-A：一键场景 S1–S3 的实时引擎动作（计划 §16.3）。等响应窗口
  // 填满（最后一条快照到达窗口末尾）再读数，不只等汇总第一次出现——
  // 汇总在窗口填满前就可能非空，那时读到的峰值会被低估（实测：提前读
  // 到 −0.0036，等满窗后同一脉冲峰值约 +0.48）。
  const waitResponseWindowFull = useCallback(async (prevBaselineT: number | null) => {
    const sim = simRef.current;
    if (!sim) throw new Error('仿真引擎未就绪');
    const deadline = Date.now() + 12000;
    let lastSeen = '无基线/窗口';
    while (Date.now() < deadline) {
      const b = sim.getBaseline();
      const w = sim.getLastResponseWindow();
      if (b && w) {
        const last = w.snapshots[w.snapshots.length - 1];
        lastSeen =
          `基线 t=${b.t_ms} ms（之前 ${prevBaselineT ?? '无'}）· 窗口基线 t=${w.baselineT_ms} ms · ` +
          `快照 ${w.snapshots.length} 条 · 末条 t=${last ? last.t_ms : '无'} ms · 窗口末尾 t1=${w.t1_ms} ms`;
      } else if (b) {
        lastSeen = `基线 t=${b.t_ms} ms（之前 ${prevBaselineT ?? '无'}）· 尚无响应窗口`;
      }
      if (
        b && w && b.t_ms !== prevBaselineT && w.baselineT_ms === b.t_ms &&
        w.snapshots.length > 0 &&
        w.snapshots[w.snapshots.length - 1].t_ms >= w.t1_ms - 16
      ) {
        return { baseline: b, window: w, summary: sim.getResponseSummary() };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`响应窗口未在 12 s 内填满（可到 RESPONSE 面板手工查看）。最后看到：${lastSeen}`);
  }, []);

  const peakDeltaEForNode = useCallback((node: number): number => {
    const sim = simRef.current;
    if (!sim) throw new Error('仿真引擎未就绪');
    const b = sim.getBaseline();
    const w = sim.getLastResponseWindow();
    if (!b || !w) throw new Error('暂无响应窗口');
    let peak = 0;
    for (const s of w.snapshots) {
      const d = s.e[node] - b.e[node];
      if (Math.abs(d) > Math.abs(peak)) peak = d;
    }
    return peak;
  }, []);

  const runLiveScenario = useCallback(
    async (id: number): Promise<{ keyNumbers: KeyNumber[]; note: string }> => {
      const sim = simRef.current;
      if (!sim || !simReady) throw new Error('仿真引擎未就绪（WASM 加载中或加载失败）');
      const prevBaselineT = sim.getBaseline()?.t_ms ?? null;
      if (id === 1) {
        handlePulse(40);
        const { summary } = await waitResponseWindowFull(prevBaselineT);
        return {
          keyNumbers: [
            { label: '40 号脑区峰值 ΔE', value: peakDeltaEForNode(40), unit: '' },
            { label: '响应脑区数', value: summary?.count ?? 0, unit: '个' },
          ],
          note: '脉冲 40 号脑区（真实引擎动作）；峰值 ΔE 见 RESPONSE 面板。',
        };
      }
      if (id === 2) {
        if (!data) throw new Error('脑数据未加载');
        const orig = data.connectivity.weights[73][54];
        handleWeightChange(73, 54, 0);
        handlePulse(73);
        try {
          const { summary } = await waitResponseWindowFull(prevBaselineT);
          return {
            keyNumbers: [
              { label: '73 号脑区峰值 ΔE（权重 0）', value: peakDeltaEForNode(73), unit: '' },
              { label: '响应脑区数', value: summary?.count ?? 0, unit: '个' },
              { label: '73→54 原始权重', value: orig, unit: '' },
            ],
            note: '73→54 权重改 0 后脉冲 73 号脑区；权重随后已恢复原始值。',
          };
        } finally {
          handleWeightReset(73, 54);
        }
      }
      if (id === 3) {
        sim.setParams({ c_ei: 6 });
        setKExcInh(KNOB_MAP.c_eiK(6));
        handlePulse(40);
        const { summary } = await waitResponseWindowFull(prevBaselineT);
        return {
          keyNumbers: [
            { label: '40 号脑区峰值 ΔE（c_ei=6）', value: peakDeltaEForNode(40), unit: '' },
            { label: '响应脑区数', value: summary?.count ?? 0, unit: '个' },
          ],
          note: 'c_ei 由 4.0 改为 6.0 后脉冲 40 号脑区；改完的 c_ei=6.0 留在 PARAMETERS 面板，可手动改回 4.0。',
        };
      }
      throw new RangeError(`runLiveScenario: no live path for scenario ${id}`);
    },
    [data, simReady, handlePulse, handleWeightChange, handleWeightReset, waitResponseWindowFull, peakDeltaEForNode],
  );

  // PR8-A：一键场景总入口（S1–S3 走实时引擎，S4–S15 走 runScenarioCompute）。
  // 每次运行追加一条实验记录；S4 的 Alpha 记录交给 WAVES 模式。
  const runScenarioById = useCallback(
    async (id: number) => {
      const def = getScenario(id);
      setScenarioError(null);
      setRunningScenarioId(id);
      const t0 = Date.now();
      try {
        if (def.needsLiveSim) {
          const live = await runLiveScenario(id);
          const rec: ExperimentRecord = {
            time: new Date().toISOString(),
            scenarioId: id,
            title: def.title,
            mode: def.mode,
            preset: def.preset,
            keyNumbers: live.keyNumbers,
            note: live.note,
            durationMs: Date.now() - t0,
            live: true,
          };
          setScenarioRecords((prev) => [...prev, rec]);
        } else {
          if (def.requiresFixture && !scenarioFixture) {
            throw new Error(
              '球形正向模型未加载：请先运行 scientific/forward/generate_sphere_model.py 生成 app/public/forward-assets/sphere-model.json',
            );
          }
          const r = runScenarioCompute(id, { fixture: scenarioFixture });
          if (r.alphaRecording) setWavesRecording(r.alphaRecording);
          setScenarioRecords((prev) => [...prev, scenarioResultToRecord(r, false)]);
        }
      } catch (e) {
        setScenarioError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunningScenarioId(null);
      }
    },
    [runLiveScenario, scenarioFixture],
  );

  // PR8-A：场景启动器里的“打开实验台”（仅导航；计算已在启动器里跑完）。
  const handleOpenLab = useCallback((target: LabTarget, eegTab?: EegLabTab) => {
    setShowScenarioLauncher(false);
    if (target === 'eeg') {
      setEegInitialTab(eegTab ?? 'eeg');
      setMode('eeg');
    } else if (target === 'head') {
      setShowHeadSphereLab(true);
    } else if (target === 'cellular') {
      setShowCellularLab(true);
    } else if (target === 'experiment') {
      setShowExperimentLab(true);
    } else if (target === 'dipole') {
      setShowDipoleLab(true);
    }
  }, []);

  const locked = snap?.locked ?? false;
  const simTimeS = snap ? (snap.t_ms / 1000).toFixed(1) : '0.0';

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">BRAIN PHYSICS</div>
        <div className="topbar-sub">PLAYGROUND · LIVE SIMULATION</div>
        <div className="topbar-controls">
          <div className="mode-switch" role="group" aria-label="模式">
            {APP_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip${mode === m ? ' chip-on' : ''}`}
                data-mode={m}
                aria-pressed={mode === m}
                onClick={() => setMode(transitionMode(mode, m))}
                title={MODE_DESCRIPTIONS[m]}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`chip${showMore ? ' chip-on' : ''}`}
            aria-pressed={showMore}
            onClick={() => setShowMore((v) => !v)}
            title="渐进式展示：默认只显示 3D 大脑、少量控制、实时测量窗口和简单说明；点“更多”展开具体参数、数学模型、单位、频段设置、电极参考、源定位算法与模型假设"
          >
            更多 {showMore ? '▲' : '▼'}
          </button>
          <button
            type="button"
            className={`chip${showScenarioLauncher ? ' chip-on' : ''}`}
            onClick={() => setShowScenarioLauncher(true)}
            title="一键科学场景：15 个可运行的预设实验，每个都跑真实计算并追加实验记录"
          >
            一键场景
          </button>
          <button
            type="button"
            className={`chip ${!paused && simReady ? 'chip-on' : ''}`}
            onClick={handlePlayPause}
            disabled={!simReady}
            title={simReady ? '暂停 / 继续仿真时钟（模型时间冻结，画面不动）' : '仿真引擎加载中…'}
          >
            PLAY — {simReady ? (paused ? '已暂停' : '运行中') : '加载中'}
          </button>
          <button
            type="button"
            className={`chip ${showConnections ? 'chip-on' : ''}`}
            onClick={() => setShowConnections((v) => !v)}
            title="显示 / 隐藏选中脑区的主要连接弧线"
          >
            CONNECT — {showConnections ? '显示' : '隐藏'}
          </button>
          <button type="button" className="chip" onClick={handleReset} title="恢复仿真状态、清除刺激与偏置输入；保留已改连接权重（权重只能用恢复动作改回）">
            RESET
          </button>
          <button type="button" className="chip" onClick={() => setShowHeadSphereLab(true)}
            title="MNE 四层球形头模型，源与标准电极产生实时模拟 EEG 电位">
            HEAD EEG
          </button>
          <button type="button" className="chip" onClick={() => setShowEegLab(true)}
            title="多导 EEG 实验：柱模型 → 球形正向模型 → 噪声，频谱 / ERP / 时频 / 地形 / 源定位共用同一份记录">
            EEG 分析
          </button>
          <button type="button" className="chip" onClick={() => setShowDipoleLab(true)}
            title="独立的均匀无限导体电流偶极子物理实验，不是 BEM EEG">
            DIPOLE LAB
          </button>
          <button type="button" className="chip" onClick={() => setShowCellularLab(true)}
            title="细胞级实验台：LIF、Hodgkin–Huxley、多房室神经元与跨尺度耦合（PR-13）">
            细胞实验
          </button>
          <button type="button" className="chip" onClick={() => setShowStimLab(true)}
            title="脑刺激实验室：TES/TMS 电场与感觉输入，按物理完备程度分级（PR-14）">
            刺激实验
          </button>
          <button type="button" className="chip" onClick={() => setShowExperimentLab(true)}
            title="对照实验：双脑 A/B、时间机器、闭环控制（PR-15）">
            对照实验
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => setShowModelInfo(true)}
            title="模型、数据来源与许可说明"
          >
            模型信息
          </button>
        </div>
      </header>

      {mode === 'eeg' ? (
        <main className="main main-eeg">
          <EegAnalysisLab
            inline
            initialTab={eegInitialTab}
            onClose={() => setMode('play')}
            liveSource={{
              sim: simRef.current,
              node: selectedId,
              regionLabel: selected?.label ?? null,
              positionMm: selected ? selected.centre : null,
            }}
          />
        </main>
      ) : (
      <main className="main">
        <section className="stage screen">
          <div className="screen-title">3D LIVE BRAIN</div>
          <div className="stage-tools">
            <button
              type="button"
              className={`chip chip-small ${colorMode === 'absolute' ? 'chip-on' : ''}`}
              onClick={() => setColorMode('absolute')}
              title="按兴奋活动 E 着色（固定色标：底色 E≈0.011 → 琥珀 E≈0.5）"
            >
              绝对活动 E
            </button>
            <button
              type="button"
              className={`chip chip-small ${colorMode === 'delta' ? 'chip-on' : ''}`}
              onClick={() => setColorMode('delta')}
              title="按活动变化 ΔE = E − 刺激前基线着色（升高琥珀、降低蓝色；平方根压缩，±0.1 满格）"
            >
              活动变化 ΔE
            </button>
            <button
              type="button"
              className={`chip chip-small ${autoRotate ? 'chip-on' : ''}`}
              onClick={() => setAutoRotate((v) => !v)}
              title="相机自动缓慢旋转（只是相机运动，不是神经活动）"
            >
              旋转 {autoRotate ? '开' : '关'}
            </button>
          </div>
          {snap && (snap.approaching_lock || locked) && (
            <div className={locked ? 'locked-banner' : 'hold-warning'}>
              {/* 按钮放最前面、横幅左贴边：按钮的横坐标只取决于横幅左边缘，
                  与横幅宽度无关。警告切到锁定横幅时文字变短、进度条消失，
                  横幅宽度会变；按钮放后面会被带着平移约 250px，按住中点它
                  时按下和松开落在不同元素上，click 事件根本不触发，
                  恢复也就不执行（H2/H5 的根因，探针实测点击事件 0 次，
                  而直接调恢复接口立刻恢复、平均 E 回到 0.015）。 */}
              <button
                type="button"
                className="chip chip-small"
                disabled={!snapInfo.auto}
                onClick={() => handleRestoreSnapshot('auto')}
                title="恢复到这次按住开始前的完整状态"
              >
                恢复到按住前
              </button>
              {locked && (
                <button type="button" className="chip chip-small" onClick={handleReset} title="恢复仿真状态">
                  RESET
                </button>
              )}
              {locked ? (
                <>网络进入了新的稳定状态（不是软件卡住）— 长时间持续输入使全网停在高活动态</>
              ) : (
                <>
                  <span>
                    按住输入中：全网活动正在上升（平均 E {snap.mean_e.toFixed(3)}，
                    离锁定阈值 0.15 还有 {Math.max(0, 1 - snap.lock_progress).toFixed(0)}%）——
                    松开即停；如果进入高活动稳定态，可一键恢复到按住前
                  </span>
                  <span
                    className="hold-progress"
                    role="progressbar"
                    aria-label="离锁定还有多远"
                    aria-valuenow={Math.round(snap.lock_progress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${Math.round(snap.lock_progress * 100)}%` }} />
                  </span>
                </>
              )}
            </div>
          )}
          {simError !== null && (
            <div className="stage-error">仿真异常：{simError}</div>
          )}
          {loadError !== null && (
            <div className="stage-error">脑数据加载失败：{loadError}</div>
          )}
          {data === null && loadError === null && (
            <div className="stage-loading">正在加载脑数据…</div>
          )}
          {data !== null && (
            <BrainScene
              data={data}
              autoRotate={autoRotate}
              showConnections={showConnections}
              selectedId={selectedId}
              resetSignal={resetSignal}
              onSelect={setSelectedId}
              sim={simRef.current}
              onPulse={handlePulse}
              onHoldStart={handleHoldStart}
              onHoldEnd={handleHoldEnd}
              onHoldRetract={handleHoldRetract}
              colorMode={colorMode}
              baselineE={resp.baselineE}
              replayE={replayE}
              responseGroups={resp.summary ? resp.groups : null}
              biasList={biasList}
            />
          )}
        </section>

        <aside className="panels">
          <section className="screen panel live-panel">
            <div className="screen-title">LIVE ACTIVITY</div>
            <ActivityChart
              sim={simRef.current}
              selectedId={selectedId}
              resetSignal={resetSignal}
              replay={
                replay.active
                  ? { active: true, tMs: replay.tMs, speed: replay.speed, window: resp.window }
                  : null
              }
            />
          </section>

          {mode === 'waves' && (
            <section className="screen panel waves-panel">
              <div className="screen-title">WAVES · 频段 / PSD</div>
              <div className="panel-body">
                <p className="panel-text">
                  Alpha 探索 = JR p0=220 极限环（自发节律，实测峰 ~10.99 Hz）。
                  先运行场景 4 生成一条 Pz 记录，再看频谱——频段功率全部来自同一份记录的同一通道。
                </p>
                <button
                  type="button"
                  className="chip chip-small"
                  disabled={runningScenarioId === 4}
                  onClick={() => runScenarioById(4)}
                  title="运行一键场景 4：JR p0=220 极限环跑 12 s，生成 Pz 记录供下方的 WavesTab 分析"
                >
                  {runningScenarioId === 4 ? '运行中…' : '运行场景 4：产生 Alpha 记录'}
                </button>
                {scenarioError && <p className="panel-text">{scenarioError}</p>}
                <WavesTab recording={wavesRecording} channel="Pz" />
              </div>
            </section>
          )}
          {mode === 'explore' && (
            <section className="screen panel explore-panel">
              <div className="screen-title">EXPLORE · 解剖 / 图谱 / 坐标</div>
              <div className="panel-body">
                <ExplorePanel
                  data={data}
                  selectedRegionId={selectedId}
                  onSelectRegion={setSelectedId}
                  onOpenCellular={() => setShowCellularLab(true)}
                />
                <p className="panel-text">
                  场景 13 可生成独立 Hodgkin–Huxley 演示摘要。进入细胞实验后需重新运行；
                  场景摘要尚未自动载入实验台（统一实验会话将在 P0-2 实现）。
                </p>
              </div>
            </section>
          )}
          {mode === 'play' && (
          <section className="screen panel response-panel">
            <div className="screen-title">刺激响应 · RESPONSE</div>
            <div className="panel-body">
              <div className="view-toggle" role="group" aria-label="着色视图">
                <button
                  type="button"
                  className={`chart-toggle ${colorMode === 'absolute' ? 'chart-toggle-on' : ''}`}
                  onClick={() => setColorMode('absolute')}
                >
                  绝对活动 E
                </button>
                <button
                  type="button"
                  className={`chart-toggle ${colorMode === 'delta' ? 'chart-toggle-on' : ''}`}
                  onClick={() => setColorMode('delta')}
                >
                  活动变化 ΔE
                </button>
              </div>
              {colorMode === 'absolute' ? (
                <p className="panel-text">
                  绝对活动：按兴奋活动 E 着色，固定色标——底色 E≈0.011 → 琥珀 E≈0.5。
                </p>
              ) : (
                <p className="panel-text">
                  活动变化：ΔE = E − 刺激前一刻的基线。升高为琥珀、降低为蓝色，0 为底色。
                  色标为平方根压缩、±{DELTA_FULL.toFixed(1)} 满格——ΔE +0.01 约占 32%
                  色深，+0.05 约占 71%，被刺激脑区约 +0.48 满格；远端 0.01–0.05
                  的小变化不会被抹掉。无刺激时 ΔE 接近零。
                </p>
              )}
              <p className="panel-text">
                {resp.baseline === null || baselineRegion === null
                  ? '尚未刺激 — 点击大脑触发一次刺激后，这里显示基线与响应。'
                  : `基线：刺激前 t=${(resp.baseline.t_ms / 1000).toFixed(2)} s · ${baselineRegion.label} #${resp.baseline.node}。窗口：基线前 500 ms 至刺激后约 2 s 的真实快照。`}
              </p>

              <div className="conn-title">回放 · REPLAY</div>
              {resp.window === null ? (
                <p className="panel-text">还没有可回放的响应窗口，先刺激一次。</p>
              ) : (
                <>
                  <div className="replay-controls">
                    {!replay.active ? (
                      <button
                        type="button"
                        className="chip chip-small replay-play"
                        onClick={startReplay}
                        disabled={!replayReady}
                        title="从窗口起点回放录下来的快照（不重算）"
                      >
                        回放响应窗口
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="chip chip-small replay-play"
                        onClick={() =>
                          setReplay((prev) => ({ ...prev, playing: !prev.playing }))
                        }
                      >
                        {replay.playing ? '暂停' : '继续播放'}
                      </button>
                    )}
                    <span className="replay-speeds" role="group" aria-label="回放速度">
                      {([1, 0.5, 0.25] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`chart-toggle replay-speed ${replay.active && replay.speed === s ? 'chart-toggle-on' : ''}`}
                          disabled={!replay.active}
                          onClick={() => setReplay((prev) => ({ ...prev, speed: s }))}
                        >
                          {s}×
                        </button>
                      ))}
                    </span>
                    {replay.active && (
                      <button type="button" className="chip chip-small replay-live" onClick={stopReplay}>
                        回到直播
                      </button>
                    )}
                  </div>
                  <input
                    type="range"
                    className="replay-seek"
                    aria-label="回放进度"
                    min={resp.window.t0_ms}
                    max={resp.window.t1_ms}
                    step={16}
                    value={replay.active ? replay.tMs : resp.window.t1_ms}
                    disabled={!replay.active}
                    onChange={(e) =>
                      setReplay((prev) => ({ ...prev, tMs: Number(e.target.value) }))
                    }
                  />
                  <p className="panel-text mono">
                    {replay.active
                      ? `回放 ${replay.speed}× · ${((replay.tMs - resp.window.t0_ms) / 1000).toFixed(2)} / ${((resp.window.t1_ms - resp.window.t0_ms) / 1000).toFixed(2)} s · 录制快照 ${resp.window.snapshots.length} 条`
                      : `窗口 ${((resp.window.t1_ms - resp.window.t0_ms) / 1000).toFixed(2)} s · 录制快照 ${resp.window.snapshots.length} 条（仍在随仿真推进填满）`}
                  </p>
                  <p className="panel-text panel-foot">
                    回放只改变观看速度，不改变物理方程；3D 着色与波形都读同一份录制快照。
                  </p>
                </>
              )}

              <div className="conn-title">响应脑区（阈值 max|ΔE| ≥ {RESPONSE_THRESHOLD}）</div>
              {resp.summary === null ? (
                <p className="panel-text">尚未刺激，暂无响应列表。</p>
              ) : resp.summary.count === 0 ? (
                <p className="panel-text">
                  刺激后窗口内没有脑区超过阈值 {RESPONSE_THRESHOLD}（共 0 个响应）。
                </p>
              ) : (
                <>
                  <p className="panel-text">
                    共 {resp.summary.count} 个响应脑区，按峰值 |ΔE| 从大到小排；点击一行选中该脑区。
                  </p>
                  <div className="marker-legend">
                    <span><i className="dot dot-input" />琥珀色环 — 输入位置（刺激点）</span>
                    <span><i className="dot dot-local" />琥珀实心 — 局部响应（被刺激的脑区）</span>
                    <span><i className="dot dot-network" />蓝色小点 — 网络响应（其他响应脑区）</span>
                  </div>
                  {resp.groups !== null && resp.groups.local.length > 0 && (
                    <>
                      <div className="resp-group-title">局部响应</div>
                      <ul className="resp-list">
                        {resp.summary.responders
                          .filter((r) => resp.groups?.local.includes(r.node))
                          .map((r) => (
                            <li key={r.node}>
                              <button
                                type="button"
                                className="resp-row"
                                data-node={r.node}
                                onClick={() => setSelectedId(r.node)}
                              >
                                <span className="conn-label">
                                  {data?.regions[r.node].label} #{r.node}
                                </span>
                                <span className="conn-nums">
                                  峰值 ΔE {(r.peakDeltaE >= 0 ? '+' : '') + r.peakDeltaE.toFixed(3)}
                                </span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    </>
                  )}
                  {resp.groups !== null && resp.groups.network.length > 0 && (
                    <>
                      <div className="resp-group-title">网络响应</div>
                      <ul className="resp-list">
                        {resp.summary.responders
                          .filter((r) => resp.groups?.network.includes(r.node))
                          .map((r) => (
                            <li key={r.node}>
                              <button
                                type="button"
                                className="resp-row"
                                data-node={r.node}
                                onClick={() => setSelectedId(r.node)}
                              >
                                <span className="conn-label">
                                  {data?.regions[r.node].label} #{r.node}
                                </span>
                                <span className="conn-nums">
                                  峰值 ΔE {(r.peakDeltaE >= 0 ? '+' : '') + r.peakDeltaE.toFixed(3)}
                                </span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          </section>
          )}

          {mode === 'play' && showMore && (
          <section className="screen panel background-panel">
            <div className="screen-title">背景活动 · BACKGROUND</div>
            <div className="panel-body">
              <div className="view-toggle" role="group" aria-label="背景活动模式">
                {(
                  [
                    ['quiet', '安静 Quiet'],
                    ['spontaneous', '自发 Spontaneous'],
                    ['oscillatory', '振荡 Oscillatory'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`chart-toggle ${bgMode === mode ? 'chart-toggle-on' : ''}`}
                    disabled={!simReady}
                    onClick={() => handleBackgroundMode(mode)}
                    title={
                      mode === 'quiet'
                        ? '安静基线：无背景输入，与改版前行为完全一致'
                        : mode === 'spontaneous'
                          ? '自发背景：每脑区持续收到 Ornstein–Uhlenbeck 背景输入，活动来自模型计算'
                          : '振荡：10 Hz 正弦外部驱动（明确标注的外部驱动信号，不是自发节律）'
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {bgMode === 'quiet' && (
                <p className="panel-text">
                  安静基线：无背景输入，什么都不做时大脑基本静止（平均 E ≈
                  0.011）。与改版前行为完全一致。
                </p>
              )}
              {bgMode === 'spontaneous' && (
                <p className="panel-text">
                  自发背景：每个脑区持续收到 Ornstein–Uhlenbeck 背景输入
                  （相关时间 τ = {modeParams ? modeParams.ou_tau_ms.toFixed(0) : '—'} ms，
                  幅度 σ = {modeParams ? modeParams.ou_sigma.toFixed(2) : '—'} 模型单位
                  P），活动来自模型计算，不是装饰闪烁。同一随机种子重跑，
                  活动序列逐值相同。
                </p>
              )}
              {bgMode === 'oscillatory' && (
                <p className="panel-text">
                  振荡（外部驱动）：{modeParams ? modeParams.ext_sine_freq_hz.toFixed(0) : '—'} Hz
                  正弦外部驱动（幅度{' '}
                  {modeParams ? modeParams.ext_sine_amp.toFixed(2) : '—'} 模型单位
                  P），全脑同相。注意：这是明确标注的外部驱动信号，不是自发节律——
                  本 Wilson–Cowan 参数族里没有稳定的自发极限环（已扫描验证，见模型信息）。
                </p>
              )}
              <p className="panel-text">
                三种输入的关系：背景是持续输入（本面板）；偏置是你对选中脑区施加的
                持续输入（REGION 面板）；脉冲是一次性输入（点击）。三者叠加进同一个 P。
              </p>
              <div className="seed-row">
                <label htmlFor="bg-seed">随机种子</label>
                <input
                  id="bg-seed"
                  type="number"
                  className="edge-number mono"
                  aria-label="随机种子"
                  min={0}
                  step={1}
                  value={seed}
                  disabled={!simReady}
                  title="换种子后从下一刻起按新种子抽取；要点 RESET 才能从头按新种子重跑"
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v)) handleSeedChange(v);
                  }}
                />
                <span className="panel-text mono">种子 {seed} · 同种子重跑逐值相同</span>
              </div>
              <div className="conn-title">实验快照 · SNAPSHOT</div>
              <p className="panel-text">
                快照保存当前完整实验状态（参数、全部 76×76 权重、偏置、仿真时间、
                随机种子与 RNG 状态、OU 状态、E/I、延迟历史），恢复后继续跑的轨迹
                与不恢复完全一致。
              </p>
              <div className="snapshot-controls">
                <button
                  type="button"
                  className="chip chip-small"
                  disabled={!simReady}
                  onClick={handleSaveSnapshot}
                  title="手动保存当前状态到浏览器 localStorage（关掉页面还在，RESET 不清）"
                >
                  保存快照
                </button>
                <button
                  type="button"
                  className="chip chip-small"
                  disabled={!simReady || !snapInfo.manual}
                  onClick={() => handleRestoreSnapshot('manual')}
                  title="恢复手动保存的快照"
                >
                  恢复手动快照
                </button>
                <button
                  type="button"
                  className="chip chip-small"
                  disabled={!simReady || !snapInfo.auto}
                  onClick={() => handleRestoreSnapshot('auto')}
                  title="恢复这次按住开始前的状态"
                >
                  恢复到按住前
                </button>
              </div>
              <p className="panel-text mono">
                {snapInfo.manual
                  ? `手动快照：仿真时间 ${(snapInfo.manual.t_ms / 1000).toFixed(1)} s · 存在 localStorage 里`
                  : '手动快照：尚未保存'}
                <br />
                {snapInfo.auto
                  ? `自动快照：仿真时间 ${(snapInfo.auto.t_ms / 1000).toFixed(1)} s · 只在内存里，按住开始时自动存，RESET 时清掉，绝不覆盖手动快照`
                  : '自动快照：尚未按住（按住开始时自动存按住前状态）'}
              </p>
              {snapMsg !== null && <p className="panel-text">{snapMsg}</p>}
              <p className="panel-text panel-foot">
                点击与按住的区分：静止按住 300 ms 触发持续输入；移动超过 6 px
                视为拖动（旋转），不触发刺激；一次短于 300 ms 的点击即使在慢机器上
                也不会变成按住。
              </p>
            </div>
          </section>
          )}

          {mode === 'play' && showMore && (
          <section className="screen panel">
            <div className="screen-title">PARAMETERS</div>
            <div className="params params-live">
              <ParamControl
                name="STIMULUS"
                note="刺激强度"
                k={kStim}
                defaultK={KNOB_MAP.stimulusK(DEFAULT_PARAMS.stim_amplitude)}
                displayText={KNOB_MAP.stimulusAmplitude(kStim).toFixed(2)}
                inputText={KNOB_MAP.stimulusAmplitude(kStim).toFixed(2)}
                modelText={`幅度 ${KNOB_MAP.stimulusAmplitude(kStim).toFixed(2)} · 0.5–2.0`}
                min={0.5}
                max={2.0}
                inputStep={0.01}
                toK={KNOB_MAP.stimulusK}
                disabled={!simReady}
                onChange={(k) => {
                  setKStim(k);
                  simRef.current?.setParams({ stim_amplitude: KNOB_MAP.stimulusAmplitude(k) });
                }}
              />
              <ParamControl
                name="DURATION"
                note="持续时间"
                k={kDur}
                defaultK={KNOB_MAP.durationK(DEFAULT_PARAMS.stim_duration_ms)}
                displayText={`${Math.round(KNOB_MAP.durationMs(kDur))} MS`}
                inputText={`${Math.round(KNOB_MAP.durationMs(kDur))}`}
                modelText={`脉冲 ${Math.round(KNOB_MAP.durationMs(kDur))} ms · 20–500`}
                min={20}
                max={500}
                inputStep={1}
                toK={KNOB_MAP.durationK}
                disabled={!simReady}
                onChange={(k) => {
                  setKDur(k);
                  simRef.current?.setParams({ stim_duration_ms: KNOB_MAP.durationMs(k) });
                }}
              />
              <ParamControl
                name="EXC / INH"
                note="兴奋 / 抑制"
                k={kExcInh}
                defaultK={KNOB_MAP.c_eiK(DEFAULT_PARAMS.c_ei)}
                displayText={KNOB_MAP.c_ei(kExcInh).toFixed(1)}
                inputText={KNOB_MAP.c_ei(kExcInh).toFixed(1)}
                modelText={`c_ei = ${KNOB_MAP.c_ei(kExcInh).toFixed(1)} · 3–8`}
                min={3}
                max={8}
                inputStep={0.1}
                toK={KNOB_MAP.c_eiK}
                disabled={!simReady}
                onChange={(k) => {
                  setKExcInh(k);
                  simRef.current?.setParams({ c_ei: KNOB_MAP.c_ei(k) });
                }}
              />
              <ParamControl
                name="CONNECTIVITY"
                note="连接强度"
                k={kConn}
                defaultK={KNOB_MAP.gK(DEFAULT_PARAMS.g)}
                displayText={KNOB_MAP.g(kConn).toFixed(2)}
                inputText={KNOB_MAP.g(kConn).toFixed(2)}
                modelText={`G ${KNOB_MAP.g(kConn).toFixed(2)} · 0–0.4`}
                min={0}
                max={0.4}
                inputStep={0.01}
                toK={KNOB_MAP.gK}
                disabled={!simReady}
                onChange={(k) => {
                  setKConn(k);
                  simRef.current?.setParams({ g: KNOB_MAP.g(k) });
                }}
              />
            </div>
            <p className="panel-text panel-foot">
              {simReady
                ? '参数控件已接入 Wilson–Cowan 引擎 · 改动从下一步仿真开始生效'
                : '仿真引擎加载中，参数暂不可用…'}
            </p>
          </section>
          )}

          {mode === 'play' && showMore && (
          <section className="screen panel region-panel">
            <div className="screen-title">REGION / CONNECTION</div>
            <div className="panel-body">
              {selected === null || data === null ? (
                <p className="panel-text">点击大脑选择一个脑区，查看名称与主要连接。</p>
              ) : (
                <>
                  <div className="region-name">{selected.label}</div>
                  <dl className="region-facts">
                    <div>
                      <dt>编号</dt>
                      <dd>#{selected.id} / 76</dd>
                    </div>
                    <div>
                      <dt>中心坐标</dt>
                      <dd>
                        {selected.centre.map((v) => v.toFixed(1)).join(', ')} mm
                      </dd>
                    </div>
                    <div>
                      <dt>皮层面积</dt>
                      <dd>{selected.area_mm2.toFixed(1)} mm²</dd>
                    </div>
                    <div>
                      <dt>兴奋活动 E</dt>
                      <dd>{selectedE !== null ? selectedE.toFixed(3) : '—'}</dd>
                    </div>
                    <div>
                      <dt>抑制活动 I</dt>
                      <dd>{selectedI !== null ? selectedI.toFixed(3) : '—'}</dd>
                    </div>
                    <div>
                      <dt>外部输入 P</dt>
                      <dd>{selectedP !== null ? selectedP.toFixed(2) : '—'}</dd>
                    </div>
                    {selectedBias !== 0 && (
                      <div>
                        <dt>持续偏置</dt>
                        <dd>
                          {selectedBias > 0 ? '兴奋' : '抑制'} {selectedBias >= 0 ? '+' : ''}
                          {selectedBias.toFixed(2)}（持续输入，非脉冲）
                        </dd>
                      </div>
                    )}
                    {holdMs !== null && (
                      <div>
                        <dt>按住输入中</dt>
                        <dd>{(holdMs / 1000).toFixed(1)} s · 松开即停</dd>
                      </div>
                    )}
                  </dl>
                  <div className="conn-title">主要连接（按权重前 5）· 可编辑</div>
                  {connections.length === 0 ? (
                    <p className="panel-text">该脑区无权重 &gt; 0 的连接。</p>
                  ) : (
                    <>
                      <ul className="weight-list">
                        {connections.map((c) => {
                          const orig = c.weight;
                          const key = `${selectedId},${c.target.id}`;
                          const cur = weightEdits[key] ?? orig;
                          const modified = Math.abs(cur - orig) > 1e-9;
                          return (
                            <li
                              key={c.target.id}
                              className="weight-item"
                              data-edge={`${selectedId}-${c.target.id}`}
                            >
                              <div className="weight-line">
                                <span className="conn-label">
                                  {c.target.label} → {selected.label}
                                </span>
                                <span className="conn-nums">{c.lengthMm.toFixed(1)} MM</span>
                                {modified && <span className="weight-badge">已修改</span>}
                              </div>
                              <ValueSlider
                                label={`${c.target.label} 到 ${selected.label} 的连接权重`}
                                value={cur}
                                min={WEIGHT_MIN}
                                max={WEIGHT_MAX}
                                step={0.05}
                                defaultValue={orig}
                                decimals={3}
                                disabled={!simReady}
                                onChange={(w) =>
                                  // 此分支已保证 selected !== null，从而 selectedId !== null。
                                  handleWeightChange(selectedId!, c.target.id, w)
                                }
                              />
                              <div className="weight-sub mono">
                                当前 {cur.toFixed(3)} · 原始 {orig.toFixed(3)}
                                {modified && (
                                  <button
                                    type="button"
                                    className="chip chip-small weight-restore"
                                    onClick={() =>
                                      // 此分支已保证 selectedId !== null。
                                      handleWeightReset(selectedId!, c.target.id)
                                    }
                                  >
                                    恢复原始值
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      {modifiedWeightCount > 0 && (
                        <button
                          type="button"
                          className="chip chip-small weight-restore-all"
                          onClick={handleWeightResetAll}
                        >
                          恢复全部原始值（{modifiedWeightCount} 条已改）
                        </button>
                      )}
                      <p className="panel-text panel-foot">
                        权重范围 0–3，越界自动 clamp 到边界。单边修改：只改「来源脑区
                        → 选中脑区」这一方向，不改反向；TVB 原始矩阵基本对称但不完全对称
                        （最大差 3.0）。RESET 恢复仿真状态，但保留已改权重；权重只能用恢复
                        动作改回。当前权重可能已被用户修改，不再是 TVB 原始数据。
                      </p>
                    </>
                  )}
                  <div className="conn-title">持续偏置输入 · BIAS（不是点击脉冲）</div>
                  <p className="panel-text">
                    持续偏置：加到 Wilson–Cowan 输入项上的持续量，开着就一直生效，
                    直到关掉或归零；与「点击刺激」脉冲不同——脉冲只持续 20–500 ms。
                    范围 −1.0–+1.0，开启默认值 +0.50。正值兴奋（抬高该脑区 E），
                    负值抑制（压低 E）。3D 图中以紫色八面体标记（与脉冲的琥珀色环不同）。
                  </p>
                  <div className="bias-controls">
                    <button
                      type="button"
                      className={`chip chip-small ${selectedBias !== 0 ? 'chip-on' : ''}`}
                      disabled={!simReady}
                      onClick={handleBiasToggle}
                    >
                      偏置 {selectedBias !== 0 ? '开' : '关'}
                    </button>
                    <span className="panel-text mono">
                      当前：
                      {selectedBias === 0
                        ? '无偏置'
                        : `${selectedBias > 0 ? '兴奋' : '抑制'} ${selectedBias >= 0 ? '+' : ''}${selectedBias.toFixed(2)}`}
                    </span>
                  </div>
                  {selectedBias !== 0 && (
                    <div className="bias-slider">
                      <ValueSlider
                        label={`${selected.label} 持续偏置`}
                        value={selectedBias}
                        min={BIAS_MIN}
                        max={BIAS_MAX}
                        step={0.05}
                        defaultValue={BIAS_DEFAULT_ON}
                        decimals={2}
                        disabled={!simReady}
                        onChange={handleBiasChange}
                      />
                    </div>
                  )}
                  <p className="panel-text panel-foot">
                    连接线为结构连接示意，不是白质纤维追踪结果。
                    权重单位 au，长度单位 mm。
                  </p>
                </>
              )}
            </div>
          </section>
          )}

          {mode === 'play' && !showMore && (
            <section className="screen panel more-panel">
              <div className="screen-title">更多</div>
              <div className="panel-body">
                <p className="panel-text">
                  具体参数、数学模型、单位、背景活动、脑区与连接细节收在这里。
                  点“更多”展开；顶栏的“更多”开关也能开合。
                </p>
                <button
                  type="button"
                  className="chip chip-small"
                  onClick={() => setShowMore(true)}
                >
                  展开更多：参数、背景活动、脑区与连接
                </button>
              </div>
            </section>
          )}
        </aside>
      </main>
      )}

      <footer className="bottombar">
        <span>点击刺激 · 按住持续输入 · 拖动旋转 · 滚轮缩放 · 双击背景恢复视角</span>
        <span className="bottombar-mid">
          {locked ? '网络进入了新的稳定状态 — 可恢复到按住前' : 'LIVE SIMULATION · WILSON–COWAN'}
        </span>
        <span className="mono">TIME {simTimeS} S</span>
      </footer>

      {showScenarioLauncher && (
        <ScenarioLauncher
          onClose={() => setShowScenarioLauncher(false)}
          records={scenarioRecords}
          onClearRecords={() => setScenarioRecords([])}
          runningId={runningScenarioId}
          runError={scenarioError}
          onRunScenario={runScenarioById}
          onOpenLab={handleOpenLab}
          fixtureReady={scenarioFixture !== null}
          fixtureError={scenarioFixtureError}
        />
      )}
      {showHeadSphereLab && <HeadSphereLab onClose={() => setShowHeadSphereLab(false)} onOpenReal={() => {
        setShowHeadSphereLab(false);
        setShowLocalBEM(true);
      }} liveSource={selected && liveMomentNAm !== null ? { positionMm: selected.centre, momentNAm: liveMomentNAm, regionLabel: selected.label, regionId: selected.id } : null} />}
      {showEegLab && (
        <EegAnalysisLab
          onClose={() => setShowEegLab(false)}
          liveSource={{
            sim: simRef.current,
            node: selectedId,
            regionLabel: selected?.label ?? null,
            positionMm: selected ? selected.centre : null,
          }}
        />
      )}
      {showLocalBEM && <LocalBEMLab onClose={() => setShowLocalBEM(false)} />}
      {showDipoleLab && (
        <DipoleLab
          onClose={() => setShowDipoleLab(false)}
          liveSource={selected && liveMomentNAm !== null ? { positionMm: selected.centre, momentNAm: liveMomentNAm, regionLabel: selected.label, regionId: selected.id } : null}
        />
      )}
      {showCellularLab && (
        <div className="modal-backdrop" onClick={() => setShowCellularLab(false)}>
          <div
            className="modal screen eeg-lab-modal"
            role="dialog"
            aria-label="细胞级实验"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="screen-title" style={{ display: 'flex', justifyContent: 'space-between', right: 0, pointerEvents: 'auto' }}>
              PR-13 · CELLULAR LAB
              <button className="chip chip-small" type="button" onClick={() => setShowCellularLab(false)}>关闭</button>
            </div>
            <div className="modal-body">
              <CellularLab
                liveE={selectedE}
                liveP={selectedP}
                regionLabel={selected?.label ?? null}
                regionId={selectedId}
                onApplyBias={handleBiasChange}
              />
            </div>
          </div>
        </div>
      )}
      {showStimLab && (
        <StimLab
          onClose={() => setShowStimLab(false)}
          selectedRegion={selected ? { id: selected.id, label: selected.label, centre: selected.centre } : null}
          regions={data ? data.regions : null}
          onPulse={(node, amp, dur) => simRef.current?.pulseAt(node, amp, dur)}
        />
      )}
      {showExperimentLab && (
        <div className="modal-backdrop" onClick={() => setShowExperimentLab(false)}>
          <div
            className="modal screen eeg-lab-modal"
            role="dialog"
            aria-label="对照实验"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="screen-title" style={{ display: 'flex', justifyContent: 'space-between', right: 0, pointerEvents: 'auto' }}>
              PR-15 · EXPERIMENT LAB
              <button className="chip chip-small" type="button" onClick={() => setShowExperimentLab(false)}>关闭</button>
            </div>
            <div className="modal-body">
              {expFixtureError && (
                <p className="panel-text" style={{ color: '#ffb340' }}>
                  球形正向模型未加载（{expFixtureError}）：源定位对照不可用，双脑数值比较与时间机器、闭环照常可用。
                </p>
              )}
              <ExperimentLab
                fixture={expFixture}
                onClose={() => setShowExperimentLab(false)}
                live={{
                  sim: simRef.current,
                  node: selectedId,
                  label: selected?.label ?? null,
                  positionMm: selected ? selected.centre : null,
                }}
              />
            </div>
          </div>
        </div>
      )}
      {showModelInfo && (
        <div className="modal-backdrop" onClick={() => setShowModelInfo(false)}>
          <div
            className="modal screen"
            role="dialog"
            aria-label="模型信息"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="screen-title">模型信息 — 这是什么</div>
            <div className="modal-body">
              <div className="conn-title">连接组 · Demo Connectome（演示用连接组）</div>
              <p className="panel-text">
                76 区连接矩阵来自 The Virtual Brain 示例数据 connectivity_76。
                权重主要来自猕猴 CoCoMac 神经示踪数据；胼胝体连接是人类 DSI
                纤维束宽度缩放后填入的双半球混合矩阵；皮层下结构未包含。
                这不是某个真人的 MRI / 扩散 MRI 测得的个体化连接网络。
                TVB 官方声明：该数据集“为数值测试与理论探索定制，
                生物物理真实性有限，不应以此为依据”。
              </p>
              <div className="conn-title">直接操纵 · 当前权重可能已被修改</div>
              <p className="panel-text">
                连接权重可编辑：选中脑区的主要连接可逐条改权重（0–3，单边：
                只改来源脑区 → 选中脑区的方向，不改反向）。改过的权重标「已修改」
                并与 TVB 原始值并列显示，可单条或全部恢复。RESET 恢复仿真状态，
                但保留已改权重；当前权重可能已被用户修改，不再是 TVB 原始数据。
              </p>
              <p className="panel-text">
                持续偏置输入：对选中脑区可加持续的正（兴奋）/负（抑制）偏置
                （−1–+1，开启默认 +0.50），加到 Wilson–Cowan 输入项上直到关掉
                或归零；与点击脉冲不同。RESET 清除偏置输入。刺激标记画在鼠标
                实际触碰的皮层表面点上，不再是脑区中心。
              </p>
              <div className="conn-title">皮层网格</div>
              <p className="panel-text">
                16,384 顶点皮层网格同样来自 TVB 示例数据 cortex_16384，
                与连接矩阵配套对齐。
              </p>
              <div className="conn-title">模型 · 最终定位：教学仿真</div>
              <p className="panel-text">
                Wilson–Cowan 兴奋 / 抑制神经群体模型，是神经群体平均活动的
                现象学模型，不是第一性原理求解器。这里模拟的是该模型在上述
                演示连接组上的行为，不代表真实人脑的客观反应。
              </p>
              <p className="panel-text">
                最终定位（PR8）：教学仿真。本产品的全部 EEG / ERP 输出均为
                未校准的模型演示，不是真实人脑的预测、不是临床测量、不是
                个体脑电的复现。未校准的模型结果不得在任何一处被表述为真实
                人脑参数或真实人脑预测。
              </p>
              <div className="conn-title">已知限制 · 实测数字（公开 EEG 约束 ds003061 sub-001 run-1）</div>
              <p className="panel-text">
                幅度缺口：oddball P300 峰值模型 0.174 µV @352 ms vs 真实
                8.89 µV @410 ms，差 51 倍。300–500 ms 窗内均值模型 0.070 µV
                vs 真实 6.94 µV，差 99 倍；差异波峰 0.166 vs 9.14 µV，差
                55 倍。形态与潜伏期已修好（oddball 选择性 8.1×、峰在窗内），
                幅度没修好：调增益只会把柱子推上锁存分支，峰值天花板约
                0.21 µV。
              </p>
              <p className="panel-text">
                基线 RMS 仍为 0：模型刺激前 RMS 0 vs 真实 Pz 6.07 µV；JR
                p0=220 极限环 Pz RMS 0.017 µV，差约 360 倍。Alpha 功率占比
                虚高：纯极限环 99.8% vs 真实 Pz 30.3% / Oz 69.3%（模型缺宽带
                背景；频率对上量级，10.99 vs 10.00 Hz，占比数字不能直接比）。
              </p>
              <p className="panel-text">
                源定位深度偏置：无噪声深源 plain 55.43 → dSPM 0.00 mm，但浅源
                dSPM 变坏到 55.43 mm；有噪声深源 depth 96.00 mm 比 plain
                78.38 mm 更差——没有一种方法同时修好深浅两端。MNE 峰值幅度被
                压缩：真值 10 nA·m 时峰值只有 0.36–5.26 nA·m（λ²=1/9 时为真值
                的 4–53%），不得把峰值读作真值幅度。偶极矩假设链（N=1,000,000、
                c=0.08、200/100 pA、0.5 mm）全是假设、未校准，幅度与绝对 µV
                值没有任何实测约束。
              </p>
              <div className="conn-title">默认预设</div>
              <p className="panel-text">
                演示预设为 TVB A-set 只改 θ_e（0 → 1.0），全局耦合 G = 0.35。
                纯 A-set 本身是双稳态的，保留在代码里作参考配置。
              </p>
              <div className="conn-title">背景活动 · 三档（PR4）</div>
              <p className="panel-text">
                安静（Quiet）：无背景输入，与改版前行为完全一致。默认是自发
                （Spontaneous）：每脑区持续收到 Ornstein–Uhlenbeck 背景输入，
                相关时间 τ = 100 ms、幅度 σ = 0.10（模型单位 P），OU 状态在
                引擎内每步更新一次；同一随机种子（默认 0）重跑，活动序列逐值相同。
                默认参数下连续运行 60 秒仿真时间不锁死、不发散（三个种子实测
                最大平均 E ≤ 0.017，锁定阈值 0.15；演示脑区 40 的标准脉冲在
                三个种子 × 八个点击时刻上 24 次全部恢复，节点活动标准差中位数
                约 0.002）。但要注意：翻转概率取决于被点脑区——Quiet 下
                （零背景）脑区 0/10/20/30/54/55/59/60 的标准脉冲同样会把全网
                翻进高活动态（网络本身双稳态，PR4 之前就有），背景只多加了
                一个边界脑区 69（约一半点击翻转）。锁住后横幅上有 RESET 一键恢复。
              </p>
              <p className="panel-text">
                振荡（Oscillatory）：10 Hz 正弦外部驱动（幅度 0.30，全脑同相），
                实测平均 E 在 0.0113–0.0211 之间以 10.00 Hz 振荡（FFT 峰值），
                60 秒最大平均 E 0.021，脉冲叠加其上仍有完整响应（峰值 |ΔE| 0.48，
                之后回到基线；四个正弦相位上点击都恢复）。这是明确标注
                的外部驱动信号，不是自发节律——参数扫描证实，本 Wilson–Cowan
                参数族里没有稳定的自发极限环：全部候选（含 TVB Table 1 那套
                “20 Hz 振荡参数”，有/无恒定驱动 P 0.2–1.0，从各个初值出发）
                单节点与 76 区网络都收敛到不动点；Table 1 本身收敛到高活动
                不动点（单节点 E*≈0.32、网络平均 E*≈0.49），接近锁定态，
                故不采用。另注意：OU 幅度不是越大越好——0.20 在 1.3–35.9 秒内
                自己锁死，0.15 在固定点击时刻看着安全、换八个点击时刻就有
                2/24 次点击把网络翻进高活动态（点击瞬间的 OU 状态决定结果），
                正弦幅度 0.50 下脉冲也锁死；所以默认值取的是三项安全检查
                （60 秒空跑、固定时刻脉冲、八个时刻 × 三个种子脉冲）全过的
                最大幅度。
              </p>
              <p className="panel-text">
                实验快照：保存当前完整实验状态（参数、全部 76×76 权重、偏置、
                仿真时间、随机种子与 RNG 状态、OU 状态、E/I、延迟历史），恢复后
                继续跑的轨迹与不恢复逐值一致。手动快照存在浏览器 localStorage
                里（brainrun.snapshot.manual.v1），关掉页面还在，RESET 不清；
                自动快照只在内存里，每次按住开始时存按住前状态，RESET 时清掉，
                绝不覆盖手动快照。长按预警：按住中平均 E 超过 0.05 时提前提示，
                锁定（平均 E 持续 500 ms 超过 0.15）是网络进入了新的稳定状态，
                不是软件卡住；松开即停输入，一键可恢复到按住前。
              </p>
              <div className="conn-title">引用与许可</div>
              <p className="panel-text">
                Sanz-Leon et al. 2013, Front. Neuroinform. 7:10。
                数据许可核查见仓库 docs/data-license.md；
                代码 MIT，第三方说明见 NOTICE.md。
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" className="chip modal-close" onClick={() => setShowModelInfo(false)}>
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

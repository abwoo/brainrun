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
import type { BrainData } from './lib/brainData';
import { loadBrainData, topConnections } from './lib/brainData';
import { DEFAULT_PARAMS, DELTA_FULL, KNOB_MAP, RESPONSE_THRESHOLD, SimClient } from './lib/simClient';
import type {
  ReplayState,
  ResponseGroups,
  ResponseSummary,
  ResponseWindow,
} from './lib/simClient';
import type { Snapshot } from './worker/protocol';
import './App.css';

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
  };

  const locked = snap?.locked ?? false;
  const simTimeS = snap ? (snap.t_ms / 1000).toFixed(1) : '0.0';

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">BRAIN PHYSICS</div>
        <div className="topbar-sub">PLAYGROUND · LIVE SIMULATION</div>
        <div className="topbar-controls">
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
          <button type="button" className="chip" onClick={handleReset} title="恢复默认参数、清除刺激、恢复确定性初始状态、清空曲线">
            RESET
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
          {locked && (
            <div className="locked-banner">
              网络已锁定 — 长时间持续输入使全网停在高活动态 · 点 RESET 恢复
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
            />
          )}
        </section>

        <aside className="panels">
          <section className="screen panel">
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
                    {holdMs !== null && (
                      <div>
                        <dt>按住输入中</dt>
                        <dd>{(holdMs / 1000).toFixed(1)} s · 松开即停</dd>
                      </div>
                    )}
                  </dl>
                  <div className="conn-title">主要连接（按权重前 5）</div>
                  {connections.length === 0 ? (
                    <p className="panel-text">该脑区无权重 &gt; 0 的连接。</p>
                  ) : (
                    <ul className="conn-list">
                      {connections.map((c) => (
                        <li key={c.target.id}>
                          <span className="conn-label">{c.target.label}</span>
                          <span className="conn-nums">
                            W {c.weight.toFixed(3)} · {c.lengthMm.toFixed(1)} MM
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="panel-text panel-foot">
                    连接线为结构连接示意，不是白质纤维追踪结果。
                    权重单位 au，长度单位 mm。
                  </p>
                </>
              )}
            </div>
          </section>
        </aside>
      </main>

      <footer className="bottombar">
        <span>点击刺激 · 按住持续输入 · 拖动旋转 · 滚轮缩放 · 双击背景恢复视角</span>
        <span className="bottombar-mid">
          {locked ? '网络已锁定 — 点 RESET 恢复' : 'LIVE SIMULATION · WILSON–COWAN'}
        </span>
        <span className="mono">TIME {simTimeS} S</span>
      </footer>

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
              <div className="conn-title">皮层网格</div>
              <p className="panel-text">
                16,384 顶点皮层网格同样来自 TVB 示例数据 cortex_16384，
                与连接矩阵配套对齐。
              </p>
              <div className="conn-title">模型</div>
              <p className="panel-text">
                Wilson–Cowan 兴奋 / 抑制神经群体模型，是神经群体平均活动的
                现象学模型，不是第一性原理求解器。这里模拟的是该模型在上述
                演示连接组上的行为，不代表真实人脑的客观反应。
              </p>
              <div className="conn-title">默认预设</div>
              <p className="panel-text">
                演示预设为 TVB A-set 只改 θ_e（0 → 1.0），全局耦合 G = 0.35。
                纯 A-set 本身是双稳态的，保留在代码里作参考配置。
              </p>
              <div className="conn-title">引用与许可</div>
              <p className="panel-text">
                Sanz-Leon et al. 2013, Front. Neuroinform. 7:10。
                数据许可核查见仓库 docs/data-license.md；
                代码 MIT，第三方说明见 NOTICE.md。
              </p>
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

/**
 * Brain Physics Playground — Phase 3：真实闭环。
 *
 * 布局：左 65-70% 为 3D 大脑，右 30-35% 为三块仪表
 * （LIVE ACTIVITY / PARAMETERS / REGION-CONNECTION）。
 * 仿真跑在 Web Worker 里的 Rust/WASM 引擎（演示预设 θ_e=1.0，G=0.35）；
 * 所有颜色、波形、读数都只读快照，没有第二套活动生成逻辑。
 * PLAY 控制仿真时钟；相机自动旋转是独立的“旋转”开关。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import BrainScene from './components/BrainScene';
import ActivityChart from './components/ActivityChart';
import Knob from './components/Knob';
import type { BrainData } from './lib/brainData';
import { loadBrainData, topConnections } from './lib/brainData';
import { DEFAULT_PARAMS, KNOB_MAP, SimClient } from './lib/simClient';
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
  const [paused, setPaused] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [holdMs, setHoldMs] = useState<number | null>(null);

  // 旋钮归一化值 k in [0,1]；默认值对应演示预设。
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

  const selected = selectedId !== null && data ? data.regions[selectedId] : null;
  const connections =
    selectedId !== null && data ? topConnections(data, selectedId, 5) : [];
  const selectedE = selectedId !== null && snap ? snap.e[selectedId] : null;
  const selectedI = selectedId !== null && snap ? snap.i[selectedId] : null;
  const selectedP = selectedId !== null && snap ? snap.p[selectedId] : null;

  const handlePulse = useCallback((node: number) => {
    simRef.current?.pulse(node);
  }, []);
  const handleHoldStart = useCallback((node: number) => {
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
        </div>
      </header>

      <main className="main">
        <section className="stage screen">
          <div className="screen-title">3D LIVE BRAIN</div>
          <div className="stage-tools">
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
            />
          )}
        </section>

        <aside className="panels">
          <section className="screen panel">
            <div className="screen-title">LIVE ACTIVITY</div>
            <ActivityChart sim={simRef.current} selectedId={selectedId} resetSignal={resetSignal} />
          </section>

          <section className="screen panel">
            <div className="screen-title">PARAMETERS</div>
            <div className="knobs knobs-live">
              <Knob
                name="STIMULUS"
                note="刺激强度"
                k={kStim}
                defaultK={KNOB_MAP.stimulusK(DEFAULT_PARAMS.stim_amplitude)}
                valueText={KNOB_MAP.stimulusAmplitude(kStim).toFixed(2)}
                modelText={`幅度 ${KNOB_MAP.stimulusAmplitude(kStim).toFixed(2)} · 0.5–2.0`}
                disabled={!simReady}
                onChange={(k) => {
                  setKStim(k);
                  simRef.current?.setParams({ stim_amplitude: KNOB_MAP.stimulusAmplitude(k) });
                }}
              />
              <Knob
                name="DURATION"
                note="持续时间"
                k={kDur}
                defaultK={KNOB_MAP.durationK(DEFAULT_PARAMS.stim_duration_ms)}
                valueText={`${Math.round(KNOB_MAP.durationMs(kDur))} MS`}
                modelText={`脉冲 ${Math.round(KNOB_MAP.durationMs(kDur))} ms · 20–500`}
                disabled={!simReady}
                onChange={(k) => {
                  setKDur(k);
                  simRef.current?.setParams({ stim_duration_ms: KNOB_MAP.durationMs(k) });
                }}
              />
              <Knob
                name="EXC / INH"
                note="兴奋 / 抑制"
                k={kExcInh}
                defaultK={KNOB_MAP.c_eiK(DEFAULT_PARAMS.c_ei)}
                valueText={KNOB_MAP.c_ei(kExcInh).toFixed(1)}
                modelText={`c_ei = ${KNOB_MAP.c_ei(kExcInh).toFixed(1)} · 3–8`}
                disabled={!simReady}
                onChange={(k) => {
                  setKExcInh(k);
                  simRef.current?.setParams({ c_ei: KNOB_MAP.c_ei(k) });
                }}
              />
              <Knob
                name="CONNECTIVITY"
                note="连接强度"
                k={kConn}
                defaultK={KNOB_MAP.gK(DEFAULT_PARAMS.g)}
                valueText={KNOB_MAP.g(kConn).toFixed(2)}
                modelText={`G ${KNOB_MAP.g(kConn).toFixed(2)} · 0–0.4`}
                disabled={!simReady}
                onChange={(k) => {
                  setKConn(k);
                  simRef.current?.setParams({ g: KNOB_MAP.g(k) });
                }}
              />
            </div>
            <p className="panel-text panel-foot">
              {simReady
                ? '旋钮已接入 Wilson–Cowan 引擎 · 改动从下一步仿真开始生效'
                : '仿真引擎加载中，旋钮暂不可用…'}
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
    </div>
  );
}

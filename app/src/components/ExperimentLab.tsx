import {useI18n} from '../lib/i18n';
import {compareNetworkBranches,networkComparisonJson,type NetworkComparison} from '../lib/networkComparison';
import type {SnapshotSummary} from '../lib/simClient';
import Dropdown from './ui/Dropdown';
/**
 * PR-15 — 实验沙盒组件：双脑 A/B 对照、时间机器、闭环控制。
 *
 * Props 约定（壳由总协调接）：`{ fixture, onClose, live }`，fixture 为球形
 * 正向模型（`app/public/forward-assets/sphere-model.json`，与
 * EegAnalysisLab 同一来源）；fixture 为 null 时源定位对照不可用，
 * 其余两节可用（不依赖正向模型）。`live` 为 App 传的直播接线
 * （SimClient + 选中脑区 + 其 TVB 中心）；不传时只有 JR 柱一路。
 * PR8-LINK：双脑 A 可取直播、时间机器有直播回放、闭环有直播闭环；
 * JR 柱的三节原样保留并标“独立演示”，不冒充直播。
 * 每个控件都对应 `app/src/lib/experiments.ts` 里的真实函数：
 * A/B → `runAB` / `compareLocalization`；时间机器 → `TimeMachine`
 * （step/stepTo/restore/fork/replay）；闭环 → `runClosedLoop` /
 * `compareControlVsNoControl`。本组件不跑任何组件外的模型、不编造数据。
 *
 * 闭环初版仅用于模拟环境，不直接控制人体设备（界面顶部有标注）。
 * 单位：时间 ms、输入 1/s、偶极矩 nA·m、电位 µV、频段功率 µV²、
 * 频率 Hz、位置 mm、定位误差 mm。
 *
 * 布局：纵向堆叠、无绝对定位、无重叠；1920×1080 与 978px 冒烟级查看。
 */
import { useEffect, useRef, useState } from 'react';
import type { SphereFixture } from '../lib/sphereForward';
import {setLiveRecordingStore} from '../lib/eegRecording';
import {runNativeExperiment,NATIVE_EEG_ID} from '../lib/nativeEeg';
import {ExperimentSession} from '../lib/experimentSession';
import type { SimClient } from '../lib/simClient';
import type { Vec3Mm } from '../lib/volumeConduction';
import {
  CLOSED_LOOP_SIMULATION_ONLY,
  compareControlVsNoControl,
  compareLocalization,
  runAB,
  runClosedLoop,
  TimeMachine,
  type ClosedLoopConfig,
  type ControllerMode,
  type ExperimentConfig,
  type FeatureKind,
  type RunComparison,
} from '../lib/experiments';
import { evaluateDepthMethods } from '../lib/depthWeightedInverse';

const panel: React.CSSProperties = {
  border: '1px solid #2a3f52',
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
  background: '#0a1620',
  color: '#d7e5ef',
  boxSizing: 'border-box',
};
const title: React.CSSProperties = { margin: '0 0 8px 0', fontSize: 15, fontWeight: 600 };
const note: React.CSSProperties = { margin: '4px 0', fontSize: 12, lineHeight: 1.6, color: '#9db4c4' };
const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 };
const label: React.CSSProperties = { fontSize: 12, color: '#9db4c4' };
const input: React.CSSProperties = {
  background: '#0d2233', color: '#d7e5ef', border: '1px solid #2a3f52',
  borderRadius: 4, padding: '4px 6px', fontSize: 13, width: 90,
};
const button: React.CSSProperties = {
  background: '#14425e', color: '#d7e5ef', border: '1px solid #2a5f7f',
  borderRadius: 4, padding: '5px 12px', fontSize: 13, cursor: 'pointer',
};
const table: React.CSSProperties = { borderCollapse: 'collapse', fontSize: 12, width: '100%' };
const th: React.CSSProperties = { border: '1px solid #2a3f52', padding: '4px 6px', textAlign: 'left', color: '#9db4c4' };
const td: React.CSSProperties = { border: '1px solid #2a3f52', padding: '4px 6px' };
const warn: React.CSSProperties = {
  border: '1px solid #7a5a1e', background: '#241c08', color: '#ffd479',
  borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13, lineHeight: 1.6,
};

function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export default function ExperimentLab({
  fixture,
  onClose,
  onRestore,onOpenAnalysis,
  live,
}: {
  fixture: SphereFixture | null;
  onClose: () => void;
  onRestore?:(summary:SnapshotSummary)=>void;
  onOpenAnalysis?:()=>void;
  /**
   * PR8-LINK 直播接线（App 传）：主仿真客户端 + 选中脑区 + 其 TVB 中心。
   * 不传时只有 JR 柱对照一路（独立演示）。
   */
  live?: {
    sim: SimClient | null;
    node: number | null;
    label: string | null;
    positionMm: Vec3Mm | null;
  };
}) {
  const {locale}=useI18n();const text=(zh:string,en:string)=>locale==='zh-CN'?zh:en;
  /* ── A/B 对照 ── */
  const [driveA, setDriveA] = useState('120');
  const [driveB, setDriveB] = useState('300');
  const [abDuration, setAbDuration] = useState('2000');
  const [abResult, setAbResult] = useState<RunComparison | null>(null);
  const [abError, setAbError] = useState<string | null>(null);
  const [locResult, setLocResult] = useState<string | null>(null);

  const handleRunAB = () => {
    setAbError(null);
    try {
      const base: ExperimentConfig = {
        durationMs: num(abDuration, 2000),
        events: [{ tMs: 1000, drivePerS: 120, durationMs: 100 }],
      };
      const { comparison } = runAB(
        { ...base, events: [{ tMs: 1000, drivePerS: num(driveA, 120), durationMs: 100 }] },
        { ...base, events: [{ tMs: 1000, drivePerS: num(driveB, 300), durationMs: 100 }] },
      );
      setAbResult(comparison);
    } catch (e) {
      setAbError(String(e));
    }
  };

  const handleRunLocalization = () => {
    if (!fixture) return;
    const loc = compareLocalization(
      fixture,
      '10-20',
      { positionMm: [16, 16, 16], momentNAm: [0, 10, 5] },
      { positionMm: [48, 48, 48], momentNAm: [0, 10, 5] },
    );
    setLocResult(
      `深源 [16,16,16] mm：偶极子误差 ${fmt(loc.a.dipole.localizationErrorMm, 2)} mm，` +
        `MNE 误差 ${fmt(loc.a.mne.localizationErrorMm, 2)} mm；` +
        `浅源 [48,48,48] mm：偶极子误差 ${fmt(loc.b.dipole.localizationErrorMm, 2)} mm，` +
        `MNE 误差 ${fmt(loc.b.mne.localizationErrorMm, 2)} mm；` +
        `MNE 误差差（B−A）${fmt(loc.mneErrorDiffMm, 2)} mm，分布范围差 ${fmt(loc.mneSpreadDiffMm, 2)} mm。`,
    );
  };

  const [depthResult, setDepthResult] = useState<string | null>(null);
  const handleRunDepth = () => {
    if (!fixture) return;
    const deep = evaluateDepthMethods(fixture, '10-20', [16, 16, 16], [0, 10, 5]);
    const shallow = evaluateDepthMethods(fixture, '10-20', [48, 48, 48], [0, 10, 5]);
    setDepthResult(
      `深源：plain MNE ${fmt(deep.plainMne.localizationErrorMm, 2)} mm → ` +
        `深度加权 ${fmt(deep.depthWeighted.localizationErrorMm, 2)} mm → ` +
        `dSPM ${fmt(deep.dspm.localizationErrorMm, 2)} mm → ` +
        `eLORETA ${fmt(deep.eloreta.localizationErrorMm, 2)} mm；` +
        `浅源：plain ${fmt(shallow.plainMne.localizationErrorMm, 2)} mm → ` +
        `深度加权 ${fmt(shallow.depthWeighted.localizationErrorMm, 2)} mm → ` +
        `dSPM ${fmt(shallow.dspm.localizationErrorMm, 2)} mm → ` +
        `eLORETA ${fmt(shallow.eloreta.localizationErrorMm, 2)} mm。` +
        `没有一种方法同时修好深浅两端，见文档。`,
    );
  };

  const [networkG,setNetworkG]=useState('0.2');
  const [networkBusy,setNetworkBusy]=useState(false);
  const [networkResult,setNetworkResult]=useState<NetworkComparison|null>(null);
  const [networkError,setNetworkError]=useState<string|null>(null);
  const handleNetworkCompare=async()=>{
   if(!live?.sim||live.node===null)return;
   setNetworkBusy(true);setNetworkError(null);
   try{
    const result=await compareNetworkBranches(live.sim,live.node,Number(networkG));
    setNetworkResult(result);
    const origin=await live.sim.restoreSnapshot(result.originSnapshotId);onRestore?.(origin);
   }catch(e){setNetworkError(String(e));}finally{setNetworkBusy(false);}
  };
  const inspectBranch=async(which:'a'|'b')=>{
   if(!live?.sim||!networkResult)return;
   try{const summary=await live.sim.restoreSnapshot(networkResult[which].snapshotId);onRestore?.(summary);}
   catch(e){setNetworkError(String(e));}
  };
  const analyzeBranch=(which:'a'|'b')=>{
   if(!fixture||!networkResult||!live?.positionMm)return;
   try{
    const branch=networkResult[which],first=branch.samples[0],node=networkResult.node;
    const result=runNativeExperiment({fixture,samples:branch.samples,node,
     baselineE:first.e[node],baselineI:first.i[node],positionMm:live.positionMm,
     markers:branch.markers,noise:null,seed:branch.run.provenance.seed??1,sfreqHz:250});
    const session=new ExperimentSession({origin:'live-derived',solverId:NATIVE_EEG_ID,anatomyId:fixture.model_id,
     registration:'unregistered',seed:branch.run.provenance.seed,parentRunId:branch.run.provenance.runId,clock:'solver-integration-ms'});
    session.recordModelTime(session.runId,result.recording.timesMs.at(-1)??0);
    const recording={...result.recording,provenance:{...session.provenance,upstreamStartMs:result.t0Ms},
     experiment:{session:session.getSnapshot(),parameters:{comparisonBranch:which,comparisonOriginRunId:networkResult.originRunId,
      sourceNode:node,montage:result.recording.montage,reference:result.recording.reference,noise:null,seed:result.recording.seed,
      sfreqHz:250,durationMs:result.recording.timesMs.at(-1)??0,registration:'TVB demo coordinates clamped to sphere; unregistered'}}};
    setLiveRecordingStore({recording,events:result.events.map(e=>({...e,runId:session.runId})),epochs:null});
    onOpenAnalysis?.();
   }catch(e){setNetworkError(String(e));}
  };

  /* ── 时间机器 ── */
  const tmRef = useRef<TimeMachine | null>(null);
  const [, setTmTick] = useState(0);
  const [tmBranchMs, setTmBranchMs] = useState('1000');
  const [tmBranchDrive, setTmBranchDrive] = useState('300');
  const [tmBranchResult, setTmBranchResult] = useState<string | null>(null);
  const [tmReplayIdx, setTmReplayIdx] = useState(0);
  const [tmError, setTmError] = useState<string | null>(null);

  const tm = tmRef.current;
  const tmHistory = tm ? tm.getHistory() : [];
  const tmReadout = tm ? tm.read() : null;
  const replaySnap = tmHistory.length > 0
    ? tmHistory[Math.min(tmReplayIdx, tmHistory.length - 1)]
    : null;

  const handleTmStart = () => {
    setTmError(null);
    setTmBranchResult(null);
    try {
      const machine = new TimeMachine({
        durationMs: 2000,
        events: [{ tMs: 1000, drivePerS: 120, durationMs: 100 }],
      });
      machine.stepTo(2000);
      tmRef.current = machine;
      setTmReplayIdx(machine.getHistory().length - 1);
      setTmTick((t) => t + 1);
    } catch (e) {
      setTmError(String(e));
    }
  };

  const handleTmStep = () => {
    if (!tm) return;
    tm.resume();
    tm.step();
    setTmTick((t) => t + 1);
  };

  const handleTmRestore = () => {
    if (!tm || !replaySnap) return;
    tm.restore(replaySnap);
    setTmReplayIdx(tm.getHistory().length - 1);
    setTmTick((t) => t + 1);
  };

  const handleTmFork = () => {
    if (!tm) return;
    setTmError(null);
    try {
      const branchMs = num(tmBranchMs, 1000);
      const snap = tm.snapshotAt(branchMs);
      if (!snap) throw new RangeError(`没有 ${branchMs} ms 的快照`);
      const forked = tm.fork(snap, {
        events: [{ tMs: 1000, drivePerS: num(tmBranchDrive, 300), durationMs: 100 }],
      });
      forked.stepTo(2000);
      const a = tm.getHistory();
      const b = forked.getHistory();
      let before = 0;
      let after = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const d = Math.abs(a[i].readout.y0 - b[i].readout.y0);
        if (a[i].tMs <= branchMs + 1e-9) before = Math.max(before, d);
        else after = Math.max(after, d);
      }
      setTmBranchResult(
        `分支点 ${branchMs} ms：分支前最大差 ${fmt(before, 6)} mV，` +
          `分支后最大差 ${fmt(after, 4)} mV（驱动改为 ${tmBranchDrive} 1/s）。`,
      );
    } catch (e) {
      setTmError(String(e));
    }
  };

  /* ── PR8-LINK：直播回放（真实快照存储）── */
  const [liveTm, setLiveTm] = useState<Array<{ t_ms: number; e: number; i: number }> | null>(null);
  const [liveTmIdx, setLiveTmIdx] = useState(0);
  const [liveTmError, setLiveTmError] = useState<string | null>(null);

  const handleLoadLiveTm = () => {
    setLiveTmError(null);
    try {
      const sim = live?.sim;
      if (!sim) throw new Error('直播未就绪（仿真引擎加载中）');
      if (live?.node === null || live?.node === undefined) {
        throw new Error('先在主界面选一个脑区，再载入直播快照');
      }
      const hist = sim.getNativeHistory();
      if (hist.length < 2) throw new Error('直播快照历史不足：等仿真跑满 1 秒');
      const node = live.node;
      setLiveTm(hist.map((s) => ({ t_ms: s.t_ms, e: s.e[node], i: s.i[node] })));
      setLiveTmIdx(hist.length - 1);
    } catch (e) {
      setLiveTmError(String(e));
    }
  };

  /* ── 闭环 ── */
  const [clMode, setClMode] = useState<ControllerMode>('threshold');
  const [clFeature, setClFeature] = useState<FeatureKind>('instant');
  const [clThreshold, setClThreshold] = useState('0.1');
  const [clOutput, setClOutput] = useState('-80');
  const [clKp, setClKp] = useState('2');
  const [clKi, setClKi] = useState('10');
  const [clKd, setClKd] = useState('0');
  const [clSetpoint, setClSetpoint] = useState('1');
  const [clDelay, setClDelay] = useState('0');
  const [clNoise, setClNoise] = useState('0.02');
  const [clResult, setClResult] = useState<string | null>(null);
  const [clError, setClError] = useState<string | null>(null);

  const handleRunClosedLoop = () => {
    setClError(null);
    try {
      const base: ExperimentConfig = {
        durationMs: 3000,
        events: [{ tMs: 1000, drivePerS: 300, durationMs: 100 }],
      };
      const cl: Omit<ClosedLoopConfig, 'base'> = {
        feature: { kind: clFeature },
        controller: clMode,
        threshold: { threshold: num(clThreshold, 0.1), outputPerS: num(clOutput, -80) },
        pid: {
          kp: num(clKp, 2), ki: num(clKi, 10), kd: num(clKd, 0),
          setpoint: num(clSetpoint, 1),
        },
        delayMs: num(clDelay, 0),
        measurementNoiseRmsUv: num(clNoise, 0.02),
        noiseSeed: 7,
      };
      const run = runClosedLoop({ base, ...cl });
      const cmp = compareControlVsNoControl(base, cl);
      const m = run.metrics;
      setClResult(
        `首触发 ${m.firstTriggerMs === null ? '未触发' : `${m.firstTriggerMs} ms`}，` +
          `响应时延 ${m.responseLatencyMs === null ? '—' : `${m.responseLatencyMs} ms`}，` +
          `触发占比 ${(m.triggerFraction * 100).toFixed(2)}%，` +
          `控制峰值 ${fmt(m.maxAbsControlPerS, 1)} 1/s，` +
          `max|y0| ${fmt(m.maxAbsY0Mv, 4)} mV，max|Pz| ${fmt(m.maxAbsEegUv, 4)} µV，` +
          `发散：${m.diverged ? '是' : '否'}。` +
          `有控制 vs 无控制：RMS 差 ${fmt(cmp.rmsEegDiffUv, 4)} µV，` +
          `峰值差 ${fmt(cmp.peakEegDiffUv, 4)} µV。`,
      );
    } catch (e) {
      setClError(String(e));
    }
  };

  /* ── PR8-LINK：直播闭环 ── */
  const [clLiveFeature, setClLiveFeature] = useState<'instant' | 'rms'>('instant');
  const [clLiveThreshold, setClLiveThreshold] = useState('0.05');
  const [clLiveAmp, setClLiveAmp] = useState('2');
  const [clLiveMax, setClLiveMax] = useState('5');
  const [clLiveRunning, setClLiveRunning] = useState(false);
  const [clLiveLog, setClLiveLog] = useState<string[]>([]);
  const [clWorkerActive,setClWorkerActive]=useState(false);
  const clLiveRequestedRef=useRef(false);
  const liveSim = live?.sim ?? null;
  const liveNode = live?.node ?? null;

  useEffect(() => {
    if (!clLiveRunning) {
      if(clLiveRequestedRef.current){liveSim?.configureNativeFeedback(null);clLiveRequestedRef.current=false;}
      return;
    }
    if (!liveSim || liveNode === null) {
      setClLiveRunning(false);
      return;
    }
    try{
      liveSim.configureNativeFeedback({node:liveNode,feature:clLiveFeature,threshold:Number(clLiveThreshold),
       amplitude:Number(clLiveAmp),maxTriggers:Number(clLiveMax),durationMs:100,
       periodMs:250,windowMs:1000,cooldownMs:2000,delayMs:0});
      clLiveRequestedRef.current=true;
    }catch(e){setClError(String(e));setClLiveRunning(false);}
  }, [clLiveRunning, clLiveFeature, clLiveThreshold, clLiveAmp, clLiveMax, liveSim, liveNode]);
  useEffect(()=>()=>{liveSim?.configureNativeFeedback(null);clLiveRequestedRef.current=false;},[liveSim]);
  useEffect(()=>{
    if(!liveSim)return;
    return liveSim.subscribeNativeFeedback(message=>{
      setClWorkerActive(message.active);
      if(message.phase==='restored'&&message.state){
        const c=message.state.config;setClLiveFeature(c.feature);setClLiveThreshold(String(c.threshold));setClLiveAmp(String(c.amplitude));setClLiveMax(String(c.maxTriggers));
      }
      if(message.phase==='applied'&&message.action){
        const a=message.action;
        setClLiveLog(prev=>[...prev,
          't='+message.t_ms+' ms · E='+a.featureValue.toFixed(4)+' · detected='+a.detectedMs+' ms → applied='+message.t_ms+' ms · #'+a.id]);
      }
      if(message.phase==='applied'&&!message.active){clLiveRequestedRef.current=false;setClLiveRunning(false);}
      if(message.phase==='stopped')setClLiveRunning(false);
    });
  },[liveSim]);

  return (
    <div>
      <div style={warn}>{CLOSED_LOOP_SIMULATION_ONLY}本页 JR 柱三节的结果来自 JR 皮层柱模拟，不是人体实测；标“直播”的对照与回放来自主仿真；直播闭环直接读取每 1 ms 积分状态。</div>

      {/* A/B 对照 */}
      <div style={panel}>
        <h3 style={title}>双脑 A/B 对照</h3>
        <p style={note}>
          两个实验实例：相同初始状态、相同模型（Jansen–Rit 皮层柱）、相同种子、
          相同输入事件，只改一个条件（这里是事件驱动，1/s）。比较输出是数值
          差异（峰值差、PSD 峰移、ERP 峰差），不只是两张图。共享时间轴（0.5 ms 步长）。
        </p>
        <div style={row}>
          <span style={label}>驱动 A（1/s）</span>
          <input style={input} value={driveA} onChange={(e) => setDriveA(e.target.value)} />
          <span style={label}>驱动 B（1/s）</span>
          <input style={input} value={driveB} onChange={(e) => setDriveB(e.target.value)} />
          <span style={label}>时长（ms）</span>
          <input style={input} value={abDuration} onChange={(e) => setAbDuration(e.target.value)} />
          <button style={button} onClick={handleRunAB}>运行对照</button>
        </div>
        {abError && <p style={note}>{abError}</p>}
        {abResult && (
          <table style={table}>
            <tbody>
              <tr><th style={th}>指标</th><th style={th}>A</th><th style={th}>B</th><th style={th}>差（B−A）</th></tr>
              <tr><td style={td}>y0 峰值 |y0|（mV）</td><td style={td}>{fmt(abResult.peakY0A)}</td><td style={td}>{fmt(abResult.peakY0B)}</td><td style={td}>{fmt(abResult.peakY0DiffMv)}</td></tr>
              <tr><td style={td}>y0 峰值时刻差（ms）</td><td style={td} colSpan={2}>—</td><td style={td}>{fmt(abResult.peakTimeDiffMs, 1)}</td></tr>
              <tr><td style={td}>PSD 峰值频率（Hz）</td><td style={td}>{fmt(abResult.psdPeakHzA, 2)}</td><td style={td}>{fmt(abResult.psdPeakHzB, 2)}</td><td style={td}>{fmt(abResult.psdPeakShiftHz, 2)}</td></tr>
              <tr><td style={td}>ERP 峰值（µV，窗 0–600 ms）</td><td style={td}>{fmt(abResult.erpPeakA)}</td><td style={td}>{fmt(abResult.erpPeakB)}</td><td style={td}>{fmt(abResult.erpPeakDiffUv)}</td></tr>
              <tr><td style={td}>Pz RMS 差（µV）</td><td style={td} colSpan={2}>—</td><td style={td}>{fmt(abResult.rmsEegDiffUv)}</td></tr>
              <tr><td style={td}>y0 轨迹最大绝对差（mV）</td><td style={td} colSpan={2}>—</td><td style={td}>{fmt(abResult.maxAbsY0DiffMv)}</td></tr>
            </tbody>
          </table>
        )}
        <div style={row}>
          <button style={button} disabled={!fixture} onClick={handleRunLocalization}>
            源定位对照（深源 vs 浅源）
          </button>
          <button style={button} disabled={!fixture} onClick={handleRunDepth}>
            深度偏置对照（plain / depth / dSPM / eLORETA）
          </button>
          {!fixture && <span style={label}>正向模型未加载：先运行 scientific/forward/generate_sphere_model.py</span>}
        </div>
        {locResult && <p style={note}>{locResult}</p>}
        {depthResult && <p style={note}>{depthResult}</p>}
      </div>

      <div style={panel} data-testid="network-comparison">
       <h3 style={title}>{text('全脑网络 A/B · 同一完整状态分叉','Whole-network A/B · fork one complete state')}</h3>
       <p style={note}>{text('暂停主模型，从同一随机状态、延迟历史、输入和控制器状态分叉。A 保留当前 G，B 只改变 G；两条轨迹均记录每 1 ms 的 E/I。完成后主模型停回原点，手动选择查看或分析分支。','Pause the main model and fork identical RNG, delay history, inputs and controller state. A retains G; B changes only G. Both record E/I every 1 ms. The model returns paused to the origin; choose a branch to inspect or analyze.')}</p>
       <div style={row}>
        <label style={label}>B · G <input style={input} aria-label="B branch G" type="number" min={0} max={.4} step={.01} value={networkG} disabled={networkBusy} onChange={e=>setNetworkG(e.target.value)}/></label>
        <button style={button} disabled={!live?.sim||live.node===null||networkBusy} onClick={()=>void handleNetworkCompare()}>{networkBusy?text('计算中…','Computing…'):text('从当前状态比较 A/B','Compare A/B from this state')}</button>
       </div>
       {networkError&&<p role="alert" style={note}>{networkError}</p>}
       {networkResult&&<>
        <output data-testid="network-comparison-result" data-global-difference={networkResult.metrics.globalMaxDifference} data-origin-run={networkResult.originRunId}>
         G: {networkResult.a.g} → {networkResult.b.g} · RMS ΔE #{networkResult.node}: {networkResult.metrics.selectedRmsDifference.toFixed(6)} · max ΔE: {networkResult.metrics.globalMaxDifference.toFixed(6)}
        </output>
        <svg viewBox="0 0 640 130" role="img" aria-label="Native network A and B trajectories" style={{width:'100%',background:'#08131d'}}>
         {(['a','b'] as const).map(which=><polyline key={which} fill="none" stroke={which==='a'?'#ffb340':'#4fb6f2'} strokeWidth={1.5}
          points={networkResult[which].samples.filter((_,i)=>i%4===0).map(s=>((s.t_ms-networkResult.startMs)/networkResult.durationMs*640)+','+(125-s.e[networkResult.node]*120)).join(' ')}/>)}
        </svg>
        <p style={note}>{text('橙色 A，蓝色 B。纵轴 E 为无量纲；图形每 4 ms 取点，完整导出保留全部 1 ms 记录。','Orange A, blue B. E is dimensionless; the plot draws every 4 ms, while export retains every 1 ms sample.')}</p>
        <div style={row}>
         <button style={button} onClick={()=>void inspectBranch('a')}>{text('查看 A 末状态','Inspect A end state')}</button>
         <button style={button} onClick={()=>void inspectBranch('b')}>{text('查看 B 末状态','Inspect B end state')}</button>
         <button style={button} disabled={!fixture||!live?.positionMm} onClick={()=>analyzeBranch('a')}>{text('分析 A 的 EEG','Analyze A EEG')}</button>
         <button style={button} disabled={!fixture||!live?.positionMm} onClick={()=>analyzeBranch('b')}>{text('分析 B 的 EEG','Analyze B EEG')}</button>
         <button style={button} onClick={()=>{
          const url=URL.createObjectURL(new Blob([networkComparisonJson(networkResult)],{type:'application/json'}));
          const a=document.createElement('a');a.href=url;a.download='brainrun-network-comparison.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
         }}>{text('导出完整对照','Export complete comparison')}</button>
        </div>
        <p style={note}>{text('EEG 使用同一球形模型和显式源映射；TVB 演示坐标未做人类解剖配准。','EEG uses the same sphere and explicit source mapping; TVB demo coordinates are not registered to human anatomy.')}</p>
       </>}
      </div>

      {/* PR8-LINK：直播回放（SimClient 真实快照存储） */}
      <div style={panel}>
        <h3 style={title}>时间机器 · 直播回放</h3>
        <p style={note}>
          {text('这里回放最近 10 秒的原生 1 ms E/I；滑杆只改变观察时刻。上方全脑 A/B 可以恢复完整分支状态并继续实验。','Replay native 1 ms E/I from the last 10 seconds. The slider changes observation time only; the whole-network A/B controls above restore complete branch states for further experiments.')}
        </p>
        <div style={row}>
          <button style={button} onClick={handleLoadLiveTm}>载入最近 10 秒直播快照</button>
        </div>
        {liveTmError && <p style={note}>{liveTmError}</p>}
        {liveTm && liveTm.length > 0 && (
          <div style={row}>
            <span style={label}>回放：{(liveTm[Math.min(liveTmIdx, liveTm.length - 1)].t_ms / 1000).toFixed(2)} s（拖动）</span>
            <input
              type="range"
              min={0}
              max={liveTm.length - 1}
              value={liveTmIdx}
              onChange={(e) => setLiveTmIdx(Number(e.target.value))}
              style={{ flex: 1, minWidth: 200 }}
            />
            <span style={label}>
              E = {fmt(liveTm[Math.min(liveTmIdx, liveTm.length - 1)].e)}，
              I = {fmt(liveTm[Math.min(liveTmIdx, liveTm.length - 1)].i)}
              （#{live?.node ?? '—'} {live?.label ?? ''}）
            </span>
          </div>
        )}
      </div>

      {/* 时间机器 */}
      <div style={panel}>
        <h3 style={title}>时间机器 · JR 柱（独立演示）</h3>
        <p style={note}>
          独立演示：Jansen–Rit 皮层柱的时间机器，与直播仿真无关（不读主仿真快照）。
          暂停、单步（一次一个 dt = 0.5 ms）、历史缓冲（每 10 ms 一份快照）、
          回放（拖动已记录的快照历史）、慢动作（回放倍率只改变查看速度，
          不改变物理）、恢复模型快照、从历史状态改参数后重新运行（分支）。
          所有回放均来自真实保存的状态或确定性重算，不编造历史。
        </p>
        <div style={row}>
          <button style={button} onClick={handleTmStart}>跑到 2000 ms（事件 1000 ms，驱动 120 1/s）</button>
          <button style={button} disabled={!tm} onClick={handleTmStep}>单步 +0.5 ms</button>
          <button style={button} disabled={!tm || !replaySnap} onClick={handleTmRestore}>恢复到回放点</button>
        </div>
        {tmError && <p style={note}>{tmError}</p>}
        {tm && tmReadout && (
          <p style={note}>
            当前 t = {fmt(tm.timeMs, 1)} ms，y0 = {fmt(tmReadout.y0)} mV，
            q = {fmt(tmReadout.qNAm)} nA·m，Pz = {fmt(tmReadout.eegUv)} µV；
            历史快照 {tmHistory.length} 份（每 10 ms 一份）。
          </p>
        )}
        {tmHistory.length > 0 && replaySnap && (
          <div style={row}>
            <span style={label}>回放：{fmt(replaySnap.tMs, 1)} ms（拖动）</span>
            <input
              type="range"
              min={0}
              max={tmHistory.length - 1}
              value={tmReplayIdx}
              onChange={(e) => setTmReplayIdx(Number(e.target.value))}
              style={{ flex: 1, minWidth: 200 }}
            />
            <span style={label}>
              y0 = {fmt(replaySnap.readout.y0)} mV，Pz = {fmt(replaySnap.readout.eegUv)} µV
            </span>
          </div>
        )}
        <div style={row}>
          <span style={label}>分支时刻（ms）</span>
          <input style={input} value={tmBranchMs} onChange={(e) => setTmBranchMs(e.target.value)} />
          <span style={label}>分支后驱动（1/s）</span>
          <input style={input} value={tmBranchDrive} onChange={(e) => setTmBranchDrive(e.target.value)} />
          <button style={button} disabled={!tm} onClick={handleTmFork}>从该点改参数重跑（分支）</button>
        </div>
        {tmBranchResult && <p style={note}>{tmBranchResult}</p>}
      </div>

      {/* 闭环 */}
      <div style={panel}>
        <h3 style={title}>闭环控制 · JR 柱（独立演示）</h3>
        <p style={note}>
          独立演示：Jansen–Rit 皮层柱的闭环模拟，与直播仿真无关。
          模拟 EEG（Pz 代理）→ 特征提取 → 状态判定 → 控制器 → 延迟 → 虚拟刺激
          （加到 JR 输入上）→ 神经响应。控制器输出单位 1/s，加在静息输入 p0
          上：正值兴奋、负值抑制。阈值模式用固定阈值触发抑制输出；
          PID 模式跟踪设定点（位置式，条件积分抗饱和）。
        </p>
        <div style={row}>
          <span style={label}>控制器</span>
          <Dropdown value={clMode} onChange={(e) => setClMode(e.target.value as ControllerMode)}>
            <option value="off">关（无控制对照）</option>
            <option value="threshold">固定阈值</option>
            <option value="pid">PID</option>
          </Dropdown>
          <span style={label}>特征</span>
          <Dropdown value={clFeature} onChange={(e) => setClFeature(e.target.value as FeatureKind)}>
            <option value="instant">瞬时 Pz（µV）</option>
            <option value="rms">滑窗 RMS（µV）</option>
            <option value="alphaPower">Alpha 功率 10 Hz（µV²）</option>
          </Dropdown>
          <span style={label}>延迟（ms）</span>
          <input style={input} value={clDelay} onChange={(e) => setClDelay(e.target.value)} />
          <span style={label}>测量噪声 RMS（µV）</span>
          <input style={input} value={clNoise} onChange={(e) => setClNoise(e.target.value)} />
        </div>
        {clMode === 'threshold' && (
          <div style={row}>
            <span style={label}>阈值（特征单位）</span>
            <input style={input} value={clThreshold} onChange={(e) => setClThreshold(e.target.value)} />
            <span style={label}>触发输出（1/s，负值 = 抑制）</span>
            <input style={input} value={clOutput} onChange={(e) => setClOutput(e.target.value)} />
          </div>
        )}
        {clMode === 'pid' && (
          <div style={row}>
            <span style={label}>Kp（1/s 每单位误差）</span>
            <input style={input} value={clKp} onChange={(e) => setClKp(e.target.value)} />
            <span style={label}>Ki</span>
            <input style={input} value={clKi} onChange={(e) => setClKi(e.target.value)} />
            <span style={label}>Kd</span>
            <input style={input} value={clKd} onChange={(e) => setClKd(e.target.value)} />
            <span style={label}>设定点（特征单位）</span>
            <input style={input} value={clSetpoint} onChange={(e) => setClSetpoint(e.target.value)} />
          </div>
        )}
        <div style={row}>
          <button style={button} onClick={handleRunClosedLoop}>运行闭环（3 s，事件 1000 ms，驱动 300 1/s）</button>
        </div>
        {clError && <p style={note}>{clError}</p>}
        {clResult && <p style={note}>{clResult}</p>}
      </div>

      {/* PR8-LINK：直播闭环（特征取自直播 EEG/活动，反馈经 Worker 脉冲回主仿真） */}
      <div style={panel}>
        <h3 style={title}>闭环控制 · 直播闭环</h3>
        <p style={note}>
          特征取自原生积分：选中脑区 #{liveNode ?? '—'} {live?.label ?? ''} 的 live E
          （瞬时值，或最近 1 秒的 RMS）。特征超过阈值时，经 Worker 脉冲
          （原生积分时钟，100 ms）反馈回主仿真——不是只算 JR 柱。触发上限 +
          2 秒冷却 + 手动停止：脉冲可能把双稳态网络翻进高活动态，触发到上限
          自动停；停后若网络锁住，用主界面横幅的恢复/RESET 回来。
        </p>
        <div style={row}>
          <span style={label}>特征</span>
          <Dropdown value={clLiveFeature} disabled={clLiveRunning||clWorkerActive} onChange={(e) => setClLiveFeature(e.target.value as 'instant' | 'rms')}>
            <option value="instant">瞬时 E（无量纲）</option>
            <option value="rms">1 秒 RMS E（无量纲）</option>
          </Dropdown>
          <span style={label}>阈值</span>
          <input style={input} aria-label="直播闭环阈值" value={clLiveThreshold} disabled={clLiveRunning||clWorkerActive} onChange={(e) => setClLiveThreshold(e.target.value)} />
          <span style={label}>反馈脉冲幅度（模型单位）</span>
          <input style={input} aria-label="直播闭环反馈幅度" value={clLiveAmp} disabled={clLiveRunning||clWorkerActive} onChange={(e) => setClLiveAmp(e.target.value)} />
          <span style={label}>触发上限（次）</span>
          <input style={input} aria-label="直播闭环触发上限" value={clLiveMax} disabled={clLiveRunning||clWorkerActive} onChange={(e) => setClLiveMax(e.target.value)} />
          {!(clLiveRunning||clWorkerActive) ? (
            <button
              style={button}
              disabled={!liveSim || liveNode === null}
              onClick={() => {
                clLiveRequestedRef.current=false;
                setClLiveLog([]);
                setClLiveRunning(true);
              }}
            >
              启动直播闭环
            </button>
          ) : (
            <button style={button} onClick={() => {setClLiveRunning(false);liveSim?.configureNativeFeedback(null);clLiveRequestedRef.current=false;}}>停止直播闭环</button>
          )}
          {(!liveSim || liveNode === null) && <span style={label}>先在主界面选一个脑区（直播未就绪或未选区时不可启动）。</span>}
        </div>
        {(clLiveRunning||clWorkerActive) && <p style={note}>直播闭环运行中：Worker 每 250 ms 模型时间检查原生 E；RMS 需要完整 1000 ms 窗口。检测后至少 1 ms 施加输入，冷却 2000 ms；暂停会冻结控制时钟。</p>}
        {clLiveLog.map((line, i) => <p key={i} style={note}>{line}</p>)}
      </div>

      <div style={row}>
        <button style={button} onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

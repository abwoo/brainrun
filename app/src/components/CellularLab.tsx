/**
 * PR-13（PR7 第一批）— CellularLab：细胞级实验台。
 *
 * 自包含实验台（props 为空）：模型选择 LIF / Hodgkin–Huxley / 多房室，
 * 电流注入控制，膜电位与电导曲线，发放计数，跨尺度耦合面板。
 * 每个控件都对应 `app/src/lib/cellular.ts` 里的真实函数——没有只摆样子的
 * 滑杆；所有曲线都由所选模型的求解器实时算出，不是动画。
 *
 * 多尺度说明（写在界面上，不藏）：从全脑放大到细胞级时，系统切换到
 * 这个细胞级仿真模型，不是把全脑动画放大；脑区活动 E 到细胞电流的
 * 映射是显式假设、未校准（见耦合面板）。
 *
 * 布局：纵向堆叠、无绝对定位、无重叠；1920×1080 与 978px 冒烟级查看。
 * 单位：mV / ms / pA / uA/cm^2 / nS / Hz / nA·m / uV，处处写清。
 */
import { useMemo, useState } from 'react';
import {
  CELLULAR_LIMITATION,
  DEFAULT_HH_PARAMS,
  DEFAULT_LIF_PARAMS,
  DEFAULT_MULTICOMP_MORPHOLOGY,
  SYNAPSE_DEFAULTS,
  cellularDipoleNAm,
  createLifNeuron,
  firingRateToPopulationDriveP,
  impliedScalpUv,
  lifAnalyticRateHz,
  lifRheobasePA,
  simulateHodgkinHuxley,
  simulateLif,
  simulateMulticompartment,
  synapseConductanceNS,
  synapseCurrentPA,
  wcToHhCurrentDensityUAperCm2,
  wcToLifCurrentPA,
} from '../lib/cellular.ts';

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
const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap',
};
const btn = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid #2a3f52',
  background: active ? '#16405a' : '#0a1620', color: '#d7e5ef', fontSize: 13,
});

type ModelKind = 'lif' | 'hh' | 'multicomp';
type TargetKind = 'soma' | 'apical' | 'basal';

interface RunResult {
  kind: ModelKind;
  timesMs: number[];
  vMv: number[];
  vApicalMv?: number[];
  vBasalMv?: number[];
  gNa?: number[];
  gK?: number[];
  spikeTimesMs: number[];
  rateHz: number;
  extraNote: string;
}

function TracePlot({ timesMs, series, color, label, unit }: {
  timesMs: number[]; series: number[]; color: string; label: string; unit: string;
}) {
  const W = 640;
  const H = 180;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(max - min, 1e-9);
  const tEnd = timesMs[timesMs.length - 1];
  const step = Math.max(1, Math.floor(series.length / 800));
  const pts: string[] = [];
  for (let i = 0; i < series.length; i += step) {
    const px = (timesMs[i] / tEnd) * W;
    const py = H - 10 - ((series[i] - min) / span) * (H - 20);
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  return (
    <div>
      <p style={note}>{label}（{unit}）：最小 {min.toFixed(2)}，最大 {max.toFixed(2)}。</p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        style={{ width: '100%', height: 'auto', background: '#08131d', display: 'block' }}
      >
        <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts.join(' ')} />
      </svg>
      <p style={note}>横轴 0–{tEnd.toFixed(0)} ms；纵轴 {min.toFixed(1)}–{max.toFixed(1)} {unit}。</p>
    </div>
  );
}

export default function CellularLab({
  liveE = null,
  liveP = null,
  regionLabel = null,
  regionId = null,
  onApplyBias,
}: {
  /**
   * PR8-LINK 直播接线（App 传）：选中脑区的直播 E/P 与标签。
   * 不传（或未选脑区）时前向耦合无输入，按钮禁用，不再手填 E。
   */
  liveE?: number | null;
  liveP?: number | null;
  regionLabel?: string | null;
  regionId?: number | null;
  /**
   * 反向应用：把细胞发放率算出的 dP（P 单位）经 App 的 handleBiasChange
   * 真实应用回主仿真（setBias）。返回引擎实际存下的偏置值（已钳制）。
   */
  onApplyBias?: (dP: number) => number;
}) {
  const [model, setModel] = useState<ModelKind>('hh');
  // 电流注入：LIF/多房室用 pA，HH 用 uA/cm^2；脉冲窗 100–300 ms（LIF）/
  // 10–60 ms（HH）/ 10–12 ms（多房室胞体）。
  const [ampPA, setAmpPA] = useState(600);
  const [ampHH, setAmpHH] = useState(10);
  const [mcTarget, setMcTarget] = useState<TargetKind>('soma');
  const [mcAmpPA, setMcAmpPA] = useState(1000);
  const [synapseOn, setSynapseOn] = useState(false);
  // PR8-LINK：前向 E 不再手填——取选中脑区的直播 E（App 传 liveE）；
  // 未选脑区时为 null，耦合面板显示“未选脑区”，不用默认值冒充。
  const regionE = liveE;
  const [result, setResult] = useState<RunResult | null>(null);
  const [appliedBias, setAppliedBias] = useState<number | null>(null);
  const [ampNumbers, setAmpNumbers] = useState<{
    pspUv: number; pspActiveUv: number; volleyUv: number;
  } | null>(null);

  const lifMappedPA = useMemo(
    () => (regionE === null ? null : wcToLifCurrentPA(regionE)),
    [regionE],
  );
  const hhMapped = useMemo(
    () => (regionE === null ? null : wcToHhCurrentDensityUAperCm2(regionE)),
    [regionE],
  );

  function run(overrides: {
    kind?: ModelKind;
    lifCurrentPA?: number;
    hhCurrentDensity?: number;
    synapse?: boolean;
  } = {}) {
    // The effective values are passed explicitly: React state setters are asynchronous.
    // Calling a mapped-current button must compute immediately, not on a second click.
    setAppliedBias(null);
    const effectiveModel = overrides.kind ?? model;
    const effectiveAmpPA = overrides.lifCurrentPA ?? ampPA;
    const effectiveAmpHH = overrides.hhCurrentDensity ?? ampHH;
    const effectiveSynapseOn = overrides.synapse ?? synapseOn;
    if (effectiveModel === 'lif') {
      if (effectiveSynapseOn) {
        // 电导型突触驱动：AMPA 事件在 100 ms、GABA 事件在 200 ms，
        // 电流依赖实时膜电位（逐个步进，不能用固定电流函数）。
        const neuron = createLifNeuron();
        const ampa = { kind: 'ampa' as const, gMaxNS: 2, shape: 'alpha' as const };
        const gaba = { kind: 'gaba' as const, gMaxNS: 2, shape: 'alpha' as const };
        const timesMs: number[] = [0];
        const vMv: number[] = [neuron.read().vMv];
        const spikes: number[] = [];
        const n = Math.round(500 / DEFAULT_LIF_PARAMS.dtMs);
        for (let k = 0; k < n; k++) {
          const t = k * DEFAULT_LIF_PARAMS.dtMs;
          const v = neuron.read().vMv;
          // AMPA 与 GABA 各自的反转电位不同，分别算电流再相加；
          // 注入电流 = -外向电流（膜方程符号约定）。
          const iAmpa = -synapseCurrentPA(
            synapseConductanceNS(ampa, t, [100]), v, SYNAPSE_DEFAULTS.ampa.eRevMv);
          const iGaba = -synapseCurrentPA(
            synapseConductanceNS(gaba, t, [200]), v, SYNAPSE_DEFAULTS.gaba.eRevMv);
          const before = neuron.read().spikeCount;
          const s = neuron.step(iAmpa + iGaba);
          if (s.spikeCount > before && s.lastSpikeMs !== null) spikes.push(s.lastSpikeMs);
          timesMs.push(s.tMs);
          vMv.push(s.vMv);
        }
        setResult({
          kind: 'lif', timesMs, vMv, spikeTimesMs: spikes,
          rateHz: spikes.length / 0.5,
          extraNote: '突触驱动：100 ms 一发 AMPA（gMax 2 nS）、200 ms 一发 GABA（gMax 2 nS），'
            + '无恒定注入电流。AMPA 去极化、GABA 超极化。',
        });
        return;
      }
      const trace = simulateLif(DEFAULT_LIF_PARAMS, 500,
        (t) => (t >= 100 && t < 300 ? effectiveAmpPA : 0));
      setResult({
        kind: 'lif', timesMs: trace.timesMs, vMv: trace.vMv,
        spikeTimesMs: trace.spikeTimesMs,
        rateHz: trace.spikeTimesMs.filter((s) => s >= 100).length / 0.4,
        extraNote: `脉冲 ${effectiveAmpPA} pA（100–300 ms）。解析稳态率 `
          + `${lifAnalyticRateHz(effectiveAmpPA).toFixed(1)} Hz（流变 ${lifRheobasePA()} pA）。`,
      });
      return;
    }
    if (effectiveModel === 'hh') {
      const trace = simulateHodgkinHuxley(DEFAULT_HH_PARAMS, 200,
        (t) => (t >= 10 && t < 60 ? effectiveAmpHH : 0));
      setResult({
        kind: 'hh', timesMs: trace.timesMs, vMv: trace.vMv,
        gNa: trace.gNaMSperCm2, gK: trace.gKMSperCm2,
        spikeTimesMs: trace.spikeTimesMs,
        rateHz: trace.spikeTimesMs.length / 0.05,
        extraNote: `阶跃 ${effectiveAmpHH} uA/cm^2（10–60 ms）。HH1952 标准参数，`
          + '静息 -65 mV，锋电位峰值约 +40 mV。',
      });
      return;
    }
    const target = mcTarget;
    const trace = simulateMulticompartment(DEFAULT_MULTICOMP_MORPHOLOGY, 200,
      (t) => {
        const on = t >= 10 && t < 12;
        const i = on ? mcAmpPA : 0;
        return target === 'soma' ? [i, 0, 0]
          : target === 'apical' ? [0, i, 0] : [0, 0, i];
      });
    setResult({
      kind: 'multicomp', timesMs: trace.timesMs, vMv: trace.vSomaMv,
      vApicalMv: trace.vApicalMv, vBasalMv: trace.vBasalMv,
      spikeTimesMs: trace.spikeTimesMs,
      rateHz: trace.spikeTimesMs.length / 0.2,
      extraNote: `胞体 HH 主动 + 顶/基树突被动电缆；${target === 'soma' ? '胞体' : target === 'apical' ? '顶树突' : '基树突'}`
        + `注入 ${mcAmpPA} pA（10–12 ms）。胞体 d=20 um、顶树突 d=2 um L=200 um，`
        + '轴向电导由几何算出（顶树突 31.38 nS）。',
    });
  }

  function runAmplitudeNumbers() {
    // 持续 PSP：75 pA 顶树突驱动 100–600 ms，被动胞体（干净线性稳态），
    // 取 300–500 ms 均值；主动胞体变体与同步锋电位齐射见文档。
    const passive = simulateMulticompartment(
      { ...DEFAULT_MULTICOMP_MORPHOLOGY, somaActive: false }, 600,
      (t) => [0, (t >= 100 && t < 600 ? 75 : 0), 0]);
    const idx = passive.timesMs.map((t, i) => (t >= 300 && t <= 500 ? i : -1))
      .filter((i) => i >= 0);
    const iAxMean = idx.reduce((s, i) => s + passive.iAxialApicalPA[i], 0) / idx.length;
    const qPop = cellularDipoleNAm(iAxMean, 0.11) * 1_000_000 * 0.08;
    const pspUv = impliedScalpUv(qPop);
    const active = simulateMulticompartment(
      DEFAULT_MULTICOMP_MORPHOLOGY, 600,
      (t) => [0, (t >= 100 && t < 600 ? 75 : 0), 0]);
    const iAxMeanA = idx.reduce((s, i) => s + active.iAxialApicalPA[i], 0) / idx.length;
    const pspActiveUv = impliedScalpUv(cellularDipoleNAm(iAxMeanA, 0.11) * 1_000_000 * 0.08);
    const volley = simulateMulticompartment(DEFAULT_MULTICOMP_MORPHOLOGY, 60,
      (t) => [(t >= 10 && t < 12 ? 2000 : 0), 0, 0], 0.05);
    const iPeak = Math.max(...volley.iAxialApicalPA.map(Math.abs));
    const volleyUv = impliedScalpUv(cellularDipoleNAm(iPeak, 0.11) * 1_000_000 * 0.08);
    setAmpNumbers({ pspUv, pspActiveUv, volleyUv });
  }

  const reverseDrive = result
    ? firingRateToPopulationDriveP(result.rateHz)
    : null;

  return (
    <div>
      <div style={panel}>
        <h3 style={title}>细胞级实验台（CellularLab）—— PR-13</h3>
        <p style={note}>{CELLULAR_LIMITATION}</p>
        <p style={note}>
          多尺度说明：从全脑放大到这里时，系统切换到真实的细胞级仿真模型，
          不是把全脑动画放大。LIF / HH / 多房室三个模型各自独立求解；
          Wilson–Cowan / Jansen–Rit 原样保留，不同模型里同名变量不混淆
          （JR 的 y0 是锥体群体突触后电位 mV，HH 的 V 是单神经元膜电位 mV）。
        </p>
        <div style={row}>
          <span style={{ fontSize: 13 }}>模型：</span>
          <button type="button" style={btn(model === 'lif')} onClick={() => setModel('lif')}>LIF</button>
          <button type="button" style={btn(model === 'hh')} onClick={() => setModel('hh')}>Hodgkin–Huxley</button>
          <button type="button" style={btn(model === 'multicomp')} onClick={() => setModel('multicomp')}>多房室神经元</button>
        </div>
        {model === 'lif' && (
          <div>
            <p style={note}>
              LIF：C=250 pF，gL=25 nS（tau=10 ms），EL=-65 mV，阈值 -50 mV，
              复位 -65 mV，不应期 2 ms，步长 0.1 ms；流变电流 375 pA。
            </p>
            <div style={row}>
              <label style={{ fontSize: 13 }} htmlFor="lif-amp">脉冲电流（100–300 ms）：</label>
              <input
                id="lif-amp" type="range" min={0} max={2000} step={10}
                value={ampPA} onChange={(e) => setAmpPA(Number(e.target.value))}
                style={{ flex: 1, minWidth: 120 }}
              />
              <input
                type="number" min={0} max={2000} step={10} value={ampPA}
                onChange={(e) => setAmpPA(Math.max(0, Math.min(2000, Number(e.target.value) || 0)))}
                style={{ width: 80 }}
              />
              <span style={{ fontSize: 13 }}>pA</span>
            </div>
            <div style={row}>
              <label style={{ fontSize: 13 }}>
                <input type="checkbox" checked={synapseOn} onChange={(e) => setSynapseOn(e.target.checked)} />
                {' '}改用突触驱动（100 ms AMPA + 200 ms GABA，各 2 nS，无恒定电流）
              </label>
            </div>
          </div>
        )}
        {model === 'hh' && (
          <div>
            <p style={note}>
              Hodgkin–Huxley 1952：C=1 uF/cm^2，gNa=120，gK=36，gL=0.3 mS/cm^2，
              ENa=+50 mV，EK=-77 mV，EL=-54.387 mV，静息 -65 mV，RK4 步长 0.025 ms。
            </p>
            <div style={row}>
              <label style={{ fontSize: 13 }} htmlFor="hh-amp">阶跃电流（10–60 ms）：</label>
              <input
                id="hh-amp" type="range" min={0} max={30} step={0.5}
                value={ampHH} onChange={(e) => setAmpHH(Number(e.target.value))}
                style={{ flex: 1, minWidth: 120 }}
              />
              <input
                type="number" min={0} max={30} step={0.5} value={ampHH}
                onChange={(e) => setAmpHH(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                style={{ width: 80 }}
              />
              <span style={{ fontSize: 13 }}>uA/cm^2</span>
            </div>
          </div>
        )}
        {model === 'multicomp' && (
          <div>
            <p style={note}>
              多房室：胞体 d=20 um L=20 um（HH 主动），顶树突 d=2 um L=200 um、
              基树突 d=2 um L=100 um（被动电缆），Ra=100 Ohm·cm；
              轴向电导顶树突 31.38 nS、基树突 62.71 nS；电缆长度常数 408 um。
            </p>
            <div style={row}>
              <span style={{ fontSize: 13 }}>注入位置：</span>
              <button type="button" style={btn(mcTarget === 'soma')} onClick={() => setMcTarget('soma')}>胞体</button>
              <button type="button" style={btn(mcTarget === 'apical')} onClick={() => setMcTarget('apical')}>顶树突</button>
              <button type="button" style={btn(mcTarget === 'basal')} onClick={() => setMcTarget('basal')}>基树突</button>
            </div>
            <div style={row}>
              <label style={{ fontSize: 13 }} htmlFor="mc-amp">脉冲电流（10–12 ms）：</label>
              <input
                id="mc-amp" type="range" min={0} max={3000} step={50}
                value={mcAmpPA} onChange={(e) => setMcAmpPA(Number(e.target.value))}
                style={{ flex: 1, minWidth: 120 }}
              />
              <input
                type="number" min={0} max={3000} step={50} value={mcAmpPA}
                onChange={(e) => setMcAmpPA(Math.max(0, Math.min(3000, Number(e.target.value) || 0)))}
                style={{ width: 80 }}
              />
              <span style={{ fontSize: 13 }}>pA</span>
            </div>
          </div>
        )}
        <div style={row}>
          <button type="button" style={btn(false)} onClick={() => run()}>运行仿真</button>
          {result && (
            <span style={{ fontSize: 13 }}>
              发放 {result.spikeTimesMs.length} 次
              {result.spikeTimesMs.length > 0
                ? `（${result.spikeTimesMs.map((s) => s.toFixed(1)).join(', ')} ms）`
                : ''}
              ；发放率 {result.rateHz.toFixed(1)} Hz。
            </span>
          )}
        </div>
        {result && (
          <div>
            <p style={note}>{result.extraNote}</p>
            <TracePlot timesMs={result.timesMs} series={result.vMv} color="#22d3ee" label="膜电位" unit="mV" />
            {result.kind === 'multicomp' && result.vApicalMv && (
              <TracePlot timesMs={result.timesMs} series={result.vApicalMv} color="#7b61ff" label="顶树突膜电位" unit="mV" />
            )}
            {result.kind === 'multicomp' && result.vBasalMv && (
              <TracePlot timesMs={result.timesMs} series={result.vBasalMv} color="#a78bfa" label="基树突膜电位" unit="mV" />
            )}
            {result.kind === 'hh' && result.gNa && (
              <TracePlot timesMs={result.timesMs} series={result.gNa} color="#ffb829" label="Na 电导 gNa" unit="mS/cm^2" />
            )}
            {result.kind === 'hh' && result.gK && (
              <TracePlot timesMs={result.timesMs} series={result.gK} color="#ff8a5c" label="K 电导 gK" unit="mS/cm^2" />
            )}
          </div>
        )}
      </div>

      <div style={panel}>
        <h3 style={title}>跨尺度耦合（假设，未校准）</h3>
        <p style={note}>
          前向：脑区活动 E（无量纲，静息均值 E0=0.011）→ 细胞注入电流，
          线性映射 I = 增益 × (E − E0)。LIF 增益 1000 pA/单位 E；
          HH 增益 20 uA/cm^2/单位 E——两套模型单位不同，增益分开给，
          各自的数都写清；增益是假设，不是拟合值。
        </p>
        <p style={note}>
          {regionId === null || regionE === null
            ? '前向输入：未选脑区——先在主界面点一个脑区，E 取该脑区的直播值（约 15 Hz 更新）；这里不再手填 E。'
            : `前向输入：选中脑区 #${regionId} ${regionLabel ?? ''} 的直播 E = ${regionE.toFixed(3)}（无量纲，静息均值 E0=0.011）` +
              `；该脑区当前 P = ${liveP !== null ? liveP.toFixed(2) : '—'}（主仿真快照值）。`}
        </p>
        {regionE !== null && lifMappedPA !== null && hhMapped !== null && (
          <p style={note}>
            E={regionE.toFixed(2)} → LIF 注入电流 {lifMappedPA.toFixed(0)} pA
            （流变 375 pA）；HH 注入电流密度 {hhMapped.toFixed(2)} uA/cm^2
            （持续电流阈值约 9.8 uA/cm^2）。
          </p>
        )}
        <div style={row}>
          <button
            type="button"
            style={btn(false)}
            disabled={lifMappedPA === null}
            onClick={() => {
              if (lifMappedPA === null) return;
              const mapped = Math.max(0, Math.round(lifMappedPA));
              setModel('lif'); setAmpPA(mapped); setSynapseOn(false);
              run({ kind: 'lif', lifCurrentPA: mapped, synapse: false });
            }}
          >
            用该电流跑 LIF
          </button>
          <button
            type="button"
            style={btn(false)}
            disabled={hhMapped === null}
            onClick={() => {
              if (hhMapped === null) return;
              const mapped = Math.max(0, Math.min(30, hhMapped));
              setModel('hh'); setAmpHH(mapped);
              run({ kind: 'hh', hhCurrentDensity: mapped });
            }}
          >
            用该电流跑 HH
          </button>
        </div>
        <p style={note}>
          上方两个按钮会立即运行独立细胞求解器并更新膜电位曲线；不会自动改动主大脑。
          只有明确点击下方“把 dP 应用回主仿真”才会写入主仿真的偏置（耦合增益未校准）。
        </p>
        <p style={note}>
          反向：细胞发放率 → 群体驱动 dP = 0.002 × 发放率（P 单位/Hz，假设）。
          {result
            ? `本次运行发放率 ${result.rateHz.toFixed(1)} Hz → dP = ${reverseDrive !== null ? reverseDrive.toFixed(3) : '—'}（无量纲）。`
            : '先运行一次仿真，这里显示反向映射的 dP。'}
        </p>
        {result && reverseDrive !== null && (
          <div style={row}>
            <button
              type="button"
              style={btn(false)}
              disabled={!onApplyBias || regionId === null}
              onClick={() => {
                if (!onApplyBias) return;
                setAppliedBias(onApplyBias(reverseDrive));
              }}
              title="把 dP 经 App 的 handleBiasChange 真实应用回主仿真（setBias），不是只显示"
            >
              把 dP 应用回主仿真（偏置）
            </button>
            {appliedBias !== null && (
              <span style={{ fontSize: 13 }}>
                已应用偏置 {appliedBias >= 0 ? '+' : ''}{appliedBias.toFixed(3)}（选中脑区 #{regionId}，P 单位；主界面 REGION 面板可见该脑区 P 变化）。
              </span>
            )}
          </div>
        )}
      </div>

      <div style={panel}>
        <h3 style={title}>细胞路线对 PR6 幅度缺口能说什么（实时计算，不重缩放）</h3>
        <p style={note}>
          问题：oddball P300 真实峰值 8.89 uV，需要偶极矩 55.56 nA·m；
          JR 路线只给出 1.09 nA·m（0.174 uV）。细胞路线用多房室模型的
          胞体–顶树突轴向电流 × 几何间距 0.11 mm 算单细胞偶极矩，
          再按 PR5 假设外推到 80,000 个同步锥体细胞、Pz 增益 0.16 uV/(nA·m)。
        </p>
        <div style={row}>
          <button type="button" style={btn(false)} onClick={runAmplitudeNumbers}>计算细胞路线幅度</button>
        </div>
        {ampNumbers ? (
          <div>
            <p style={note}>
              持续 PSP（75 pA 顶树突驱动，300–500 ms 均值）：被动胞体{' '}
              {ampNumbers.pspUv.toFixed(3)} uV；主动胞体 {ampNumbers.pspActiveUv.toFixed(3)} uV。
            </p>
            <p style={note}>
              同步动作电位齐射峰值：{ampNumbers.volleyUv.toFixed(2)} uV
              ——仍不到真实值 8.89 uV 的一半，而且只是约 1 ms 的瞬态，
              不是 200 ms 持续的 ERP。
            </p>
            <p style={note}>
              结论：细胞路线没有弥合缺口——持续 PSP 路线距真实值差 110–150 倍，
              与 JR 路线同量级；缺口在群体规模/同步性/校准，不在模型类别。
              数字见 docs/pr7-cellular.md §5。
            </p>
          </div>
        ) : (
          <p style={note}>点“计算细胞路线幅度”后实时跑两段多房室仿真并给出数字。</p>
        )}
      </div>
    </div>
  );
}

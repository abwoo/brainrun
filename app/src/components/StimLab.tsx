import { useMemo, useState } from 'react';
import {
  BIPHASIC_PERIOD_RANGE_MS,
  DEFAULT_BIPHASIC_PERIOD_MS,
  DEFAULT_TMS_COIL,
  FIELD_TO_JR_GAIN_DEFAULT,
  FIELD_TO_WC_GAIN_DEFAULT,
  STIMULATION_LIMITATION,
  fieldToDrive,
  figureEightFieldGrid,
  normalComponentVm,
  runAuditoryTrain,
  runDirectDrive,
  runLevelDResponse,
  runVisualFlicker,
  tesElectricField,
  tesFieldGrid,
  tmsBiphasicPulse,
  tmsFieldForShape,
  tmsFieldGrid,
  type AuditoryTrainResult,
  type ColumnModel,
  type ColumnResponse,
  type FieldGridPoint,
  type StimLevel,
  type TesElectrode,
  type TmsCoil,
  type TmsCoilShape,
  type Vec3Mm,
} from '../lib/stimulation';
import { welchPsd } from '../lib/signalProcessing';

const LEVEL_MEANING: Record<StimLevel, string> = {
  A: 'Level A · 直接神经模型输入：给局部 WC/JR 柱加一个写清的驱动，不声称是完整的 tES/TMS 物理刺激。',
  B: 'Level B · TES 电场：头皮电极（mA）→ 均匀导体点源解析解算出的头内电场，无颅骨/边界/FEM。',
  C: 'Level C · TMS 电磁场：圆形或 8 字形线圈（半径/匝数/dI/dt）→ 法拉第感应电场，均匀导体 σ=0.33 S/m；双相波形为一个余弦周期的 dI/dt(t)，E(t) 线性跟随。',
  D: 'Level D · 电场到神经响应：目标处沿皮层法向的电场分量经未校准增益映射为柱的附加输入。电场强不等于真实大脑必然兴奋/抑制。',
};

const TARGET_PRESETS: { label: string; pos: Vec3Mm }[] = [
  { label: '皮层顶部 [0, 0, 70]', pos: [0, 0, 70] },
  { label: '顶部偏右 [30, 0, 70]', pos: [30, 0, 70] },
  { label: '前部皮层 [0, 40, 40]', pos: [0, 40, 40] },
  { label: '脑中心 [0, 0, 16]', pos: [0, 0, 16] },
];
const ELECTRODE_POSITIONS: { label: string; pos: Vec3Mm }[] = [
  { label: '顶部 [0, 0, 95]', pos: [0, 0, 95] },
  { label: '前部 [0, 95, 0]', pos: [0, 95, 0] },
  { label: '后部 [0, -95, 0]', pos: [0, -95, 0] },
  { label: '左侧 [-95, 0, 0]', pos: [-95, 0, 0] },
  { label: '右侧 [95, 0, 0]', pos: [95, 0, 0] },
];
const NORMALS: { label: string; n: Vec3Mm }[] = [
  { label: '径向 Z [0, 0, 1]', n: [0, 0, 1] },
  { label: 'X [1, 0, 0]', n: [1, 0, 0] },
  { label: 'Y [0, 1, 0]', n: [0, 1, 0] },
];

function Trace({ q, times, color }: { q: number[]; times: number[]; color: string }) {
  const W = 560, H = 120;
  const max = Math.max(1e-9, ...q.map(Math.abs));
  const step = Math.max(1, Math.floor(q.length / 280));
  const pts: string[] = [];
  for (let i = 0; i < q.length; i += step) {
    pts.push(`${((times[i] - times[0]) / (times[times.length - 1] - times[0])) * W},${H / 2 - (q[i] / max) * (H / 2 - 6)}`);
  }
  return <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: '#0a1622', border: '1px solid #133954' }}
    role="img" aria-label="柱偶极矩随时间变化曲线">
    <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#33475a" strokeWidth="1" />
    <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" />
    <text x="6" y="14" fill="#9cabb8" fontSize="11">峰值 |q| {max.toFixed(3)} nA·m</text>
  </svg>;
}

/** PR8-D: field arrows from real computed grid values (central y-slice, X–Z side view).
 *  Only the grid points with |y| <= 20 mm are drawn (a documented 2-D slice of
 *  the 3-D field, not the whole volume); each arrow's direction is the true
 *  (Ex, Ez) of that point and its length scales with the true |E|.
 *  No decorative arrows: every arrow comes from a `tesFieldGrid` /
 *  `tmsFieldGrid` / `figureEightFieldGrid` value. */
function FieldArrows({ grid, maxMag }: { grid: FieldGridPoint[]; maxMag: number }) {
  const W = 560, H = 360;
  const s = Math.min(W, H) / 200;
  const cx = W / 2, cy = H / 2;
  const slice = grid.filter(p => Math.abs(p.positionMm[1]) <= 20);
  const arrows = slice.map((p, i) => {
    const [x, , z] = p.positionMm;
    const [ex, , ez] = p.fieldVm;
    const m = Math.hypot(ex, ez);
    if (m <= 1e-12 || maxMag <= 0) return null;
    const len = 4 + 16 * (p.magnitudeVm / maxMag);
    const ux = ex / m, uz = ez / m;
    const x1 = cx + x * s, y1 = cy - z * s;
    const x2 = x1 + ux * len, y2 = y1 - uz * len;
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke="#22d3ee" strokeWidth="1.2" opacity={0.35 + 0.65 * (p.magnitudeVm / maxMag)} />;
  });
  return <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: '#0a1622', border: '1px solid #133954' }}
    role="img" aria-label={`中央 y 切片场箭头（|y|≤20 mm，${slice.length} 个真实场矢量，X–Z 投影）`}>
    <circle cx={cx} cy={cy} r={85.5 * s} fill="none" stroke="#33475a" strokeWidth="1" />
    <line x1={cx - 85.5 * s} y1={cy} x2={cx + 85.5 * s} y2={cy} stroke="#1c2f40" strokeWidth="1" />
    {arrows}
    <text x="6" y="14" fill="#9cabb8" fontSize="11">中央 y 切片（|y|≤20 mm），{slice.length} 个箭头，方向 = 真实 (Ex, Ez)，长度 ∝ |E|</text>
  </svg>;
}

/** PR8-D: biphasic pulse E(t) — the dominant field component (signed, so the
 *  sign reversal between the two half-cycles is visible). Values come from
 *  `tmsBiphasicPulse` (static field at peak dI/dt, scaled by cos). */
function BiphasicTrace({ pulse }: { pulse: ReturnType<typeof tmsBiphasicPulse> }) {
  const W = 560, H = 120;
  const peak = pulse.fieldVm[0];
  const comp = [0, 1, 2].reduce((a, b) => Math.abs(peak[a]) >= Math.abs(peak[b]) ? a : b, 0);
  const names = ['Ex', 'Ey', 'Ez'];
  const max = Math.max(1e-9, ...pulse.fieldVm.map(f => Math.abs(f[comp])));
  const T = pulse.timesMs[pulse.timesMs.length - 1];
  const pts = pulse.timesMs.map((t, i) =>
    `${(t / T) * W},${H / 2 - (pulse.fieldVm[i][comp] / max) * (H / 2 - 6)}`).join(' ');
  return <div>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: '#0a1622', border: '1px solid #133954' }}
      role="img" aria-label={`双相脉冲 ${names[comp]} 随时间变化曲线`}>
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#33475a" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth="1.5" />
      <text x="6" y="14" fill="#9cabb8" fontSize="11">{names[comp]} 峰值 {max.toFixed(2)} V/m（t=0），周期 {T.toFixed(2)} ms</text>
    </svg>
    <p className="panel-text">双相波形：dI/dt(t) = 峰值 × cos(2πt/T)，t ∈ [0, T]，其余为 0；E(t) 按线性跟随。峰值 |E| {pulse.peakMagnitudeVm.toFixed(2)} V/m（{pulse.shape === 'figure8' ? '8 字形' : '圆环'}线圈）。</p>
  </div>;
}

/** PR-14 · 脑刺激实验室：Level A/B/C/D + 感觉输入。所有控件都对应 stimulation.ts 里的真实函数。 */
export default function StimLab({ onClose }: { onClose: () => void }) {
  const [level, setLevel] = useState<StimLevel>('B');
  const [model, setModel] = useState<ColumnModel>('wc');
  const [targetIdx, setTargetIdx] = useState(0);
  const [anodePosIdx, setAnodePosIdx] = useState(0);
  const [cathodePosIdx, setCathodePosIdx] = useState(2);
  const [tesCurrentMA, setTesCurrentMA] = useState(2);
  const [sigma, setSigma] = useState(0.33);
  const [coil, setCoil] = useState<TmsCoil>({ ...DEFAULT_TMS_COIL });
  const [coilShape, setCoilShape] = useState<TmsCoilShape>('circular');
  const [showFieldArrows, setShowFieldArrows] = useState(false);
  const [biphasicPeriodMs, setBiphasicPeriodMs] = useState(DEFAULT_BIPHASIC_PERIOD_MS);
  const [fieldSource, setFieldSource] = useState<'tes' | 'tms'>('tms');
  const [normalIdx, setNormalIdx] = useState(0);
  const [wcGain, setWcGain] = useState(FIELD_TO_WC_GAIN_DEFAULT);
  const [jrGain, setJrGain] = useState(FIELD_TO_JR_GAIN_DEFAULT);
  const [drive, setDrive] = useState(1.4);
  const [driveMs, setDriveMs] = useState(100);
  const [response, setResponse] = useState<ColumnResponse | null>(null);
  const [responseLabel, setResponseLabel] = useState('');
  const [flickerHz, setFlickerHz] = useState(10);
  const [flickerIntensity, setFlickerIntensity] = useState(1);
  const [flickerPeakHz, setFlickerPeakHz] = useState<number | null>(null);
  const [toneHz, setToneHz] = useState(1000);
  const [audIntensity, setAudIntensity] = useState(1);
  const [isiMs, setIsiMs] = useState(500);
  const [auditory, setAuditory] = useState<AuditoryTrainResult | null>(null);

  const target = TARGET_PRESETS[targetIdx].pos;
  const normal = NORMALS[normalIdx].n;
  const electrodes: TesElectrode[] = useMemo(() => [
    { label: 'Anode', positionMm: ELECTRODE_POSITIONS[anodePosIdx].pos, currentMA: tesCurrentMA },
    { label: 'Cathode', positionMm: ELECTRODE_POSITIONS[cathodePosIdx].pos, currentMA: -tesCurrentMA },
  ], [anodePosIdx, cathodePosIdx, tesCurrentMA]);
  const tes = useMemo(() => {
    try { return tesElectricField(electrodes, target, sigma); } catch { return null; }
  }, [electrodes, target, sigma]);
  const tms = useMemo(() => {
    try { return tmsFieldForShape(coil, coilShape, target); } catch { return null; }
  }, [coil, coilShape, target]);
  const field = fieldSource === 'tes' ? tes : tms;
  const normalField = field ? normalComponentVm(field.fieldVm, normal) : null;
  const grid = useMemo(() => {
    try {
      if (fieldSource === 'tes') return tesFieldGrid(electrodes, sigma, 40);
      return coilShape === 'figure8' ? figureEightFieldGrid(coil, 40) : tmsFieldGrid(coil, 40);
    } catch { return []; }
  }, [fieldSource, electrodes, sigma, coil, coilShape]);
  const gridMax = grid.length ? Math.max(...grid.map(p => p.magnitudeVm)) : 0;
  const biphasic = useMemo(() => {
    try {
      return tmsBiphasicPulse(coil, target, { shape: coilShape, periodMs: biphasicPeriodMs });
    } catch { return null; }
  }, [coil, coilShape, target, biphasicPeriodMs]);

  const runLevelResponse = () => {
    try {
      if (level === 'A') {
        const r = runDirectDrive({ model, drive, durationMs: driveMs });
        setResponse(r); setResponseLabel(`Level A 直接驱动 ${drive}（${model === 'wc' ? '模型单位' : '1/s'}，${driveMs} ms）`);
      } else if (level === 'D' && field) {
        const r = runLevelDResponse({
          fieldVm: field.fieldVm, normalHead: normal, model,
          wcGain, jrGain, durationMs: driveMs,
        });
        setResponse(r);
        setResponseLabel(`Level D ${fieldSource === 'tes' ? 'TES' : 'TMS'} 场法向分量 ${r.normalFieldVm.toFixed(3)} V/m → 驱动 ${r.driveApplied.toFixed(3)}（增益 ${r.gainUsed}，未校准）`);
      }
    } catch (e) {
      setResponse(null);
      setResponseLabel('运行失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };
  const runFlicker = () => {
    try {
      const r = runVisualFlicker({ freqHz: flickerHz, intensity: flickerIntensity });
      const steady = r.qNAm.filter((_, i) => r.timesMs[i] >= 500);
      const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
      const { freqsHz, psd } = welchPsd(steady.map(v => v - mean), 250, { nFft: 256 });
      let peakF = freqsHz[0], peakP = -Infinity;
      for (let k = 1; k < psd.length; k++) if (psd[k] > peakP) { peakP = psd[k]; peakF = freqsHz[k]; }
      setFlickerPeakHz(peakF);
      setResponse(r); setResponseLabel(`视觉闪烁 ${flickerHz} Hz，强度 ${flickerIntensity}（WC 柱，零均值正弦驱动）`);
    } catch (e) {
      setResponse(null);
      setResponseLabel('运行失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };
  const runAuditory = () => {
    try {
      const r = runAuditoryTrain({ toneHz, intensity: audIntensity, isiMs, totalMs: 5000 });
      setAuditory(r); setResponse(r); setResponseLabel(`听觉 burst 串：音调 ${toneHz} Hz（仅记录，不进入动力学），强度 ${audIntensity}，ISI ${isiMs} ms`);
    } catch (e) {
      setAuditory(null); setResponse(null);
      setResponseLabel('运行失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal screen" role="dialog" aria-modal="true" aria-label="脑刺激实验室"
      onClick={e => e.stopPropagation()} style={{ width: 'min(1120px,96vw)', maxWidth: 'none', maxHeight: '94vh' }}>
      <div className="screen-title" style={{ display: 'flex', justifyContent: 'space-between', right: 0, pointerEvents: 'auto' }}>
        PR-14 · STIMULATION LAB
        <button className="chip chip-small" type="button" onClick={onClose}>关闭</button>
      </div>
      <div className="modal-body">
        <p className="panel-text" style={{ color: '#ffb340' }}>{STIMULATION_LIMITATION}</p>
        <label className="panel-text">级别
          <select aria-label="刺激级别" value={level} onChange={e => setLevel(e.target.value as StimLevel)}>
            <option value="A">Level A · 直接神经模型输入</option>
            <option value="B">Level B · TES 电场</option>
            <option value="C">Level C · TMS 电磁场</option>
            <option value="D">Level D · 电场到神经响应</option>
          </select>
        </label>
        <p className="panel-text">{LEVEL_MEANING[level]}</p>
        <label className="panel-text">柱模型
          <select aria-label="柱模型" value={model} onChange={e => setModel(e.target.value as ColumnModel)}>
            <option value="wc">Wilson–Cowan 柱</option>
            <option value="jr">Jansen–Rit 柱</option>
          </select>
        </label>
        <label className="panel-text">目标位置（球心坐标，mm）
          <select aria-label="目标位置" value={targetIdx} onChange={e => setTargetIdx(Number(e.target.value))}>
            {TARGET_PRESETS.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}
          </select>
        </label>

        {(level === 'B' || (level === 'D' && fieldSource === 'tes')) && <div>
          <div className="conn-title">TES 电极配置 · 电流 mA</div>
          <label className="panel-text">阳极位置
            <select aria-label="阳极位置" value={anodePosIdx} onChange={e => setAnodePosIdx(Number(e.target.value))}>
              {ELECTRODE_POSITIONS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
            </select>
          </label>
          <label className="panel-text">阴极位置
            <select aria-label="阴极位置" value={cathodePosIdx} onChange={e => setCathodePosIdx(Number(e.target.value))}>
              {ELECTRODE_POSITIONS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
            </select>
          </label>
          <p className="panel-text">电流 {tesCurrentMA.toFixed(1)} mA（阳极 +，阴极 −，总和为零）</p>
          <input aria-label="TES 电流" type="range" min="0.5" max="4" step="0.1" value={tesCurrentMA}
            onChange={e => setTesCurrentMA(Number(e.target.value))} style={{ width: '100%' }} />
          <p className="panel-text">电导率 σ {sigma.toFixed(2)} S/m（均匀导体假设）</p>
          <input aria-label="TES 电导率" type="range" min="0.10" max="1.00" step="0.01" value={sigma}
            onChange={e => setSigma(Number(e.target.value))} style={{ width: '100%' }} />
        </div>}

        {(level === 'C' || (level === 'D' && fieldSource === 'tms')) && <div>
          <div className="conn-title">TMS 线圈配置</div>
          <label className="panel-text">线圈形状
            <select aria-label="线圈形状" value={coilShape} onChange={e => setCoilShape(e.target.value as TmsCoilShape)}>
              <option value="circular">圆环线圈（单环）</option>
              <option value="figure8">8 字形线圈（双环反向电流，线性叠加）</option>
            </select>
          </label>
          <p className="panel-text">线圈半径 {coil.radiusMm.toFixed(0)} mm</p>
          <input aria-label="线圈半径" type="range" min="10" max="100" step="1" value={coil.radiusMm}
            onChange={e => setCoil({ ...coil, radiusMm: Number(e.target.value) })} style={{ width: '100%' }} />
          <p className="panel-text">匝数 {coil.turns} 匝</p>
          <input aria-label="线圈匝数" type="range" min="1" max="50" step="1" value={coil.turns}
            onChange={e => setCoil({ ...coil, turns: Number(e.target.value) })} style={{ width: '100%' }} />
          <p className="panel-text">电流变化率 dI/dt {(coil.dIdtAPerS / 1e7).toFixed(1)}×10⁷ A/s</p>
          <input aria-label="电流变化率" type="range" min="0" max="20" step="1" value={coil.dIdtAPerS / 1e7}
            onChange={e => setCoil({ ...coil, dIdtAPerS: Number(e.target.value) * 1e7 })} style={{ width: '100%' }} />
          <p className="panel-text">线圈中心 [0, 0, 102] mm，轴向 +Z（贴头皮顶部）；目标在轴上时感应电场为零（对称性）。8 字形时两环中心沿线圈平面偏移 ±半径，反向电流，交界处场相加。</p>
          <div className="conn-title">双相 TMS 波形 · E(t)（一个脉冲周期）</div>
          <p className="panel-text">脉冲周期 {biphasicPeriodMs.toFixed(2)} ms（{BIPHASIC_PERIOD_RANGE_MS[0]}–{BIPHASIC_PERIOD_RANGE_MS[1]} ms；真实双相脉冲约 0.2–0.4 ms）</p>
          <input aria-label="双相脉冲周期" type="range" min={BIPHASIC_PERIOD_RANGE_MS[0]} max={BIPHASIC_PERIOD_RANGE_MS[1]} step="0.05" value={biphasicPeriodMs}
            onChange={e => setBiphasicPeriodMs(Number(e.target.value))} style={{ width: '100%' }} />
          {biphasic ? <BiphasicTrace pulse={biphasic} /> : <p className="panel-text">目标离线圈太近，无法计算脉冲波形。</p>}
        </div>}

        {(level === 'B' || level === 'C') && <div>
          <div className="conn-title">目标处电场读数 · V/m</div>
          {field ? <div>
            <p className="panel-text">E = ({field.fieldVm.map(v => v.toFixed(3)).join(', ')}) V/m，|E| = {field.magnitudeVm.toFixed(3)} V/m</p>
            <p className="panel-text">沿皮层法向（{NORMALS[normalIdx].label}）分量：{normalField !== null ? normalField.toFixed(3) : '—'} V/m</p>
            <p className="panel-text">网格场分布（脑内 {grid.length} 点，步长 40 mm）：最大 |E| {gridMax.toFixed(3)} V/m</p>
          </div> : <p className="panel-text">目标离电极/线圈太近或超出脑球，无法计算（点源奇点保护）。</p>}
          <label className="panel-text">皮层法向
            <select aria-label="皮层法向" value={normalIdx} onChange={e => setNormalIdx(Number(e.target.value))}>
              {NORMALS.map((n, i) => <option key={n.label} value={i}>{n.label}</option>)}
            </select>
          </label>
          <label className="panel-text">
            <input aria-label="显示场箭头" type="checkbox" checked={showFieldArrows}
              onChange={e => setShowFieldArrows(e.target.checked)} /> 显示场箭头（中央 y 切片，真实计算值）
          </label>
          {showFieldArrows && grid.length > 0 && <FieldArrows grid={grid} maxMag={gridMax} />}
        </div>}

        {level === 'D' && <div>
          <div className="conn-title">Level D · 电场到神经响应（增益未校准）</div>
          <label className="panel-text">场来源
            <select aria-label="Level D 场来源" value={fieldSource} onChange={e => setFieldSource(e.target.value as 'tes' | 'tms')}>
              <option value="tms">TMS 感应电场</option>
              <option value="tes">TES 电场</option>
            </select>
          </label>
          {field && <p className="panel-text">目标处 |E| {field.magnitudeVm.toFixed(3)} V/m，法向分量 {normalField !== null ? normalField.toFixed(3) : '—'} V/m</p>}
          <p className="panel-text">WC 增益 {wcGain} 模型单位/(V/m)（默认 {FIELD_TO_WC_GAIN_DEFAULT}）</p>
          <input aria-label="WC 增益" type="range" min="0" max="0.1" step="0.001" value={wcGain}
            onChange={e => setWcGain(Number(e.target.value))} style={{ width: '100%' }} />
          <p className="panel-text">JR 增益 {jrGain} (1/s)/(V/m)（默认 {FIELD_TO_JR_GAIN_DEFAULT}）</p>
          <input aria-label="JR 增益" type="range" min="0" max="10" step="0.1" value={jrGain}
            onChange={e => setJrGain(Number(e.target.value))} style={{ width: '100%' }} />
          {field && <p className="panel-text">映射后驱动：{(() => {
            try {
              const d = fieldToDrive(normalField ?? 0, { wcGain, jrGain });
              return `WC ${d.wcDrive.toFixed(3)} 模型单位，JR ${d.jrDrivePerS.toFixed(1)} 1/s`;
            } catch (e) { return '超出柱输入范围：' + (e instanceof Error ? e.message : String(e)); }
          })()}</p>}
        </div>}

        {(level === 'A' || level === 'D') && <div>
          <div className="conn-title">响应 · 柱 q(t) → Pz 代理 EEG（0.16 µV/(nA·m)）</div>
          <p className="panel-text">刺激时长 {driveMs} ms</p>
          <input aria-label="刺激时长" type="range" min="40" max="200" step="20" value={driveMs}
            onChange={e => setDriveMs(Number(e.target.value))} style={{ width: '100%' }} />
          {level === 'A' && <p className="panel-text">直接驱动 {drive.toFixed(1)}（{model === 'wc' ? '模型单位' : '1/s'}）</p>}
          {level === 'A' && <input aria-label="直接驱动" type="range" min={model === 'wc' ? -2 : 0} max={model === 'wc' ? 2 : 300}
            step={model === 'wc' ? 0.1 : 10} value={drive}
            onChange={e => setDrive(Number(e.target.value))} style={{ width: '100%' }} />}
          <button className="chip" type="button" onClick={runLevelResponse}>运行响应</button>
        </div>}

        <div>
          <div className="conn-title">感觉输入实验室</div>
          <p className="panel-text">视觉闪烁：{flickerHz} Hz，强度 {flickerIntensity.toFixed(2)}（WC 柱零均值正弦驱动，见 stimulation.ts）</p>
          <input aria-label="闪烁频率" type="range" min="1" max="30" step="1" value={flickerHz}
            onChange={e => setFlickerHz(Number(e.target.value))} style={{ width: '100%' }} />
          <input aria-label="闪烁强度" type="range" min="0" max="1" step="0.05" value={flickerIntensity}
            onChange={e => setFlickerIntensity(Number(e.target.value))} style={{ width: '100%' }} />
          <button className="chip" type="button" onClick={runFlicker}>运行闪烁实验</button>
          {flickerPeakHz !== null && <p className="panel-text">Welch PSD 峰：{flickerPeakHz.toFixed(2)} Hz（刺激 {flickerHz} Hz；复用 PR6 welchPsd）</p>}
          <p className="panel-text">听觉 burst：音调 {toneHz} Hz（仅记录，不进入动力学），强度 {audIntensity.toFixed(2)}，ISI {isiMs} ms</p>
          <input aria-label="音调频率" type="number" min="20" max="20000" step="10" value={toneHz}
            onChange={e => setToneHz(Number(e.target.value))} style={{ width: '100%' }} />
          <input aria-label="听觉强度" type="range" min="0" max="1" step="0.05" value={audIntensity}
            onChange={e => setAudIntensity(Number(e.target.value))} style={{ width: '100%' }} />
          <label className="panel-text">ISI
            <select aria-label="听觉 ISI" value={isiMs} onChange={e => setIsiMs(Number(e.target.value))}>
              <option value="250">250 ms</option>
              <option value="500">500 ms</option>
              <option value="1000">1000 ms</option>
            </select>
          </label>
          <button className="chip" type="button" onClick={runAuditory}>运行听觉实验</button>
          {auditory && <p className="panel-text">每 burst 后 300 ms 内峰值 |q|：{auditory.perBurstPeakAbsQNAm.map(v => v.toFixed(3)).join(', ')} nA·m；
            固定窗 [500, 1500] ms 内平均 |q|：{auditory.fixedWindowMeanAbsQNAm.toFixed(3)} nA·m</p>}
        </div>

        {response && <div>
          <div className="conn-title">响应结果</div>
          <p className="panel-text">{responseLabel}</p>
          <p className="panel-text">峰值 |q| {response.peakAbsQNAm.toFixed(3)} nA·m（{response.peakTimeMs.toFixed(0)} ms），
            Pz 代理峰值 {(response.peakAbsQNAm * 0.16).toFixed(3)} µV</p>
          <Trace q={response.qNAm} times={response.timesMs} color="#ffb340" />
        </div>}
        {!response && responseLabel && <p className="panel-text">{responseLabel}</p>}
        <p className="panel-text">单位：mm / nA·m / µV / ms / Hz / mA / V/m。坐标：球心头 RAS（mm），与 sphereForward.ts 同框。
          TES 公式 E=Σ I(r−r_k)/(4πσ|r−r_k|³)；TMS 公式 E=−μ₀N(dI/dt)/(4π)∮dl/|r−r′|。详见 docs/pr7-stimulation.md。</p>
      </div>
    </div>
  </div>;
}

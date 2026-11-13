import {analysisBandwidthHz} from '../lib/scientificValidity';
import {useI18n} from '../lib/i18n';
/**
 * PR6 (B2) — WAVES tab：PSD / 频段 / 峰值 / 预设。
 *
 * Props 约定（设计稿 §1.3，壳由 B1 写）：`{ recording, channel }`。
 * 本 tab 只做**显示与计算**（A1 的 `welchPsd`/`bandPowers`），不跑模型、
 * 不改记录。频段功率全部来自同一份记录的同一通道；没有为每个频段
 * 编造节律。
 *
 * 预设说明（写在界面上，不藏）：
 * - Alpha 探索 = JR p0=220 极限环，是自发节律（实测峰 ~10.99 Hz）。
 * - Oscillatory 10 Hz 正弦驱动 = 外部驱动，不是自发节律。
 * - 其余频段（delta/theta/beta/gamma）只作同一份信号的频段功率读数。
 *
 * 布局：纵向堆叠、无绝对定位、无重叠；1920×1080 与 978px 冒烟级查看。
 */
import { useMemo, useState } from 'react';
import type { EegRecording } from '../lib/eegData.ts';
import { EEG_BANDS, type EegBandName } from '../lib/eegData.ts';
import { DEFAULT_NOISE, generateNoise } from '../lib/eegRecording.ts';
import { bandPowers, welchPsd } from '../lib/signalProcessing.ts';
import { PUBLIC_EEG_CONSTRAINT } from '../lib/publicEegConstraint.ts';

const BAND_ORDER: EegBandName[] = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
const BAND_LABEL: Record<EegBandName, string> = {
  delta: 'Delta 0.5–4 Hz',
  theta: 'Theta 4–8 Hz',
  alpha: 'Alpha 8–13 Hz',
  beta: 'Beta 13–30 Hz',
  gamma: 'Gamma 30–45 Hz',
};

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

export default function WavesTab({
  recording,
  channel,
}: {
  recording: EegRecording | null;
  channel: string;
}) {
  // PR8-D：叠加 PR6 噪声背景（默认关）。噪声是伪迹、不是神经源：开关只
  // 改变 PSD 的输入信号，不改记录本身、不跑模型。默认噪声参数
  // （白 2 / 粉红 1 / 工频 0.5 / 漂移 0.5 µV RMS）与种子取自当前记录。
  const {locale}=useI18n();const text=(zh:string,en:string)=>locale==='zh-CN'?zh:en;
  const limit=recording?analysisBandwidthHz(recording):125;
  const [showBackground, setShowBackground] = useState(false);
  const analysis = useMemo(() => {
    if (!recording) return null;
    if(limit<=.5)return {error:text('来源带宽不足以分析脑电频段。','Source bandwidth is too low for EEG-band analysis.')} as const;
    const chIdx = recording.channels.findIndex((c) => c.label === channel);
    if (chIdx < 0) return { error: `通道 ${channel} 不在记录中` } as const;
    const analyseSignal = (x: number[]) => {
      const m = x.reduce((s, v) => s + v, 0) / x.length;
      const xc = x.map((v) => v - m);
      // Welch：nFft=1024（df≈0.244 Hz），周期 Hann、50% 重叠，与 Python scipy 同口径。
      const { freqsHz, psd } = welchPsd(xc, recording.sfreqHz, { nFft: 1024 });
      const bands = bandPowers(freqsHz, psd);
      let peakHz = 0;
      let peakPsd = -1;
      for (let i = 0; i < freqsHz.length; i++) {
        if (freqsHz[i]<limit&&freqsHz[i] >= EEG_BANDS.alpha[0] && freqsHz[i] <= EEG_BANDS.alpha[1] && psd[i] > peakPsd) {
          peakPsd = psd[i];
          peakHz = freqsHz[i];
        }
      }
      const total = BAND_ORDER.filter(b=>EEG_BANDS[b][1]<limit).reduce((s, b) => s + bands[b], 0);
      const shares: Record<EegBandName, number> = {} as Record<EegBandName, number>;
      for (const b of BAND_ORDER) shares[b] = total > 0 ? bands[b] / total : 0;
      const rms = Math.sqrt(xc.reduce((s, v) => s + v * v, 0) / xc.length);
      return { error: null, freqsHz, psd, bands, shares, peakHz, peakPsd, rms, n: x.length };
    };
    const x = recording.dataUv[chIdx];
    const base = analyseSignal(x);
    if (!showBackground) return { ...base, baseAlphaShare: base.shares.alpha, backgroundOn: false };
    const noise = generateNoise(
      DEFAULT_NOISE, recording.channels.length, x.length, recording.sfreqHz, recording.seed,
    );
    const mixed = x.map((v, j) => v + noise.total[chIdx][j]);
    const withBg = analyseSignal(mixed);
    return { ...withBg, baseAlphaShare: base.shares.alpha, backgroundOn: true };
  }, [recording, channel, showBackground,limit,locale]);

  if (!recording) {
    return (
      <div style={panel}>
        <h3 style={title}>频段 / PSD（WAVES）</h3>
        <p style={note}>还没有 EEG 记录。先在 EEG 页运行实验（B1 的运行按钮），再回来看频谱。</p>
      </div>
    );
  }
  if (!analysis || analysis.error) {
    return (
      <div style={panel}>
        <h3 style={title}>频段 / PSD（WAVES）</h3>
        <p style={note}>{analysis?.error ?? '无法计算频谱。'}</p>
      </div>
    );
  }

  const { freqsHz, psd, shares, peakHz, rms } = analysis;
  const realPz = PUBLIC_EEG_CONSTRAINT.alphaPeakHzAtPz;
  const realOz = PUBLIC_EEG_CONSTRAINT.alphaPeakHzAtOz;
  // PSD 曲线：0.5–45 Hz，y 取 log10（PSD 跨多个量级）。
  const lo = 0.5;
  const hi = Math.min(45,limit);
  const pts: string[] = [];
  let logMin = Infinity;
  let logMax = -Infinity;
  const logs: number[] = [];
  for (let i = 0; i < freqsHz.length; i++) {
    if (freqsHz[i] < lo || freqsHz[i] > hi) continue;
    const lv = Math.log10(Math.max(psd[i], 1e-12));
    logs.push(lv);
    if (lv < logMin) logMin = lv;
    if (lv > logMax) logMax = lv;
  }
  const W = 640;
  const H = 180;
  const xs: number[] = [];
  for (let i = 0; i < freqsHz.length; i++) {
    if (freqsHz[i] >= lo && freqsHz[i] <= hi) xs.push(freqsHz[i]);
  }
  for (let i = 0; i < xs.length; i++) {
    const px = ((xs[i] - lo) / (hi - lo)) * W;
    const py = H - 10 - ((logs[i] - logMin) / Math.max(logMax - logMin, 1e-9)) * (H - 20);
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }

  return (
    <div>
      <div style={panel}>
        <h3 style={title}>频段 / PSD（WAVES）——通道 {channel}</h3>
        <p style={note} data-testid="analysis-bandwidth" data-limit-hz={limit}>{text('来源有效分析上限','Source analysis ceiling')}: {limit.toFixed(2)} Hz</p>
        <label style={{ ...note, display: 'block', cursor: 'pointer' }}>
          <input aria-label="叠加噪声背景" type="checkbox" checked={showBackground}
            onChange={e => setShowBackground(e.target.checked)} /> 叠加 PR6 噪声背景（白 2 / 粉红 1 / 工频 0.5 / 漂移 0.5 µV RMS，伪迹，非神经源；只改变 PSD 输入，不改记录）
        </label>
        <p style={note}>
          Welch PSD · Hann · 50% overlap · Δf {(freqsHz[1]-freqsHz[0]).toFixed(3)} Hz.
          {' '}{text('Alpha 峰','Alpha peak')}: <strong>{analysis.peakPsd>1e-16&&limit>13?peakHz.toFixed(2)+' Hz':text('无可分辨峰值','No resolved peak')}</strong>.
          {' '}RMS {rms.toFixed(3)} µV.
          {analysis.backgroundOn&&text(' 此图叠加了单独标注的测量噪声。',' Separately labeled measurement noise is added to this view.')}
        </p>
        <details><summary>{text('公开记录的参考数值','Public-recording reference values')}</summary>
         <p style={note}>ds003061 · Pz {realPz.toFixed(2)} Hz · Oz {realOz.toFixed(2)} Hz · RMS 6.07 µV.
          {' '}{text('不同来源的描述性参考；不是当前实验的生理校准。','Descriptive values from a different source; not physiological calibration of this experiment.')}</p>
        </details>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${channel} 通道 Welch PSD（0.5–${hi.toFixed(1)} Hz，log 坐标）`}
          style={{ width: '100%', height: 'auto', background: '#08131d', display: 'block' }}
        >
          <polyline fill="none" stroke="#22d3ee" strokeWidth="1.5" points={pts.join(' ')} />
          <line x1={(8 - lo) / (hi - lo) * W} x2={(8 - lo) / (hi - lo) * W} y1="0" y2={H} stroke="#7b61ff" strokeDasharray="4 3" />
          <line x1={(13 - lo) / (hi - lo) * W} x2={(13 - lo) / (hi - lo) * W} y1="0" y2={H} stroke="#7b61ff" strokeDasharray="4 3" />
        </svg>
        <p style={note}>紫色虚线之间是 alpha 频段（8–13 Hz）。纵轴 log₁₀(µV²/Hz)。</p>
      </div>
      <div style={panel}>
        <h3 style={title}>频段功率占比（同一份信号，{channel}）</h3>
        {BAND_ORDER.map((b) => (
          <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 130, fontSize: 12, flexShrink: 0 }}>{BAND_LABEL[b]}</span>
            <div style={{ flex: 1, height: 12, background: '#13293a', borderRadius: 3, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${EEG_BANDS[b][1]<limit?(shares[b]*100).toFixed(1):0}%`,
                  height: '100%',
                  background: b === 'alpha' ? '#22d3ee' : '#7b61ff',
                }}
              />
            </div>
            <span style={{ width: 52, fontSize: 12, textAlign: 'right', flexShrink: 0 }}>
              {EEG_BANDS[b][1]<limit?(shares[b]*100).toFixed(1)+'%':text('带宽不足','Unavailable')}
            </span>
          </div>
        ))}
        <p style={note}>
          {text('占比分母仅包含来源带宽完整支持的频段。','Shares include only complete bands supported by the source bandwidth.')}JR p0=220 纯极限环的 alpha 占比约 99.8%，真实 Pz 只有 30.3%
          （真实脑电有宽带背景），模型无背景噪声，占比虚高是已知局限，不是拟合结果。
          叠加默认噪声背景后，10 s 纯极限环 Pz 记录的 alpha 占比实测由 99.8% 降至 13.5%
          （噪声功率压过微弱的极限环信号，低于真实 30.3%——背景加过了头，不是校准到 30.3%；
          见 PR8 方法学测试）。开关默认关闭，打开后上方同时显示未叠加时的占比以便对照。
        </p>
      </div>
      <div style={panel}>
        <h3 style={title}>预设（只上已验证的）</h3>
        <p style={note}>Alpha 探索 = JR p0=220 极限环，是柱模型自身的自发节律（实测峰 10.99 Hz）。</p>
        <p style={note}>Oscillatory 10 Hz 正弦驱动 = 外部驱动，已标注，不是自发节律。</p>
        <p style={note}>其余频段不设“节律”预设：只读同一份信号的频段功率，不为每个频段各编一个节律。</p>
      </div>
    </div>
  );
}

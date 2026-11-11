/**
 * PR-10 时频 tab（B3）。
 *
 * Props 约定（设计稿 §1.3，壳 EegAnalysisLab.tsx 传什么就接什么）：
 * `{ epochs, channel }`。不自己另写数据源。
 *
 * 内容：对同一份 EpochSet 用 STFT / Morlet / multitaper 做 ERSP（dB，
 * 基线归一化）与 ITC；时×频×功率热图（canvas）、频段功率随时间、
 * 时间–频率区域选择。三种方法的结果不直接混比：方法切换时数值会变，
 * 界面写清当前方法与参数（窗长/周期数/锥数）。
 *
 * 方法与参数（与 A1 的 signalProcessing.ts 一致）：
 * - STFT：nFft = min(256, 2^⌊log2(epoch 长)⌋)，hop = nFft/2，周期 Hann 窗；
 * - Morlet：cycles = 5，σ_t = cycles/(2πf)；
 * - multitaper：NW = 4、K = 7，窗长 = 7 个周期（低频窗可能长于整个 epoch）。
 * 功率口径同为 µV²（纯正弦幅值 A 在中心频率处 = A²/2），但窗长与泄漏
 * 特性不同，故三种方法的 ERSP 峰值本来就不一样（实测同一份 ERP：
 * morlet 3.36 dB、stft 5.37 dB），不得放进同一张表直接比。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EpochSet, EegBandName } from '../lib/eegData';
import { EEG_BANDS } from '../lib/eegData';
import { erspItc, morletTfr } from '../lib/signalProcessing';

export interface TfrTabProps {
  epochs: EpochSet | null;
  channel: string;
}

type TfrMethod = 'stft' | 'morlet' | 'multitaper';

const FREQS_HZ = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40];

const METHOD_NOTE: Record<TfrMethod, string> = {
  stft: 'STFT：nFft = min(256, epoch 长的 2 的幂)，hop = nFft/2，周期 Hann 窗。时间分辨率 = hop/fs，频率分辨率 = fs/nFft。',
  morlet: 'Morlet：cycles = 5，σ_t = cycles/(2πf)。低频小波很长，短 epoch 两端受零边界污染，只看中心段。',
  multitaper: 'Multitaper：NW = 4、K = 7 锥，窗长 = 7 个周期。低频窗可能长于整个 epoch，此时窗 = 全段。',
};

/** 发散配色：负 dB 蓝 → 0 白 → 正 dB 红（ERSP 用）。 */
function erspColor(db: number, maxAbs: number): string {
  const t = Math.max(-1, Math.min(1, db / Math.max(1e-9, maxAbs)));
  if (t >= 0) {
    const r = 255;
    const g = Math.round(255 * (1 - t * 0.8));
    const b = Math.round(255 * (1 - t));
    return `rgb(${r},${g},${b})`;
  }
  const r = Math.round(255 * (1 + t * 0.8));
  const g = Math.round(255 * (1 + t * 0.8));
  const b = 255;
  return `rgb(${r},${g},${b})`;
}

export default function TfrTab({ epochs, channel }: TfrTabProps) {
  const [method, setMethod] = useState<TfrMethod>('morlet');
  const [band, setBand] = useState<EegBandName>('beta');
  const [tWin, setTWin] = useState<[number, number]>([100, 500]);
  const [fWin, setFWin] = useState<[number, number]>([8, 30]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const tfr = useMemo(() => {
    if (!epochs || epochs.trials.length === 0) return null;
    try {
      return erspItc(epochs, channel, FREQS_HZ, method, epochs.baselineMs);
    } catch {
      return null;
    }
  }, [epochs, channel, method]);

  // 频段功率随时间：逐试次 Morlet 功率 → 频段内平均 → 试次平均（µV²）。
  const bandPower = useMemo(() => {
    if (!epochs || epochs.trials.length === 0) return null;
    const chIdx = epochs.channels.indexOf(channel);
    if (chIdx < 0) return null;
    const [lo, hi] = EEG_BANDS[band];
    const freqs: number[] = [];
    for (let f = Math.ceil(lo); f <= hi; f += 1) freqs.push(f);
    if (freqs.length === 0) return null;
    const nT = epochs.timesMs.length;
    const acc = new Array<number>(nT).fill(0);
    for (const tr of epochs.trials) {
      const r = morletTfr(tr[chIdx], epochs.sfreqHz, freqs, { cycles: 5 });
      for (let j = 0; j < nT; j++) {
        let s = 0;
        for (let f = 0; f < freqs.length; f++) s += r.power[f][j];
        acc[j] += s / freqs.length;
      }
    }
    return { timesMs: epochs.timesMs, powerUv2: acc.map((v) => v / epochs.trials.length), freqs };
  }, [epochs, channel, band]);

  // 区域选择：所选时间–频率窗内的平均 ERSP 与 ITC。
  const regionStats = useMemo(() => {
    if (!tfr) return null;
    let sE = 0;
    let sI = 0;
    let n = 0;
    for (let f = 0; f < FREQS_HZ.length; f++) {
      if (FREQS_HZ[f] < fWin[0] || FREQS_HZ[f] > fWin[1]) continue;
      for (let j = 0; j < tfr.timesMs.length; j++) {
        if (tfr.timesMs[j] < tWin[0] || tfr.timesMs[j] > tWin[1]) continue;
        sE += tfr.erspDb[f][j];
        sI += tfr.itc[f][j];
        n++;
      }
    }
    if (n === 0) return null;
    return { meanErspDb: sE / n, meanItc: sI / n, n };
  }, [tfr, tWin, fWin]);

  // 热图绘制。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tfr) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    let maxAbs = 1;
    for (const row of tfr.erspDb) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
    const nF = tfr.erspDb.length;
    const nT = tfr.timesMs.length;
    for (let f = 0; f < nF; f++) {
      for (let j = 0; j < nT; j++) {
        ctx.fillStyle = erspColor(tfr.erspDb[f][j], maxAbs);
        ctx.fillRect((j * w) / nT, ((nF - 1 - f) * h) / nF, w / nT + 1, h / nF + 1);
      }
    }
    // 区域选择框。
    const t0 = tfr.timesMs[0];
    const t1 = tfr.timesMs[tfr.timesMs.length - 1];
    const x0 = ((tWin[0] - t0) / (t1 - t0)) * w;
    const x1 = ((tWin[1] - t0) / (t1 - t0)) * w;
    const yTop = ((FREQS_HZ.length - 1 - FREQS_HZ.indexOf(Math.max(...FREQS_HZ.filter((f) => f <= fWin[1])))) * h) / FREQS_HZ.length;
    const yBot = ((FREQS_HZ.length - FREQS_HZ.indexOf(Math.min(...FREQS_HZ.filter((f) => f >= fWin[0])))) * h) / FREQS_HZ.length;
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, yTop, x1 - x0, yBot - yTop);
  }, [tfr, tWin, fWin]);

  if (!epochs) {
    return (
      <div>
        <h3>时频（ERSP / ITC）</h3>
        <p className="panel-text">还没有 epoch 数据。请先在 ERP tab 里切分试次（MNE 口径：−200–800 ms，基线 −200–0 ms）。</p>
      </div>
    );
  }
  const chIdx = epochs.channels.indexOf(channel);
  if (chIdx < 0) {
    return (
      <div>
        <h3>时频（ERSP / ITC）</h3>
        <p className="panel-text">通道 {channel} 不在当前 EpochSet 里（现有：{epochs.channels.join('、')}）。</p>
      </div>
    );
  }
  if (epochs.trials.length === 0) {
    return (
      <div>
        <h3>时频（ERSP / ITC）</h3>
        <p className="panel-text">全部试次都被峰峰值剔除，没有可平均的试次。</p>
      </div>
    );
  }

  const bandMax = bandPower ? Math.max(...bandPower.powerUv2, 1e-9) : 1;
  const tRange: [number, number] = [epochs.tminMs, epochs.tmaxMs];

  return (
    <div>
      <h3>时频（ERSP / ITC）——{channel}，{epochs.trials.length} 试次</h3>
      <p className="panel-text">
        ERSP = 10·log10(试次平均功率 / 基线功率)，基线 {epochs.baselineMs[0]}–{epochs.baselineMs[1]} ms；ITC = |试次平均 e^(iφ)|（0–1）。
        三种方法的结果不直接混比：同一份数据、不同方法算出的 ERSP 峰值本来就不一样（实测 ERP：Morlet 3.36 dB、STFT 5.37 dB）。
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <label>
          方法：
          <select value={method} onChange={(e) => setMethod(e.target.value as TfrMethod)} style={{ marginLeft: 6 }}>
            <option value="morlet">Morlet 小波</option>
            <option value="stft">STFT</option>
            <option value="multitaper">Multitaper</option>
          </select>
        </label>
        <label>
          频段：
          <select value={band} onChange={(e) => setBand(e.target.value as EegBandName)} style={{ marginLeft: 6 }}>
            {(Object.keys(EEG_BANDS) as EegBandName[]).map((b) => (
              <option key={b} value={b}>
                {b} {EEG_BANDS[b][0]}–{EEG_BANDS[b][1]} Hz
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="panel-text" style={{ marginTop: 0 }}>{METHOD_NOTE[method]}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="conn-title">ERSP 热图（dB，{method}）</div>
          <canvas
            ref={canvasRef}
            width={640}
            height={320}
            style={{ width: '100%', height: 'auto', display: 'block', background: '#fff', border: '1px solid #223' }}
            role="img"
            aria-label={`ERSP heatmap, ${channel}, ${method}`}
          />
          <p className="panel-text">
            横轴 {tRange[0]}–{tRange[1]} ms（相对事件），纵轴 2–40 Hz（上高下低）；黄色框 = 下方区域选择。
            蓝 = 功率低于基线，红 = 高于基线。
          </p>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="conn-title">{band} 带功率随时间（µV²，Morlet，cycles = 5）</div>
          {bandPower && (
            <svg width="100%" height="200" viewBox="0 0 640 200" preserveAspectRatio="none" role="img" aria-label={`${band} band power over time`}>
              <rect x={0} y={0} width={640} height={200} fill="#08131d" />
              {bandPower.timesMs.map((t, j) => {
                if (j === 0) return null;
                const x0 = ((bandPower.timesMs[j - 1] - tRange[0]) / (tRange[1] - tRange[0])) * 640;
                const x1 = ((t - tRange[0]) / (tRange[1] - tRange[0])) * 640;
                const y0 = 190 - (bandPower.powerUv2[j - 1] / bandMax) * 180;
                const y1 = 190 - (bandPower.powerUv2[j] / bandMax) * 180;
                return <line key={j} x1={x0} y1={y0} x2={x1} y2={y1} stroke="#22d3ee" strokeWidth={2} />;
              })}
              <line x1={((0 - tRange[0]) / (tRange[1] - tRange[0])) * 640} y1={0} x2={((0 - tRange[0]) / (tRange[1] - tRange[0])) * 640} y2={200} stroke="#ffb340" strokeWidth={1} />
            </svg>
          )}
          <p className="panel-text">峰值 {bandMax.toFixed(2)} µV²；橙色竖线 = 事件时刻 0 ms。注意：这是功率（µV²），不是 ERSP（dB），与热图的数值口径不同。</p>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="conn-title">时间–频率区域选择</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            时间窗：{tWin[0]}–{tWin[1]} ms
            <span style={{ display: 'flex', gap: 8 }}>
              <input type="range" min={tRange[0]} max={tRange[1]} step={4} value={tWin[0]} onChange={(e) => setTWin([Math.min(+e.target.value, tWin[1]), tWin[1]])} aria-label="区域起始时间" />
              <input type="range" min={tRange[0]} max={tRange[1]} step={4} value={tWin[1]} onChange={(e) => setTWin([tWin[0], Math.max(+e.target.value, tWin[0])])} aria-label="区域结束时间" />
            </span>
          </label>
          <label>
            频率窗：{fWin[0]}–{fWin[1]} Hz
            <span style={{ display: 'flex', gap: 8 }}>
              <input type="range" min={2} max={40} step={2} value={fWin[0]} onChange={(e) => setFWin([Math.min(+e.target.value, fWin[1]), fWin[1]])} aria-label="区域起始频率" />
              <input type="range" min={2} max={40} step={2} value={fWin[1]} onChange={(e) => setFWin([fWin[0], Math.max(+e.target.value, fWin[0])])} aria-label="区域结束频率" />
            </span>
          </label>
          {regionStats && (
            <span className="panel-text">
              区域内平均 ERSP <b>{regionStats.meanErspDb.toFixed(2)} dB</b>，平均 ITC <b>{regionStats.meanItc.toFixed(3)}</b>（{regionStats.n} 个时频格点）。
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

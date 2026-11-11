/**
 * PR6 (B2) — ERP tab：试次、ERP 波形、峰值/潜伏期、差异波、条件对照。
 *
 * Props 约定（设计稿 §1.3，壳由 B1 写）：
 * `{ recording, events, epochs, onEpochsChange, channel }`。
 * 本 tab 只做分段/平均/显示（A1 的 `epochRecording` + `averageEpochs`，
 * 经 `lateResponse.ts` 的 `epochOddballExperiment` / `analyseErp` /
 * `differenceWaveErp`），不重新跑模型（“运行实验”在 EEG 页，B1 的按钮）。
 *
 * 分段口径（MNE）：−200–800 ms、基线 −200–0 ms、峰峰值 >150 µV 剔除。
 * 峰值窗 250–600 ms、窗均值 300–500 ms，与 ds003061 约束口径一致。
 *
 * 布局：纵向堆叠、无绝对定位、无重叠；1920×1080 与 978px 冒烟级查看。
 */
import { useMemo, useState } from 'react';
import type { EegEvent, EegRecording, EpochSet } from '../lib/eegData.ts';
import {
  analyseErp,
  differenceWaveErp,
  epochOddballExperiment,
  filterEpochsByCondition,
} from '../lib/lateResponse.ts';
import { PUBLIC_EEG_CONSTRAINT } from '../lib/publicEegConstraint.ts';

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
const cell: React.CSSProperties = {
  border: '1px solid #2a3f52',
  padding: '4px 8px',
  fontSize: 12,
  textAlign: 'right',
};
const cellLeft: React.CSSProperties = { ...cell, textAlign: 'left' };

export default function ErpTab({
  recording,
  events,
  epochs,
  onEpochsChange,
  channel,
}: {
  recording: EegRecording | null;
  events: EegEvent[];
  epochs: EpochSet | null;
  onEpochsChange: (epochs: EpochSet) => void;
  channel: string;
}) {
  const [error, setError] = useState<string | null>(null);

  const analysis = useMemo(() => {
    if (!epochs) return null;
    const chRow = epochs.channels.indexOf(channel);
    if (chRow < 0) return { error: `通道 ${channel} 不在试次集中` } as const;
    const oddEp = filterEpochsByCondition(epochs, 'oddball');
    const stdEp = filterEpochsByCondition(epochs, 'standard');
    const odd = analyseErp(oddEp, channel);
    const std = analyseErp(stdEp, channel);
    const diff = differenceWaveErp(odd, std, chRow);
    return { error: null, oddEp, stdEp, odd, std, diff, chRow };
  }, [epochs, channel]);

  const handleEpoch = () => {
    setError(null);
    if (!recording) {
      setError('还没有 EEG 记录，先在 EEG 页运行实验。');
      return;
    }
    if (events.length === 0) {
      setError('还没有事件表，先在 EEG 页运行实验。');
      return;
    }
    try {
      onEpochsChange(epochOddballExperiment(recording, events));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ERP 波形图：oddball 均值 ± SEM（色带）+ standard 均值（虚线）+ 差异波（另图）。
  let svgOdd: string[] = [];
  let svgSemTop: string[] = [];
  let svgSemBottom: string[] = [];
  let svgStd: string[] = [];
  let svgDiff: string[] = [];
  let yMax = 1;
  if (analysis && !analysis.error) {
    const { odd, std, diff } = analysis;
    const all = [
      ...odd.meanUv[analysis.chRow],
      ...std.meanUv[analysis.chRow],
      ...diff.diffUv,
    ];
    yMax = Math.max(0.05, ...all.map((v) => Math.abs(v))) * 1.15;
    const W = 640;
    const H = 200;
    const xOf = (t: number) => ((t + 200) / 1000) * W;
    const yOf = (v: number) => H / 2 - (v / yMax) * (H / 2 - 10);
    const row = analysis.chRow;
    odd.timesMs.forEach((t, j) => {
      svgOdd.push(`${xOf(t).toFixed(1)},${yOf(odd.meanUv[row][j]).toFixed(1)}`);
      svgSemTop.push(`${xOf(t).toFixed(1)},${yOf(odd.meanUv[row][j] + odd.semUv[row][j]).toFixed(1)}`);
      svgSemBottom.push(`${xOf(t).toFixed(1)},${yOf(odd.meanUv[row][j] - odd.semUv[row][j]).toFixed(1)}`);
      svgStd.push(`${xOf(t).toFixed(1)},${yOf(std.meanUv[row][j]).toFixed(1)}`);
      svgDiff.push(`${xOf(t).toFixed(1)},${yOf(diff.diffUv[j]).toFixed(1)}`);
    });
  }
  const W = 640;
  const H = 200;
  const semBand =
    svgSemTop.length > 0 ? `${svgSemTop.join(' ')} ${[...svgSemBottom].reverse().join(' ')}` : '';

  return (
    <div>
      <div style={panel}>
        <h3 style={title}>事件相关电位（ERP）——通道 {channel}</h3>
        <p style={note}>
          分段口径（MNE）：−200–800 ms、基线 −200–0 ms、峰峰值 &gt;150 µV 剔除。峰值窗 250–600 ms、
          窗均值 300–500 ms。事件时间戳是仿真时钟（累计 ISI），不是浏览器墙钟。
        </p>
        <button
          type="button"
          onClick={handleEpoch}
          disabled={!recording || events.length === 0}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid #22d3ee',
            background: '#12303e',
            color: '#d7e5ef',
            cursor: recording && events.length > 0 ? 'pointer' : 'not-allowed',
            fontSize: 13,
          }}
        >
          切分试次（MNE 口径）
        </button>
        {error && <p style={{ ...note, color: '#ff9d9d' }}>{error}</p>}
        {!recording && <p style={note}>还没有 EEG 记录。先在 EEG 页运行实验。</p>}
        {recording && epochs && (
          <p style={note}>
            已切分：{epochs.trials.length} / {events.length} 试次保留，
            {events.length - epochs.trials.length} 试次被剔除（峰峰值超限或出界）。
          </p>
        )}
      </div>

      {analysis && !analysis.error && (
        <>
          <div style={panel}>
            <h3 style={title}>ERP 波形（µV）</h3>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={`${channel} 通道 oddball 与 standard 的 ERP 波形`}
              style={{ width: '100%', height: 'auto', background: '#08131d', display: 'block' }}
            >
              <line x1={W * 0.2} x2={W * 0.2} y1="0" y2={H} stroke="#426074" strokeDasharray="4 3" />
              <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#426074" />
              {semBand && <polygon fill="#22d3ee" opacity="0.18" points={semBand} />}
              <polyline fill="none" stroke="#22d3ee" strokeWidth="1.8" points={svgOdd.join(' ')} />
              <polyline fill="none" stroke="#a78bfa" strokeWidth="1.4" strokeDasharray="5 3" points={svgStd.join(' ')} />
            </svg>
            <p style={note}>
              青色实线 oddball（n={analysis.odd.n}，色带 ±SEM），紫色虚线 standard（n={analysis.std.n}）。
              竖虚线是刺激时刻（t=0）。纵轴 ±{yMax.toFixed(2)} µV。
            </p>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={`${channel} 通道 oddball 减 standard 差异波`}
              style={{ width: '100%', height: 'auto', background: '#08131d', display: 'block' }}
            >
              <line x1={W * 0.2} x2={W * 0.2} y1="0" y2={H} stroke="#426074" strokeDasharray="4 3" />
              <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#426074" />
              <polyline fill="none" stroke="#ffb829" strokeWidth="1.8" points={svgDiff.join(' ')} />
            </svg>
            <p style={note}>黄色实线是差异波（oddball − standard）。</p>
          </div>
          <div style={panel}>
            <h3 style={title}>峰值 / 潜伏期 / 窗均值（{channel}）</h3>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={cellLeft}>条件</th>
                  <th style={cell}>试次数</th>
                  <th style={cell}>峰值（µV）</th>
                  <th style={cell}>潜伏期（ms）</th>
                  <th style={cell}>300–500 ms 均值（µV）</th>
                  <th style={cell}>峰处 SEM（µV）</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={cellLeft}>Oddball</td>
                  <td style={cell}>{analysis.odd.n}</td>
                  <td style={cell}>{analysis.odd.peakUv.toFixed(3)}</td>
                  <td style={cell}>{analysis.odd.peakLatencyMs.toFixed(0)}</td>
                  <td style={cell}>{analysis.odd.windowMeanUv.toFixed(3)}</td>
                  <td style={cell}>
                    {analysis.odd.semUv[analysis.chRow][
                      analysis.odd.timesMs.indexOf(analysis.odd.peakLatencyMs)
                    ].toFixed(3)}
                  </td>
                </tr>
                <tr>
                  <td style={cellLeft}>Standard</td>
                  <td style={cell}>{analysis.std.n}</td>
                  <td style={cell}>{analysis.std.peakUv.toFixed(3)}</td>
                  <td style={cell}>{analysis.std.peakLatencyMs.toFixed(0)}</td>
                  <td style={cell}>{analysis.std.windowMeanUv.toFixed(3)}</td>
                  <td style={cell}>
                    {analysis.std.semUv[analysis.chRow][
                      analysis.std.timesMs.indexOf(analysis.std.peakLatencyMs)
                    ].toFixed(3)}
                  </td>
                </tr>
                <tr>
                  <td style={cellLeft}>差异波</td>
                  <td style={cell}>—</td>
                  <td style={cell}>{analysis.diff.peakUv.toFixed(3)}</td>
                  <td style={cell}>{analysis.diff.peakLatencyMs.toFixed(0)}</td>
                  <td style={cell}>{analysis.diff.windowMeanUv.toFixed(3)}</td>
                  <td style={cell}>—</td>
                </tr>
              </tbody>
            </table>
            <p style={note}>
              ds003061 实测对照（Pz）：oddball 峰 {PUBLIC_EEG_CONSTRAINT.p300PeakUvAtPz} µV @
              {PUBLIC_EEG_CONSTRAINT.p300PeakLatencyMs} ms、300–500 ms 均值 6.94 µV、差异波峰{' '}
              {PUBLIC_EEG_CONSTRAINT.differencePeakUvAtPz} µV。模型峰约 0.17 µV：形态对上（晚期正成分、
              潜伏期在窗内、oddball 选择性），幅度差约 50 倍——这是结构性缺口，没有靠重缩放修掉，
              见 docs/pr6-erp-mechanism.md。
            </p>
            <p style={note}>
              试次数量效应：SEM ≈ σ/√n。无噪声运行时试次完全相同、SEM 为 0（只有边界共享点带来
              ~1e-4 µV 级数值差异）；加测量噪声后，试次数翻 4 倍、SEM 约减半。
            </p>
          </div>
        </>
      )}
      {analysis?.error && (
        <div style={panel}>
          <p style={note}>{analysis.error}</p>
        </div>
      )}
    </div>
  );
}

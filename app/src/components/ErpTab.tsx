/**
 * PR6 (B2) — ERP tab：试次、ERP 波形、峰值/潜伏期、差异波、条件对照。
 *
 * Props 约定（设计稿 §1.3，壳由 B1 写）：
 * `{ recording, events, epochs, onEpochsChange, channel }`。
 * 本 tab 只做分段/平均/显示（A1 的 `epochRecording` + `averageEpochs`，
 * 经 `lateResponse.ts` 的 `epochOddballExperiment` / `analyseErp` /
 * `differenceWaveErp`），另有一个显式按钮可直接跑 late 机制 oddball
 * 实验（`runOddballExperiment`，单通道 Pz，见 PR8-NUMFIX）：壳实验
 * 记录是 plain WC/JR 模型、无 late 机制，250–600 ms 窗内基本无响应，
 * 表格峰值约 0 µV；late 实验的 oddball 峰才是 0.174 µV @352 ms。
 * 两条路径的文案是条件化的：0.17 µV 那句只在 late 数据下出现，
 * 壳记录路径下如实写窗内无响应，界面写的数与实际算出的数永不脱节。
 * “运行实验”在 EEG 页，B1 的按钮；本 tab 的 late 按钮同时提交 Raw、events、epochs，
 * 由壳原子更新共享数据（壳仍由 B1 持有，见 PR8-NUMFIX 与契约 §1.8）。
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
  runOddballExperiment,
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
  onEpochsChange: (epochs: EpochSet, origin: 'raw' | 'independent-late', input?: { recording: EegRecording; events: EegEvent[]; parameters: Record<string, unknown> }) => void;
  channel: string;
}) {
  const [error, setError] = useState<string | null>(null);
  // PR8-NUMFIX：当前 epochs 的来源。'shell' = 壳实验记录切分；
  // 'late' = 本 tab 的 late 机制 oddball 实验（单通道 Pz）。文案与
  // “已切分”计数都按来源条件化，不许出现界面写一个数、实际算另一个数。
  const [epochSource, setEpochSource] = useState<{
    kind: 'shell' | 'late';
    kept: number;
    total: number;
  } | null>(null);

  const analysis = useMemo(() => {
    if (!epochs) return null;
    const chRow = epochs.channels.indexOf(channel);
    if (chRow < 0) return { error: `通道 ${channel} 不在试次集中` } as const;
    const oddEp = filterEpochsByCondition(epochs, 'oddball');
    const stdEp = filterEpochsByCondition(epochs, 'standard');
    if (oddEp.trials.length === 0 || stdEp.trials.length === 0) {
      return { error: '需要保留的 standard 和 oddball 试次；自由脉冲不能代替实验条件。' } as const;
    }
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
      const ep = epochOddballExperiment(recording, events);
      setEpochSource({ kind: 'shell', kept: ep.trials.length, total: events.length });
      onEpochsChange(ep, 'raw');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // PR8-NUMFIX：late 机制 oddball 实验（单通道 Pz，40 试次：32 标准 +
  // 8 oddball）。壳实验记录是 plain WC/JR、无 late 机制，250–600 ms 窗内
  // 基本无响应（峰 ≈0、潜伏期落在窗首 252 ms）；只有这条路径算出的
  // oddball 峰才是 0.174 µV @352 ms，与机制文档 §4 一致。只改 epochs，
  // 不碰壳的 recording/events；late 实验是单通道 Pz，当前通道不是 Pz
  // 时下方会明确提示切通道，不静默换通道。
  const handleLateExperiment = () => {
    setError(null);
    try {
      const { recording: rec, events: evs, paramsSnapshot } = runOddballExperiment({});
      const ep = epochOddballExperiment(rec, evs);
      setEpochSource({ kind: 'late', kept: ep.trials.length, total: evs.length });
      onEpochsChange(ep, 'independent-late', { recording: rec, events: evs, parameters: paramsSnapshot });
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
            marginRight: 8,
          }}
        >
          切分试次（MNE 口径）
        </button>
        <button
          type="button"
          onClick={handleLateExperiment}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid #ffb829',
            background: '#3a2f10',
            color: '#d7e5ef',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          运行 oddball（同步全部分析）
        </button>
        <p style={note}>
          右边按钮跑 late 机制 oddball 实验（单通道 Pz，40 试次：32 标准 + 8 oddball），
          此操作同时载入原始记录、事件与试次；EEG、PSD、ERP、时频与可适用的分析使用同一次运行。单通道记录不支持多电极地形或源定位。
          左边按钮只切分 EEG 页的当前记录；late 实验才有 0.174 µV 的晚期峰。
        </p>
        {error && <p style={{ ...note, color: '#ff9d9d' }}>{error}</p>}
        {!recording && <p style={note}>还没有 EEG 记录。先在 EEG 页运行实验（或直接点 late 机制按钮）。</p>}
        {epochs && epochSource && (
          <p style={note}>
            已切分：{epochSource.kept} / {epochSource.total} 试次保留，
            {epochSource.total - epochSource.kept} 试次被剔除（峰峰值超限或出界）。
            来源：{epochSource.kind === 'late'
              ? 'late 机制 oddball 实验（单通道 Pz）'
              : 'EEG 页的壳实验记录'}。
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
              {PUBLIC_EEG_CONSTRAINT.differencePeakUvAtPz} µV。
            </p>
            {epochSource?.kind === 'late' ? (
              <p style={note}>
                模型峰约 0.17 µV（本表 oddball 行实测 {analysis.odd.peakUv.toFixed(3)} µV @
                {analysis.odd.peakLatencyMs.toFixed(0)} ms）：形态对上（晚期正成分、
                潜伏期在窗内、oddball 选择性），幅度差约 50 倍——这是结构性缺口，没有靠重缩放修掉，
                见 docs/pr6-erp-mechanism.md。
              </p>
            ) : (
              <p style={note}>
                注意：上面表格是壳实验记录（plain WC/JR 模型，无 late 机制）算出的——250–600 ms
                窗内基本无响应，峰值小于 0.001 µV（表格按 3 位小数显示为 0.000）、潜伏期落在窗首
                252 ms（窗内只有早期峰的衰减尾巴，最大 |值| 在窗首）。late 机制的模型峰约
                0.17 µV @352 ms（docs/pr6-erp-mechanism.md §4）要点上面“运行 oddball 实验
                （late 机制）”才会出现；幅度差约 50 倍是结构性缺口，没有靠重缩放修掉。
              </p>
            )}
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
          {epochSource?.kind === 'late' && (
            <p style={note}>
              late 机制 oddball 实验只出单通道 Pz：请在 EEG tab 把通道切到 Pz 再看本页，
              或点“切分试次”回到壳实验记录。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

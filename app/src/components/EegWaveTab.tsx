/**
 * PR-07 EEG tab（B1）：运行实验、参考、导联、噪声、通道选择、多导波形显示。
 *
 * 参考 UI（R4）：参考下拉有平均 / 无限远 / 电极三种；选“电极参考”时
 * 出现电极选择器（当前导联的通道）。三种参考的数值各不相同，见
 * `tests/pr6/eeg-recording.test.mjs` 的 R4 测试；切换参考只重算数值
 * （壳里调 `reReferenceRecording`），不重新跑模型。
 *
 * 波形：SVG 折线，每通道一行（全通道统一 µV 刻度，满格值标在图下），
 * 点一行即选该通道；选中的通道加粗高亮。噪声只影响数值，不画成
 * 神经源波形——噪声成分的标注见 `eegRecording.ts` 的 `generateNoise`。
 */
import { useMemo } from 'react';
import type { EegRecording, EegReference, NoiseParams } from '../lib/eegData';
import type { MontageKey } from '../lib/sphereForward';
import {
  DEFAULT_NOISE,
  NOISE_SLIDER_MAX_UV,
  NOISE_SLIDER_MIN_UV,
  recordingToCsv,
  recordingToJson,
  referenceLabel,
  rms,
  type SourceModel,
} from '../lib/eegRecording';

export interface EegWaveTabProps {
  recording: EegRecording | null;
  reference: EegReference;
  onReferenceChange: (ref: EegReference) => void;
  montage: MontageKey;
  onMontageChange: (m: MontageKey) => void;
  noise: NoiseParams | null;
  onNoiseChange: (n: NoiseParams | null) => void;
  onRunExperiment: () => void;
  running: boolean;
  selectedChannel: string;
  onSelectedChannelChange: (label: string) => void;
  sourceModel: SourceModel;
  onSourceModelChange: (m: SourceModel) => void;
  seed: number;
  onSeedChange: (seed: number) => void;
  durationMs: number;
  onDurationMsChange: (ms: number) => void;
  fixtureReady: boolean;
  fixtureError: string | null;
}

const MONTAGES: MontageKey[] = ['10-20', '10-10', '10-05'];

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function WaveRow({
  label,
  values,
  selected,
  scale,
  onSelect,
}: {
  label: string;
  values: number[];
  selected: boolean;
  scale: number;
  onSelect: () => void;
}) {
  const height = selected ? 56 : 30;
  const points = useMemo(() => {
    const step = Math.max(1, Math.floor(values.length / 600));
    const pts: string[] = [];
    for (let j = 0; j < values.length; j += step) {
      const x = (j / Math.max(1, values.length - 1)) * 1000;
      const y = height / 2 - (values[j] / scale) * (height / 2 - 2);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(' ');
  }, [values, height, scale]);
  return (
    <div
      className={`eeg-wave-row${selected ? ' eeg-wave-row-selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={`通道 ${label}${selected ? '（已选）' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
    >
      <span className="eeg-wave-label">{label}</span>
      <svg
        className="eeg-wave-svg"
        viewBox={`0 0 1000 ${height}`}
        preserveAspectRatio="none"
        style={{ height }}
        data-channel={label}
        aria-hidden="true"
      >
        <line x1="0" y1={height / 2} x2="1000" y2={height / 2} stroke="#22303f" strokeWidth="0.5" />
        <polyline
          points={points}
          fill="none"
          stroke={selected ? '#ffb340' : '#6c96b3'}
          strokeWidth={selected ? 1.6 : 1}
        />
      </svg>
    </div>
  );
}

export default function EegWaveTab(props: EegWaveTabProps) {
  const {
    recording, reference, onReferenceChange, montage, onMontageChange,
    noise, onNoiseChange, onRunExperiment, running,
    selectedChannel, onSelectedChannelChange,
    sourceModel, onSourceModelChange, seed, onSeedChange,
    durationMs, onDurationMsChange, fixtureReady, fixtureError,
  } = props;

  const scale = useMemo(() => {
    if (!recording) return 1;
    let m = 0;
    for (const row of recording.dataUv) {
      for (const v of row) m = Math.max(m, Math.abs(v));
    }
    return m > 0 ? m : 1;
  }, [recording]);

  const selectedStats = useMemo(() => {
    if (!recording) return null;
    const idx = recording.channels.findIndex((c) => c.label === selectedChannel);
    if (idx < 0) return null;
    const row = recording.dataUv[idx];
    return { maxAbs: Math.max(...row.map(Math.abs)), rmsUv: rms(row) };
  }, [recording, selectedChannel]);

  const refMode = reference.mode;
  const refElectrode = reference.mode === 'electrode' ? reference.label : '';

  const setNoiseField = (key: keyof NoiseParams, value: number) => {
    if (!noise) return;
    onNoiseChange({ ...noise, [key]: value });
  };

  return (
    <div className="eeg-tab">
      <div className="eeg-controls">
        <div className="eeg-control-group">
          <label htmlFor="eeg-source-model">源模型</label>
          <select
            id="eeg-source-model"
            value={sourceModel}
            onChange={(e) => onSourceModelChange(e.target.value as SourceModel)}
          >
            <option value="wc">Wilson–Cowan 柱（WC）</option>
            <option value="jr">Jansen–Rit 柱（JR，静息 p0=90）</option>
            <option value="both">双源线性叠加（WC + JR）</option>
          </select>
          <p className="eeg-hint">柱模型 q(t) 经球形 lead-field 投影成多导 EEG；双源为线性叠加。</p>
        </div>

        <div className="eeg-control-group">
          <label htmlFor="eeg-duration">时长</label>
          <select
            id="eeg-duration"
            value={durationMs}
            onChange={(e) => onDurationMsChange(Number(e.target.value))}
          >
            <option value={2000}>2 秒</option>
            <option value={5000}>5 秒</option>
            <option value={10000}>10 秒</option>
          </select>
          <p className="eeg-hint">采样率 250 Hz；脉冲事件每 1000 ms 一次，条件交替。</p>
        </div>

        <div className="eeg-control-group">
          <label htmlFor="eeg-seed">噪声种子</label>
          <input
            id="eeg-seed"
            type="number"
            min={0}
            step={1}
            value={seed}
            onChange={(e) => onSeedChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
          <p className="eeg-hint">同种子同参数两次运行逐值相同。</p>
        </div>

        <div className="eeg-control-group">
          <label htmlFor="eeg-reference">参考方式</label>
          <select
            id="eeg-reference"
            aria-label="参考方式"
            value={refMode}
            onChange={(e) => {
              const mode = e.target.value as EegReference['mode'];
              if (mode === 'electrode') {
                const fallback = recording?.channels[0]?.label ?? 'Cz';
                onReferenceChange({ mode: 'electrode', label: fallback });
              } else {
                onReferenceChange({ mode });
              }
            }}
          >
            <option value="average">平均参考</option>
            <option value="infinity">无限远参考</option>
            <option value="electrode">电极参考</option>
          </select>
          {refMode === 'electrode' && (
            <>
              <label htmlFor="eeg-reference-electrode">参考电极</label>
              <select
                id="eeg-reference-electrode"
                aria-label="参考电极"
                value={refElectrode}
                onChange={(e) => onReferenceChange({ mode: 'electrode', label: e.target.value })}
              >
                {(recording?.channels.map((c) => c.label) ?? ['Cz']).map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            </>
          )}
          <p className="eeg-hint">三种参考数值各不相同；切换参考不重新跑模型。</p>
        </div>

        <div className="eeg-control-group">
          <label htmlFor="eeg-montage">导联</label>
          <select
            id="eeg-montage"
            aria-label="导联"
            value={montage}
            onChange={(e) => onMontageChange(e.target.value as MontageKey)}
          >
            {MONTAGES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <p className="eeg-hint">切换导联重建传感器配置（10-20 为 19 导）。</p>
        </div>

        <div className="eeg-control-group">
          <label htmlFor="eeg-channel">通道</label>
          <select
            id="eeg-channel"
            aria-label="通道"
            value={selectedChannel}
            disabled={!recording}
            onChange={(e) => onSelectedChannelChange(e.target.value)}
          >
            {(recording?.channels.map((c) => c.label) ?? []).map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
          <p className="eeg-hint">点波形行也可切换通道。</p>
        </div>
      </div>

      <div className="eeg-noise">
        <label className="eeg-noise-toggle">
          <input
            type="checkbox"
            checked={noise !== null}
            onChange={(e) => onNoiseChange(e.target.checked ? { ...DEFAULT_NOISE } : null)}
          />
          添加噪声（伪迹，非神经源）
        </label>
        {noise && (
          <div className="eeg-noise-sliders">
            {(
              [
                ['whiteRmsUv', '白噪声'],
                ['pinkRmsUv', '1/f 粉红噪声'],
                ['line50HzRmsUv', '50 Hz 工频'],
                ['driftRmsUv', '慢漂移'],
              ] as [keyof NoiseParams, string][]
            ).map(([key, label]) => (
              <div key={key} className="eeg-noise-row">
                <label htmlFor={`eeg-noise-${key}`}>{label}（µV RMS）</label>
                <input
                  id={`eeg-noise-${key}`}
                  type="range"
                  min={NOISE_SLIDER_MIN_UV}
                  max={NOISE_SLIDER_MAX_UV}
                  step={0.1}
                  value={noise[key]}
                  aria-label={`${label} RMS，微伏`}
                  onChange={(e) => setNoiseField(key, Number(e.target.value))}
                />
                <span className="mono">{noise[key].toFixed(1)} µV</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="eeg-run-row">
        <button
          type="button"
          className="chip"
          onClick={onRunExperiment}
          disabled={!fixtureReady || running}
          title={fixtureReady ? '跑柱模型 → 球形正向模型 → 噪声，生成多导 EEG 记录' : '正向模型加载中…'}
        >
          {running ? '运行中…' : '运行实验'}
        </button>
        <button
          type="button"
          className="chip chip-small"
          disabled={!recording}
          onClick={() => recording && download('eeg-recording.csv', recordingToCsv(recording), 'text/csv')}
        >
          导出 CSV
        </button>
        <button
          type="button"
          className="chip chip-small"
          disabled={!recording}
          onClick={() => recording && download('eeg-recording.json', recordingToJson(recording), 'application/json')}
        >
          导出 JSON
        </button>
        {fixtureError && <span className="eeg-error">{fixtureError}</span>}
        {!fixtureReady && !fixtureError && <span>正向模型加载中…</span>}
      </div>

      {recording ? (
        <>
          <p className="panel-text eeg-summary" data-testid="eeg-summary">
            {recording.channels.length} 通道 · {recording.timesMs.length} 采样 ·{' '}
            {(recording.timesMs[recording.timesMs.length - 1] / 1000).toFixed(1)} 秒 ·{' '}
            {recording.sfreqHz} Hz · {referenceLabel(recording.reference)} · {recording.montage} ·{' '}
            {recording.sourceModelId === 'local-wc-cortical-column-assumed-dipole-v1'
              ? 'WC'
              : recording.sourceModelId === 'local-jansen-rit-assumed-dipole-v1'
                ? 'JR'
                : 'WC + JR'} · 种子 {recording.seed}
            {selectedStats && (
              <>
                {' '}· {selectedChannel}：最大 |V| {selectedStats.maxAbs.toFixed(2)} µV，
                RMS {selectedStats.rmsUv.toFixed(2)} µV
              </>
            )}
          </p>
          <div className="eeg-wave-list" data-testid="eeg-waveform">
            {recording.channels.map((ch, i) => (
              <WaveRow
                key={ch.label}
                label={ch.label}
                values={recording.dataUv[i]}
                selected={ch.label === selectedChannel}
                scale={scale}
                onSelect={() => onSelectedChannelChange(ch.label)}
              />
            ))}
          </div>
          <p className="eeg-hint">
            时间 0–{(recording.timesMs[recording.timesMs.length - 1] / 1000).toFixed(1)} 秒；
            全通道统一刻度，满格 ±{scale.toFixed(1)} µV；噪声是伪迹，不画成神经源波形。
          </p>
        </>
      ) : (
        <p className="panel-text" data-testid="eeg-empty">尚未运行实验。选好参数后点“运行实验”。</p>
      )}
    </div>
  );
}

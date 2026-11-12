/**
 * PR8-A — 一键科学场景启动器（计划 §16.3）。
 *
 * 15 个场景全部复用 `app/src/lib/scenarios.ts` 的 SCENARIOS 定义与
 * `runScenarioCompute`：每个场景 = 预设 + 真实动作 + 实验记录。
 * - S1–S3（live-sim）：动作在 Wilson–Cowan 引擎里发生，经 App 传入的
 *   `onRunLiveScenario` 回调执行（pulse / setWeight / setParams），
 *   峰值 ΔE 约 2 s 后从响应窗口读回再记入记录；本文件不自己调引擎。
 * - S4–S15（compute）：同步跑真实后端函数；需要球形正向模型的场景
 *   （S5–S7、S10、S11，另 S6）fixture 为 null 时按钮禁用并明说原因，
 *   不编造 lead-field。
 * - S4 跑完把 JR 极限环 Pz 记录交给 App（`onAlphaRecording`），供 WAVES
 *   模式的 WavesTab 画真实 PSD；S7 是离散电极步进，不是连续拖动。
 *
 * 实验记录：每次运行追加一条（时间、场景、预设、关键结果数字、备注），
 * 在 launcher 里可见、可导出 JSON；记录状态由 App 持有，关闭弹窗不丢失。
 */
import type { EegLabTab } from './EegAnalysisLab.tsx';
import {
  MODE_LABELS,
  SCENARIOS,
  type AppMode,
  type KeyNumber,
  type LabTarget,
  type ScenarioResult,
} from '../lib/scenarios.ts';

export interface ExperimentRecord {
  /** 墙钟时间（ISO）。 */
  time: string;
  scenarioId: number;
  title: string;
  mode: AppMode;
  preset: Record<string, number | string | number[] | string[]>;
  keyNumbers: KeyNumber[];
  note: string;
  /** 计算耗时（墙钟），ms。 */
  durationMs: number;
  /** 是否走了实时仿真引擎（S1–S3）。 */
  live: boolean;
}

export function scenarioResultToRecord(result: ScenarioResult, live: boolean): ExperimentRecord {
  const def = SCENARIOS.find((s) => s.id === result.scenarioId);
  return {
    time: new Date().toISOString(),
    scenarioId: result.scenarioId,
    title: result.title,
    mode: def ? def.mode : 'play',
    preset: def ? def.preset : {},
    keyNumbers: result.keyNumbers,
    note: result.note,
    durationMs: result.durationMs,
    live,
  };
}

function fmtKeyNumber(k: KeyNumber): string {
  const v = Number.isFinite(k.value)
    ? Math.abs(k.value) >= 100 || Math.abs(k.value) < 0.001
      ? k.value.toExponential(2)
      : k.value.toFixed(4)
    : String(k.value);
  return `${k.label} ${v}${k.unit ? ` ${k.unit}` : ''}`;
}

function fmtPreset(preset: Record<string, number | string | number[] | string[]>): string {
  return JSON.stringify(preset);
}

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

export default function ScenarioLauncher({
  onClose,
  records,
  onClearRecords,
  runningId,
  runError,
  onRunScenario,
  onOpenLab,
  fixtureReady,
  fixtureError,
}: {
  onClose: () => void;
  records: ExperimentRecord[];
  onClearRecords: () => void;
  runningId: number | null;
  runError: string | null;
  onRunScenario: (id: number) => void;
  onOpenLab: (target: LabTarget, eegTab?: EegLabTab) => void;
  fixtureReady: boolean;
  fixtureError: string | null;
}) {
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `brainrun-scenarios-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal screen eeg-lab-modal"
        role="dialog"
        aria-label="一键科学场景"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="screen-title">一键科学场景 — 15 个可运行的预设实验（计划 §16.3）</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" className="chip chip-small" onClick={exportJson} disabled={records.length === 0}>
            导出实验记录 JSON（{records.length} 条）
          </button>
          <button type="button" className="chip chip-small" onClick={onClearRecords} disabled={records.length === 0}>
            清空记录
          </button>
          <button type="button" className="chip chip-small eeg-lab-close" onClick={onClose}>
            关闭
          </button>
        </div>
        {fixtureError && (
          <p className="panel-text" style={{ color: '#ffb340' }}>
            球形正向模型未加载（{fixtureError}）：需要它的场景（S5、S6、S7、S10、S11）暂不可跑，
            其余场景照常可用。不编造 lead-field。
          </p>
        )}
        {runError && <p className="eeg-error">运行失败：{runError}</p>}
        <p style={note}>
          每个场景都是预设 + 真实动作 + 实验记录：S1–S3 在实时 Wilson–Cowan
          引擎里跑（脉冲 / 改权重 / 改参数是真实动作，峰值 ΔE 约 2 s 后从
          RESPONSE 面板读回再记入记录）；S4–S15 同步跑真实后端函数并返回关键
          结果数字。S7 是离散电极步进（FCz / C1 / Cz / C2 / CPz），不是连续拖动。
          目前除指定的 Alpha 记录联动外，场景仅保留计算结果摘要；
          下方“进入独立实验台”不会自动载入本次场景的源、事件或记录。
        </p>
        {SCENARIOS.map((s) => {
          const needsFixture = s.requiresFixture && !fixtureReady;
          const running = runningId === s.id;
          return (
            <div key={s.id} style={panel} data-scenario={s.id}>
              <h3 style={title}>
                S{s.id} · {s.title}
                <span style={{ fontWeight: 400, fontSize: 12, color: '#9db4c4', marginLeft: 8 }}>
                  {MODE_LABELS[s.mode]} · {s.backend}
                </span>
              </h3>
              <p style={note}>{s.summary}</p>
              <p style={note}>预设：<span className="mono">{fmtPreset(s.preset)}</span></p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="chip chip-small"
                  disabled={running || needsFixture}
                  onClick={() => onRunScenario(s.id)}
                  title={needsFixture ? '球形正向模型未加载，无法运行' : '运行该场景并追加一条实验记录'}
                >
                  {running ? '运行中…' : `运行 S${s.id}`}
                </button>
                {needsFixture && <span style={note}>需球形正向模型（未加载）</span>}
                {s.openLab !== null && (
                  <button
                    type="button"
                    className="chip chip-small"
                    onClick={() => onOpenLab(s.openLab, s.eegTab)}
                    title="仅导航到独立实验台；不会自动载入本次场景的模型状态、记录或计算结果"
                  >
                    进入独立实验台（不载入结果）
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div style={panel}>
          <h3 style={title}>实验记录（{records.length} 条）</h3>
          {records.length === 0 ? (
            <p style={note}>还没有记录。运行任意场景后，这里追加一条（时间、场景、预设、关键结果数字）。</p>
          ) : (
            <ol style={{ margin: '4px 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
              {[...records].reverse().map((r, i) => (
                <li key={`${r.time}-${r.scenarioId}-${i}`} data-record={r.scenarioId} style={{ marginBottom: 10 }}>
                  <div>
                    <strong>S{r.scenarioId} · {r.title}</strong>
                    {' '}· {r.time.slice(11, 19)} · {r.live ? '实时引擎' : '同步计算'} · {r.durationMs} ms
                  </div>
                  <div className="mono" style={{ wordBreak: 'break-all' }}>
                    预设 {fmtPreset(r.preset)}
                  </div>
                  <div>
                    {r.keyNumbers.map((k) => fmtKeyNumber(k)).join('；')}
                  </div>
                  <div style={{ color: '#9db4c4' }}>{r.note}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <p className="panel-text eeg-foot">
          场景预设精确值与控件→后端映射见契约 docs/frontend-backend-contract.md §1.12。
        </p>
      </div>
    </div>
  );
}

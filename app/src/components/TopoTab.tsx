/**
 * PR-11 地形 tab（B3）。
 *
 * Props 约定（设计稿 §1.3，壳 EegAnalysisLab.tsx 传什么就接什么）：
 * `{ recording, atTimeMs, onAtTimeMsChange }`；`fixture` 为可选追加
 * （壳若已加载球形 fixture 就传，没传则本 tab 自己 fetch；3D 面板
 * 没有 fixture 时明确提示，不静默画空图）。
 *
 * 两张图分开展示，并写清来源差异：
 * - 2D 地形：记录在某一时刻的电极实测值 + 球面样条插值（Perrin 法）。
 *   图上两电极之间的值是插值算出来的，不是测到的。
 * - 3D 头皮电位：345 个传感器位置的正向计算值（L·q），每点直接求值，
 *   电极之间不插值。源位置/矩由本 tab 的控件给定（默认 [0, 0, 16] mm、
 *   [0, 10, 0] nA·m），与 2D 图的记录数据无关——两张图的数据来源
 *   本来就不一样，不要混读。
 */
import { useEffect, useMemo, useState } from 'react';
import type { EegRecording } from '../lib/eegData';
import { topoAtTime, forwardHeadPotential, TOPO_HEAD_RADIUS_MM } from '../lib/topography';
import type { SphereFixture } from '../lib/sphereForward';
import { validateSphereFixture } from '../lib/sphereForward';
import type { Vec3Mm } from '../lib/volumeConduction';

export interface TopoTabProps {
  recording: EegRecording | null;
  atTimeMs: number;
  onAtTimeMsChange: (tMs: number) => void;
  fixture?: SphereFixture | null;
}

/** 发散配色：负 µV 蓝 → 0 白 → 正 µV 红。 */
function topoColor(v: number, maxAbs: number): string {
  const t = Math.max(-1, Math.min(1, v / Math.max(1e-9, maxAbs)));
  if (t >= 0) {
    return `rgb(255,${Math.round(255 * (1 - t * 0.8))},${Math.round(255 * (1 - t))})`;
  }
  return `rgb(${Math.round(255 * (1 + t * 0.8))},${Math.round(255 * (1 + t * 0.8))},255)`;
}

export default function TopoTab({ recording, atTimeMs, onAtTimeMsChange, fixture }: TopoTabProps) {
  // fixture 优先用壳传的 prop；没传才自己 fetch（与 HeadSphereLab 同模式）。
  const [fetchedFixture, setFetchedFixture] = useState<SphereFixture | null>(null);
  const loadedFixture = fixture ?? fetchedFixture;
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const [srcPos, setSrcPos] = useState<Vec3Mm>([0, 0, 16]);
  const [srcAxis, setSrcAxis] = useState<'X' | 'Y' | 'Z'>('Y');
  const [srcMoment, setSrcMoment] = useState(10);
  const [reference, setReference] = useState<'average' | 'infinity'>('average');

  useEffect(() => {
    if (fixture || fetchedFixture) return;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}forward-assets/sphere-model.json`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: SphereFixture) => {
        validateSphereFixture(data);
        setFetchedFixture(data);
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          setFixtureError('球形正向模型未加载（3D 面板不可用）：请先生成 app/public/forward-assets/sphere-model.json，或等壳传入 fixture。');
        }
      });
    return () => controller.abort();
  }, [fixture, fetchedFixture]);

  const topo = useMemo(() => {
    if (!recording) return null;
    try {
      return topoAtTime(recording, atTimeMs);
    } catch {
      return null;
    }
  }, [recording, atTimeMs]);

  const forward = useMemo(() => {
    if (!loadedFixture) return null;
    try {
      const dir: Vec3Mm = srcAxis === 'X' ? [1, 0, 0] : srcAxis === 'Y' ? [0, 1, 0] : [0, 0, 1];
      const moment: Vec3Mm = [dir[0] * srcMoment, dir[1] * srcMoment, dir[2] * srcMoment];
      return forwardHeadPotential(loadedFixture, srcPos, moment, { mode: reference });
    } catch {
      return null;
    }
  }, [loadedFixture, srcPos, srcAxis, srcMoment, reference]);

  if (!recording) {
    return (
      <div>
        <h3>地形（2D 插值 + 3D 正向头皮电位）</h3>
        <p className="panel-text">还没有 EEG 记录。请先在 EEG tab 里运行实验。</p>
      </div>
    );
  }
  const tMin = recording.timesMs[0];
  const tMax = recording.timesMs[recording.timesMs.length - 1];
  const maxAbsTopo = topo ? Math.max(0.001, ...topo.electrodeValues.map((e) => Math.abs(e.valueUv))) : 1;
  const maxAbsFwd = forward ? Math.max(0.001, ...forward.valueUv.map(Math.abs)) : 1;

  return (
    <div>
      <h3>地形——{topo ? `${topo.atTimeMs.toFixed(0)} ms` : ''}，{recording.channels.length} 导</h3>
      <p className="panel-text">
        两张图的数据来源不一样，分开看：2D 图是记录实测值的球面样条插值（电极之间是算出来的）；
        3D 图是正向计算值（每个传感器位置的 L·q，电极之间不插值），源由下方控件给定，与 2D 图的记录数据无关。
      </p>
      <label>
        时刻：{atTimeMs.toFixed(0)} ms（{tMin.toFixed(0)}–{tMax.toFixed(0)} ms）
        <input
          type="range"
          min={tMin}
          max={tMax}
          step={(tMax - tMin) / Math.max(1, recording.timesMs.length - 1)}
          value={atTimeMs}
          onChange={(e) => onAtTimeMsChange(+e.target.value)}
          style={{ width: '100%' }}
          aria-label="地形时刻"
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="conn-title">2D 地形——球面样条插值（Perrin 法，m = 4，n ≤ 7，λ = 1e-5）</div>
          {topo ? (
            <svg width="100%" height="320" viewBox="0 0 320 320" role="img" aria-label="2D interpolated topography">
              <circle cx={160} cy={160} r={150} fill="#08131d" stroke="#335" />
              {topo.grid.map((g, k) => (
                <rect
                  key={k}
                  x={160 + (g.x * 300) / 2 - 6}
                  y={160 - (g.y * 300) / 2 - 6}
                  width={12}
                  height={12}
                  fill={topoColor(g.valueUv, maxAbsTopo)}
                  opacity={0.85}
                />
              ))}
              {topo.electrodeValues.map((e) => {
                const ch = recording.channels.find((c) => c.label === e.label);
                if (!ch) return null;
                const x = 160 + (ch.positionMm[0] / TOPO_HEAD_RADIUS_MM) * 150;
                const y = 160 - (ch.positionMm[1] / TOPO_HEAD_RADIUS_MM) * 150;
                return (
                  <g key={e.label}>
                    <circle cx={x} cy={y} r={5} fill="#000" stroke="#fff" strokeWidth={1.5} />
                    <text x={x + 7} y={y + 4} fill="#ddd" fontSize={10}>{e.label}</text>
                  </g>
                );
              })}
            </svg>
          ) : (
            <p className="panel-text">该时刻的地形算不出来（记录或时刻异常）。</p>
          )}
          <p className="panel-text">
            黑点 = 实测电极位置；色块 = 插值场（单位圆内网格，25×25）。最大值 {maxAbsTopo.toFixed(2)} µV。
            插值在电极点上近乎重现实测值（λ = 1e-5 平滑所致残差 ≤ 0.02 µV），但两电极之间的值仍是插值，不是测量。
          </p>
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="conn-title">3D 头皮电位——正向计算值（345 个传感器，L·q，无插值）</div>
          {fixtureError && <p className="panel-text" role="alert">{fixtureError}</p>}
          {!loadedFixture && !fixtureError && <p className="panel-text">正在加载 MNE 正向模型…</p>}
          {forward && (
            <>
              <svg width="100%" height="320" viewBox="0 0 320 320" role="img" aria-label="Forward head potential at 345 sensors">
                <circle cx={160} cy={160} r={150} fill="#08131d" stroke="#335" />
                {forward.positionsMm.map((p, i) => (
                  <circle
                    key={forward.labels[i]}
                    cx={160 + (p[0] / TOPO_HEAD_RADIUS_MM) * 150}
                    cy={160 - (p[1] / TOPO_HEAD_RADIUS_MM) * 150}
                    r={3.5}
                    fill={topoColor(forward.valueUv[i], maxAbsFwd)}
                  />
                ))}
              </svg>
              <p className="panel-text">
                每个圆点都是一个传感器位置的直接计算值（{forward.labels.length} 个），不是插值。
                源 [{srcPos.join(', ')}] mm、矩 {srcAxis} 向 {srcMoment} nA·m、参考 {reference}；
                最大 |V| {maxAbsFwd.toFixed(2)} µV。
              </p>
            </>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label>
              源 X：
              <input type="number" value={srcPos[0]} min={-48} max={48} step={8} onChange={(e) => setSrcPos([+e.target.value, srcPos[1], srcPos[2]])} style={{ width: 64 }} />
            </label>
            <label>
              源 Y：
              <input type="number" value={srcPos[1]} min={-48} max={48} step={8} onChange={(e) => setSrcPos([srcPos[0], +e.target.value, srcPos[2]])} style={{ width: 64 }} />
            </label>
            <label>
              源 Z：
              <input type="number" value={srcPos[2]} min={-48} max={48} step={8} onChange={(e) => setSrcPos([srcPos[0], srcPos[1], +e.target.value])} style={{ width: 64 }} />
            </label>
            <label>
              矩方向：
              <select value={srcAxis} onChange={(e) => setSrcAxis(e.target.value as 'X' | 'Y' | 'Z')}>
                <option value="X">X</option>
                <option value="Y">Y</option>
                <option value="Z">Z</option>
              </select>
            </label>
            <label>
              矩（nA·m）：
              <input type="range" min={-30} max={30} step={0.5} value={srcMoment} onChange={(e) => setSrcMoment(+e.target.value)} aria-label="偶极矩" />
              {srcMoment}
            </label>
            <label>
              参考：
              <select value={reference} onChange={(e) => setReference(e.target.value as 'average' | 'infinity')}>
                <option value="average">average（减 345 点均值）</option>
                <option value="infinity">infinity</option>
              </select>
            </label>
          </div>
          <p className="panel-text">源位置限制在 ±48 mm（lead-field 网格边界，越界抛错）；矩 ±30 nA·m 与 PR5 的 HeadSphereLab 同范围。</p>
        </div>
      </div>
    </div>
  );
}

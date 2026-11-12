/**
 * PR8-A — EXPLORE 模式：解剖 / 图谱 / 坐标探索器（计划 §16.1）。
 *
 * 内容全部来自真实数据，不编造配准：
 * - 76 脑区浏览器：TVB 演示连接组的脑区标签、中心坐标、皮层面积、
 *   主要连接（`brainData.ts` / `topConnections`）。中心坐标是
 *   TVB 演示坐标（tvb-demo-mm），与 HEAD / MRI / MNI 不互通，界面
 *   写明这一点（契约 §2）。
 * - 坐标显示：球形头模型源点的 HEAD RAS ↔ 球心坐标，用契约 §2
 *   唯一已验证的变换 `MNE_HEAD_TO_SPHERE`（纯平移 z −40 mm）及
 *   其逆变换；MRI 无通用变换、MNI305 只属于 fsaverage 皮层源，
 *   均如实标注，不算数值。
 * - MNI152 / Talairach 继续禁用：现场调 `parseCoordinateSpace`
 *   演示拒绝（抛 RangeError 并显示原因），不是只写一句话。
 * - 细胞实验室入口：打开 CellularLab（PR-13 真实实验台）。
 */
import { useMemo, useState } from 'react';
import type { BrainData } from '../lib/brainData';
import { topConnections } from '../lib/brainData';
import {
  applyTransform,
  inverseTransform,
  MNE_HEAD_TO_SPHERE,
  parseCoordinateSpace,
} from '../lib/coordinates';
import type { Vec3Mm } from '../lib/volumeConduction';

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
const input: React.CSSProperties = {
  background: '#08131d',
  color: '#d7e5ef',
  border: '1px solid #2a3f52',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 12,
};

function fmtVec(v: readonly number[]): string {
  return v.map((x) => x.toFixed(1)).join(', ');
}

export default function ExplorePanel({
  data,
  selectedRegionId,
  onSelectRegion,
  onOpenCellular,
}: {
  data: BrainData | null;
  /** Main-scene selection is the single source of truth. */
  selectedRegionId: number | null;
  onSelectRegion: (id: number) => void;
  onOpenCellular: () => void;
}) {
  const [query, setQuery] = useState('');
  const selectedId = selectedRegionId;
  const [src, setSrc] = useState<Vec3Mm>([0, 0, 16]);
  const [coordProbe, setCoordProbe] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.regions;
    return data.regions.filter(
      (r) => r.label.toLowerCase().includes(q) || String(r.id) === q,
    );
  }, [data, query]);

  const selected = selectedId !== null && data ? data.regions[selectedId] : null;
  const conns = selectedId !== null && data ? topConnections(data, selectedId, 5) : [];

  // 球形头模型源点：球心坐标 → HEAD RAS（逆变换，z +40 mm）。
  let headRas: Vec3Mm | null = null;
  let headError: string | null = null;
  try {
    headRas = applyTransform(inverseTransform(MNE_HEAD_TO_SPHERE), src);
  } catch (e) {
    headError = String(e);
  }

  const probeDisabledSpace = (space: string) => {
    try {
      parseCoordinateSpace(space);
      setCoordProbe(`${space}：未被拒绝（异常，应核查）`);
    } catch (e) {
      setCoordProbe(`${space}：已拒绝——${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div>
      <div style={panel}>
        <h3 style={title}>脑区浏览器 — TVB 演示连接组（76 区）</h3>
        <p style={note}>点选下面的脑区会同步选中主三维大脑与 LIVE ACTIVITY；仅选择，不施加刺激。</p>
        <p style={note}>
          数据：TVB 示例 connectivity_76（权重主要来自猕猴 CoCoMac，胼胝体为人类 DSI 缩放；
          不是某个真人的连接网络）。中心坐标是 TVB 演示坐标（tvb-demo-mm），
          与 HEAD / MRI / MNI 不互通——没有已验证的配准，不换算。
        </p>
        <input
          style={{ ...input, width: '100%', marginBottom: 8 }}
          type="search"
          aria-label="按名称或编号搜索脑区"
          placeholder="搜索脑区名称或编号，例如 cingulate 或 40"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', maxHeight: 320, overflowY: 'auto', minWidth: 0 }}>
            {filtered.length === 0 && <p style={note}>没有匹配的脑区。</p>}
            {filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRegion(r.id)}
                aria-pressed={selectedId === r.id}
                title="同步选中主三维大脑中的同一脑区（不施加刺激）"
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: selectedId === r.id ? '#13293a' : 'transparent',
                  color: '#d7e5ef', border: '1px solid #2a3f52', borderRadius: 4,
                  padding: '4px 8px', marginBottom: 4, cursor: 'pointer', fontSize: 12,
                }}
              >
                #{r.id} {r.label}
              </button>
            ))}
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            {selected === null ? (
              <p style={note}>选一个脑区查看详情。</p>
            ) : (
              <>
                <p style={note}>
                  <strong>#{selected.id} {selected.label}</strong>
                  <br />中心坐标（TVB 演示）：{fmtVec(selected.centre)} mm
                  <br />皮层面积：{selected.area_mm2.toFixed(1)} mm²
                  <br />皮层标记：{selected.cortical === 1 ? '皮层' : '非皮层'}
                </p>
                <p style={note}>主要连接（按权重前 5，来源 → 该脑区）：</p>
                {conns.length === 0 ? (
                  <p style={note}>该脑区无权重 &gt; 0 的连接。</p>
                ) : (
                  <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 12 }}>
                    {conns.map((c) => (
                      <li key={c.target.id}>
                        {c.target.label} #{c.target.id} — 权重 {c.weight.toFixed(3)} · {c.lengthMm.toFixed(1)} mm
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div style={panel}>
        <h3 style={title}>坐标 — HEAD / 球心 / MRI / MNI305</h3>
        <p style={note}>
          球形头模型源点（球心坐标，mm；每轴 ±48）：HEAD RAS = 球心坐标 + [0, 0, 40] mm
          （契约 §2 唯一已验证的变换 `MNE_HEAD_TO_SPHERE` 的逆变换，误差 0 mm）。
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          {(['X', 'Y', 'Z'] as const).map((axis, i) => (
            <label key={axis} style={{ fontSize: 12 }}>
              {axis}：
              <input
                style={{ ...input, width: 72, marginLeft: 4 }}
                type="number"
                aria-label={`源点 ${axis} 坐标`}
                min={-48}
                max={48}
                step={8}
                value={src[i]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    const clamped = Math.max(-48, Math.min(48, v));
                    // Vec3Mm 是只读元组：按轴显式重建，不做索引赋值。
                    const next: Vec3Mm =
                      i === 0 ? [clamped, src[1], src[2]]
                      : i === 1 ? [src[0], clamped, src[2]]
                      : [src[0], src[1], clamped];
                    setSrc(next);
                  }
                }}
              />
            </label>
          ))}
        </div>
        {headError ? (
          <p style={note}>换算失败：{headError}</p>
        ) : (
          <p style={note}>
            球心坐标（head-sphere-centered-mm）：{fmtVec(src)} mm
            <br />HEAD RAS（head-ras-mm）：{headRas ? fmtVec(headRas) : '—'} mm
            <br />MRI RAS（mri-ras-mm）：无通用变换——本仓库没有 MRI↔HEAD 通用变换，
            仅 fsaverage BEM fixture 自带 transform_mri_to_head，未加载该 fixture 时不显示数值。
            <br />MNI305：只属于 fsaverage 皮层源（MNE/FreeSurfer mni_tal），不是 TVB 脑区坐标；
            此处不换算。
          </p>
        )}
        <p style={note}>
          MNI152 / Talairach：禁用（无已验证配准）。点下面按钮现场验证拒绝逻辑：
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="chip chip-small" onClick={() => probeDisabledSpace('mni152-mm')}>
            调试：拒绝未配准的 MNI152
          </button>
          <button type="button" className="chip chip-small" onClick={() => probeDisabledSpace('talairach-mm')}>
            调试：拒绝未配准的 Talairach
          </button>
        </div>
        {coordProbe && <p style={note}>{coordProbe}</p>}
      </div>

      <div style={panel}>
        <h3 style={title}>多尺度 — 细胞实验室</h3>
        <p style={note}>
          LIF / Hodgkin–Huxley / 多房室神经元与跨尺度耦合（PR-13 真实实验台），
          注入电流看动作电位；一键场景 13 在这里有对应的真实计算。
        </p>
        <button type="button" className="chip chip-small" onClick={onOpenCellular}>
          打开细胞实验
        </button>
      </div>
    </div>
  );
}

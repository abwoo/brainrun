/**
 * Phase 1 闭环实验台 — 脑电帽预设（`implementation-plan.md` §1.1）。
 *
 * 一个控件、一个状态，解决“导联选择器 + 通道数选择器”会互相打架的问题。
 * 预设 5 个：10-20-19 / 10-10-32 / 10-10-64 / 10-5-128 / 10-5-256。
 * 32/64 取自 10-10（94 个标签），128/256 取自 10-5（343 个标签）；
 * 10-20 只有 19 个标签，给不出 32。
 *
 * 标签数已核实（2026-11-18，MNE 1.11.0 本地生成 `sphere-model.json`）：
 * 10-20 = 19、10-10 = 94、10-05 = 343；M1/M2 在 10-10 与 10-05 中有、
 * 在 10-20 中无；Cz 三者都有。
 *
 * 子集规则：以 Cz 为种子做最远点采样（deterministic，按传感器 3D 位置
 * 欧氏距离；平局按导联顺序取先者）。标签顺序为 MNE 前额→后部行序，
 * 因此 32/64/128/256 子集不用“前 N 个”（会偏额部）。返回的 `labels`
 * 按 fixture 的导联顺序排（不是采样顺序），保证记录里的通道顺序常规。
 *
 * 本模块只读传入的 `SphereFixture`，不依赖
 * `app/public/forward-assets/sphere-model.json`（它是 gitignored 的
 * 本地生成物）；测试用合成小 fixture。
 */
import type { MontageKey, SphereFixture } from './sphereForward.ts';

export type BenchCapPreset = '10-20-19' | '10-10-32' | '10-10-64' | '10-5-128' | '10-5-256';

export interface BenchCapSelection {
  preset: BenchCapPreset;
  montage: MontageKey;
  channelCount: number;
  labels: string[];
}

export const BENCH_CAP_PRESETS: readonly {
  preset: BenchCapPreset;
  montage: MontageKey;
  channelCount: number;
  labelZh: string;
  labelEn: string;
}[] = [
  { preset: '10-20-19', montage: '10-20', channelCount: 19, labelZh: '10-20 · 19 导', labelEn: '10-20 · 19 channels' },
  { preset: '10-10-32', montage: '10-10', channelCount: 32, labelZh: '10-10 · 32 导', labelEn: '10-10 · 32 channels' },
  { preset: '10-10-64', montage: '10-10', channelCount: 64, labelZh: '10-10 · 64 导', labelEn: '10-10 · 64 channels' },
  { preset: '10-5-128', montage: '10-05', channelCount: 128, labelZh: '10-5 · 128 导', labelEn: '10-5 · 128 channels' },
  { preset: '10-5-256', montage: '10-05', channelCount: 256, labelZh: '10-5 · 256 导', labelEn: '10-5 · 256 channels' },
];

const PRESET_TABLE: Record<BenchCapPreset, { montage: MontageKey; channelCount: number }> = {
  '10-20-19': { montage: '10-20', channelCount: 19 },
  '10-10-32': { montage: '10-10', channelCount: 32 },
  '10-10-64': { montage: '10-10', channelCount: 64 },
  '10-5-128': { montage: '10-05', channelCount: 128 },
  '10-5-256': { montage: '10-05', channelCount: 256 },
};

/**
 * 按预设从 fixture 里选通道。以 Cz 为种子的最远点采样；`count` 超过
 * 可用标签数时抛 `RangeError`（写明哪个导联、要多少、只有多少），
 * 不静默截断。返回的 labels 按 fixture 导联顺序排。
 */
export function selectBenchCapChannels(fixture: SphereFixture, preset: BenchCapPreset): BenchCapSelection {
  const { montage, channelCount: count } = PRESET_TABLE[preset];
  const montageLabels = fixture.montages[montage];
  if (!montageLabels) {
    throw new RangeError(`selectBenchCapChannels: fixture has no montage ${montage}`);
  }
  if (count > montageLabels.length) {
    throw new RangeError(
      `selectBenchCapChannels: preset ${preset} needs ${count} channels from montage ${montage}, ` +
      `but the fixture only has ${montageLabels.length}`,
    );
  }
  const byLabel = new Map(fixture.sensors.map((s) => [s.label, s]));
  const positions = montageLabels.map((label) => {
    const sensor = byLabel.get(label);
    if (!sensor) {
      throw new RangeError(`selectBenchCapChannels: montage ${montage} label ${label} has no sensor in the fixture`);
    }
    return sensor.position_mm;
  });
  const czIndex = montageLabels.indexOf('Cz');
  if (czIndex < 0) {
    throw new RangeError(`selectBenchCapChannels: montage ${montage} has no Cz seed electrode`);
  }
  const distSq = (a: readonly number[], b: readonly number[]): number => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  };
  // 最远点采样：从 Cz 出发，每轮取到已选集合的最小距离最大的候选；
  // 平局按导联顺序取先者（严格大于才替换）。
  const selected = new Set<number>([czIndex]);
  const minDistSq = positions.map((p) => distSq(p, positions[czIndex]));
  while (selected.size < count) {
    let best = -1;
    let bestD = -1;
    for (let j = 0; j < positions.length; j++) {
      if (selected.has(j)) continue;
      if (minDistSq[j] > bestD) {
        bestD = minDistSq[j];
        best = j;
      }
    }
    selected.add(best);
    for (let j = 0; j < positions.length; j++) {
      if (selected.has(j)) continue;
      const d = distSq(positions[j], positions[best]);
      if (d < minDistSq[j]) minDistSq[j] = d;
    }
  }
  // 按 fixture 导联顺序返回，不是采样顺序。
  const labels = montageLabels.filter((_, j) => selected.has(j));
  return { preset, montage, channelCount: count, labels };
}

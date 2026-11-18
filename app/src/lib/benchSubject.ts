/**
 * Phase 1 闭环实验台 — 模拟受试者（`implementation-plan.md` §1.3）。
 *
 * 复用 `eegRecording.ts` 已导出的 `mulberry32`（与 Python 对照过的
 * 那个），不新写 RNG。
 *
 * 行为（Phase 1，仿真假设、不是生理）：
 * - 只对 oddball 试次按键（`key: 'Space'`）；
 * - RT = `rtMinMs + (rtMaxMs - rtMinMs) * u`，`u` 为 seeded 均匀数，
 *   默认 320–440 ms；
 * - 同一种子 → 同一 RT 序列；`reset()` 后序列重来；
 * - 无漏报、无虚报：Phase 1 不做漏按/误按，文档里写明这一点，
 *   以后加了再改口径。
 */
import { mulberry32 } from './eegRecording.ts';

export interface SimulatedSubjectConfig {
  seed: number;
  rtMinMs?: number;
  rtMaxMs?: number;
}

export interface SubjectResponse {
  trialIndex: number;
  stimulusTms: number;
  responseTms: number;
  rtMs: number;
  key: string;
}

export interface SimulatedSubject {
  nextOddballResponse(trialIndex: number, stimulusTms: number): SubjectResponse;
  reset(): void;
}

export const DEFAULT_RT_MIN_MS = 320;
export const DEFAULT_RT_MAX_MS = 440;

export function createSimulatedSubject(config: SimulatedSubjectConfig): SimulatedSubject {
  const rtMinMs = config.rtMinMs ?? DEFAULT_RT_MIN_MS;
  const rtMaxMs = config.rtMaxMs ?? DEFAULT_RT_MAX_MS;
  if (!Number.isFinite(rtMinMs) || !Number.isFinite(rtMaxMs) || rtMinMs < 0 || rtMaxMs < rtMinMs) {
    throw new RangeError(
      `createSimulatedSubject: need 0 <= rtMinMs <= rtMaxMs, got rtMinMs=${rtMinMs} rtMaxMs=${rtMaxMs}`,
    );
  }
  let rng = mulberry32(config.seed);
  return {
    nextOddballResponse(trialIndex: number, stimulusTms: number): SubjectResponse {
      if (!Number.isInteger(trialIndex) || trialIndex < 0) {
        throw new RangeError(`nextOddballResponse: invalid trialIndex ${trialIndex}`);
      }
      if (!Number.isFinite(stimulusTms)) {
        throw new RangeError(`nextOddballResponse: invalid stimulusTms ${stimulusTms}`);
      }
      const rtMs = rtMinMs + (rtMaxMs - rtMinMs) * rng();
      return { trialIndex, stimulusTms, responseTms: stimulusTms + rtMs, rtMs, key: 'Space' };
    },
    reset(): void {
      rng = mulberry32(config.seed);
    },
  };
}

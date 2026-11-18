/**
 * Phase 1 闭环实验台 — 回路追踪日志（`implementation-plan.md` §1.5）。
 *
 * 六框回路里信号在每一跳的记录：放大器 → 测试电脑 → 实验电脑 →
 * 刺激器 → 大脑。`cap` 默认 200，超了丢最旧的；`seq` 单调递增，
 * `clear()` 之后也不重用（追踪编号全局唯一）。
 *
 * `confirmed` 的含义（UI 必须配图例说明，不许把客户端观测写成
 * Worker 确认）：
 * - `true` = Worker 确认的时间（ACK `t_ms`、`FeedbackAction` 的
 *   `detectedMs`/`applyMs`）；
 * - `false` = 客户端观测时取的最新快照 `t_ms`。
 */
export type BenchTraceHop = 'amplifier' | 'test-computer' | 'experiment-computer' | 'stimulator' | 'brain';

export interface BenchTraceEvent {
  seq: number;
  tMs: number;
  hop: BenchTraceHop;
  kind: string;
  label: string;
  value: string;
  confirmed: boolean;
}

export interface BenchTrace {
  append(e: Omit<BenchTraceEvent, 'seq'>): BenchTraceEvent;
  list(): BenchTraceEvent[];
  clear(): void;
}

export const DEFAULT_BENCH_TRACE_CAP = 200;

export function createBenchTrace(cap: number = DEFAULT_BENCH_TRACE_CAP): BenchTrace {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new RangeError(`createBenchTrace: cap must be an integer >= 1, got ${cap}`);
  }
  const events: BenchTraceEvent[] = [];
  let nextSeq = 1;
  return {
    append(e: Omit<BenchTraceEvent, 'seq'>): BenchTraceEvent {
      const event: BenchTraceEvent = { ...e, seq: nextSeq++ };
      events.push(event);
      if (events.length > cap) events.splice(0, events.length - cap);
      return { ...event };
    },
    list(): BenchTraceEvent[] {
      return events.map((e) => ({ ...e }));
    },
    clear(): void {
      events.length = 0;
    },
  };
}

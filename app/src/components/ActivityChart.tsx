/**
 * LIVE ACTIVITY 示波器（Phase 3，Phase 4 打磨：时间竖线、刻度、顶格标注）。
 *
 * 只画模型快照：当前选中脑区的 E（琥珀）/ I（蓝），横轴仿真时间，
 * 最近 10 秒窗口，自动滚动；刺激事件画竖线标记。
 * 明确标注 Regional Neural Activity（任意单位），不是 EEG 电压。
 * 暂停时停止追加、保留近期曲线；换脑区立即切换并清空。
 */
import { useEffect, useRef, useState } from 'react';
import type { SimClient } from '../lib/simClient';
import type { Snapshot } from '../worker/protocol';

const WINDOW_MS = 10_000;
const Y_MAX = 0.6;

interface Props {
  sim: SimClient | null;
  selectedId: number | null;
  resetSignal: number;
  /** PR2 回放：active 时画窗口内录制曲线（真实快照切片）+ 回放时刻竖线；
   *  null 或 inactive 时恢复直播绘制。窗口快照含 E/I，由 SimClient 提供。 */
  replay: {
    active: boolean;
    tMs: number;
    speed: number;
    window: {
      t0_ms: number;
      t1_ms: number;
      baselineT_ms: number;
      node: number;
      snapshots: Array<{ t_ms: number; e: Float64Array; i: Float64Array }>;
    } | null;
  } | null;
}

type Trace = 'E' | 'I' | 'BOTH';

export default function ActivityChart({ sim, selectedId, resetSignal, replay }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [trace, setTrace] = useState<Trace>('E');
  const traceRef = useRef<Trace>('E');
  traceRef.current = trace;

  // 每个选中脑区一条环形缓冲：{t_ms, e, i}，只保留最近 12 秒。
  const bufferRef = useRef<Array<{ t_ms: number; e: number; i: number }>>([]);
  const selectedRef = useRef<number | null>(selectedId);
  const pausedRef = useRef(false);
  // PR2：回放状态走 ref（绘图循环每帧读，不随每次回放时钟 tick 重建循环）。
  const replayRef = useRef(replay);
  replayRef.current = replay;

  useEffect(() => {
    selectedRef.current = selectedId;
    bufferRef.current = [];
  }, [selectedId]);

  useEffect(() => {
    bufferRef.current = [];
  }, [resetSignal]);

  useEffect(() => {
    if (!sim) return;
    const unsub = sim.subscribe((snap: Snapshot) => {
      pausedRef.current = snap.paused;
      const id = selectedRef.current;
      if (id === null || snap.paused) return;
      const buf = bufferRef.current;
      buf.push({ t_ms: snap.t_ms, e: snap.e[id], i: snap.i[id] });
      while (buf.length > 0 && snap.t_ms - buf[0].t_ms > 12_000) buf.shift();
    });
    return unsub;
  }, [sim]);

  // 绘图循环：只读缓冲，不改模型。
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // 横向网格：0.1 小刻度（淡）、0.2/0.4/0.6 主刻度；0 基线略亮。
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(19, 57, 84, 0.35)';
      ctx.beginPath();
      for (const gy of [0.1, 0.3, 0.5]) {
        const y = h - 8 - (gy / Y_MAX) * (h - 16);
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(19, 57, 84, 0.8)';
      ctx.beginPath();
      for (const gy of [0.2, 0.4, 0.6]) {
        const y = h - 8 - (gy / Y_MAX) * (h - 16);
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(127, 168, 196, 0.6)';
      ctx.beginPath();
      ctx.moveTo(0, h - 8);
      ctx.lineTo(w, h - 8);
      ctx.stroke();
      ctx.fillStyle = '#7fa8c4';
      ctx.font = '10px ui-monospace, Menlo, monospace';
      // 0.6 线贴着画布顶边（y≈8），标签画到线下方才不会被切掉。
      ctx.fillText('0.6', 4, h - 8 - (0.6 / Y_MAX) * (h - 16) + 10);
      ctx.fillText('0.4', 4, h - 8 - (0.4 / Y_MAX) * (h - 16) - 3);
      ctx.fillText('0.2', 4, h - 8 - (0.2 / Y_MAX) * (h - 16) - 3);
      ctx.fillText('0', 4, h - 10);

      // PR2 回放分支：画窗口内选中脑区的录制曲线 + 回放时刻竖线。
      // 数据只读录下来的快照切片，不重算；纵轴与直播同一刻度（0.6）。
      const rp = replayRef.current;
      if (rp?.active && rp.window) {
        const win = rp.window;
        const t0r = win.t0_ms;
        const t1r = win.t1_ms;
        const span = Math.max(t1r - t0r, 1);
        const xOfR = (t: number) => ((t - t0r) / span) * w;
        const yOfR = (v: number) => h - 8 - (Math.min(v, Y_MAX) / Y_MAX) * (h - 16);
        const id = selectedRef.current;
        if (id === null || win.snapshots.length < 2) {
          ctx.fillStyle = '#7fa8c4';
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(id === null ? '点击大脑选择一个脑区' : '回放窗口收集中…', 10, 36);
          return;
        }
        // 纵向时间网格：每 0.5 s 一条。
        ctx.strokeStyle = 'rgba(19, 57, 84, 0.5)';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#7fa8c4';
        ctx.font = '10px ui-monospace, Menlo, monospace';
        const firstGridR = Math.ceil(t0r / 500) * 500;
        for (let gt = firstGridR; gt <= t1r; gt += 500) {
          const x = xOfR(gt);
          ctx.beginPath();
          ctx.moveTo(x, 4);
          ctx.lineTo(x, h - 8);
          ctx.stroke();
          if (x > 14 && x < w - 60) ctx.fillText(`${(gt / 1000).toFixed(1)}s`, x + 3, h - 10);
        }
        // 刺激时刻竖线（琥珀）与回放时刻竖线（亮白粗线）。
        ctx.strokeStyle = 'rgba(255, 179, 64, 0.65)';
        ctx.lineWidth = 1;
        const xs = xOfR(win.baselineT_ms);
        ctx.beginPath();
        ctx.moveTo(xs, 4);
        ctx.lineTo(xs, h - 8);
        ctx.stroke();
        ctx.strokeStyle = '#eef6f8';
        ctx.lineWidth = 2;
        const xr = xOfR(Math.min(Math.max(rp.tMs, t0r), t1r));
        ctx.beginPath();
        ctx.moveTo(xr, 4);
        ctx.lineTo(xr, h - 8);
        ctx.stroke();
        ctx.lineWidth = 1;
        const drawTraceR = (key: 'e' | 'i', color: string) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          let started = false;
          for (const pt of win.snapshots) {
            const x = xOfR(pt.t_ms);
            const y = yOfR(pt[key][id]);
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        };
        if (traceRef.current === 'E' || traceRef.current === 'BOTH') {
          drawTraceR('e', '#ffb340');
        }
        if (traceRef.current === 'I' || traceRef.current === 'BOTH') {
          drawTraceR('i', '#4fb6f2');
        }
        // 右下角回放时刻读数（仿真时间）。
        ctx.fillStyle = '#7fa8c4';
        ctx.font = '10px ui-monospace, Menlo, monospace';
        ctx.fillText(`${(rp.tMs / 1000).toFixed(2)} s`, w - 52, h - 10);
        return;
      }

      const buf = bufferRef.current;
      if (buf.length < 2) {
        ctx.fillStyle = '#7fa8c4';
        ctx.font = '11px system-ui, sans-serif';
        // 空状态文字下移到 y=36，避开顶部的 0.6 标签。
        ctx.fillText(selectedId === null ? '点击大脑选择一个脑区' : '等待仿真数据…', 10, 36);
        return;
      }
      const t1 = buf[buf.length - 1].t_ms;
      const t0 = t1 - WINDOW_MS;
      const xOf = (t: number) => ((t - t0) / WINDOW_MS) * w;
      const yOf = (v: number) => h - 8 - (Math.min(v, Y_MAX) / Y_MAX) * (h - 16);

      // 纵向时间网格：每 2 s 一条，底部标仿真时间（秒）。
      ctx.strokeStyle = 'rgba(19, 57, 84, 0.5)';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#7fa8c4';
      ctx.font = '10px ui-monospace, Menlo, monospace';
      const firstGrid = Math.ceil(t0 / 2000) * 2000;
      for (let gt = firstGrid; gt <= t1; gt += 2000) {
        const x = xOf(gt);
        ctx.beginPath();
        ctx.moveTo(x, 4);
        ctx.lineTo(x, h - 8);
        ctx.stroke();
        const label = `${(gt / 1000).toFixed(0)}s`;
        if (x > 14 && x < w - 60) ctx.fillText(label, x + 3, h - 10);
      }

      // 刺激事件竖线（最近窗口内）
      if (sim) {
        ctx.strokeStyle = 'rgba(255, 179, 64, 0.65)';
        ctx.lineWidth = 1;
        for (const m of sim.getMarkers()) {
          if (m.t_ms < t0 || m.t_ms > t1) continue;
          const x = xOf(m.t_ms);
          ctx.beginPath();
          ctx.moveTo(x, 4);
          ctx.lineTo(x, h - 8);
          ctx.stroke();
        }
      }

      const drawTrace = (key: 'e' | 'i', color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (const pt of buf) {
          if (pt.t_ms < t0) continue;
          const x = xOf(pt.t_ms);
          const y = yOf(pt[key]);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      };

      if (traceRef.current === 'E' || traceRef.current === 'BOTH') {
        drawTrace('e', '#ffb340');
      }
      if (traceRef.current === 'I' || traceRef.current === 'BOTH') {
        drawTrace('i', '#4fb6f2');
      }

      // 右下角时间标尺
      ctx.fillStyle = '#7fa8c4';
      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.fillText(`${(t1 / 1000).toFixed(1)} s`, w - 52, h - 10);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [sim, selectedId]);

  return (
    <div className="chart-wrap" ref={wrapRef} data-selected-region-id={selectedId ?? 'none'}>
      <canvas ref={canvasRef} className="chart-canvas" />
      <div className="chart-controls">
        <span className="chart-label">
          {replay?.active
            ? `回放 REPLAY · ${replay.speed}× · 录制窗口（真实快照）`
            : 'REGIONAL NEURAL ACTIVITY · a.u. · 10 S'}
        </span>
        <span className="chart-toggles">
          {(['E', 'I', 'BOTH'] as Trace[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`chart-toggle ${trace === t ? 'chart-toggle-on' : ''}`}
              onClick={() => setTrace(t)}
            >
              {t}
            </button>
          ))}
        </span>
      </div>
      <p className="panel-text chart-note">
        纵轴为神经群体活动（任意单位），不是微伏级 EEG 电压。
      </p>
    </div>
  );
}

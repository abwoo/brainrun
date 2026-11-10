/**
 * 交互旋钮（Phase 3，Phase 4 打磨：滚轮调节、54 px 大表盘、刻度线）。
 *
 * 拖动表盘上下改值（垂直拖动，120 px 走满量程），滚轮改值（步进 0.02，
 * Shift 加速 0.1），双击恢复默认值，方向键微调。
 * 只改归一化值 k in [0,1]；到模型参数的映射由调用方负责。
 * 表盘指针角度 -135° ~ +135°，与 k 线性对应。
 */
import { useEffect, useRef, useState } from 'react';

/** 表盘刻度角：-135° ~ +135°，每 27° 一格，共 11 格。 */
const TICK_ANGLES = Array.from({ length: 11 }, (_, i) => -135 + i * 27);

interface KnobProps {
  name: string;
  note: string;
  /** 归一化值 0–1。 */
  k: number;
  defaultK: number;
  /** 大字显示值（如 "2.00"）。 */
  valueText: string;
  /** 模型参数说明（如 "G = 0.35"）。 */
  modelText: string;
  disabled?: boolean;
  onChange: (k: number) => void;
}

export default function Knob({ name, note, k, defaultK, valueText, modelText, disabled, onChange }: KnobProps) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startK: number } | null>(null);
  const dialRef = useRef<HTMLDivElement>(null);

  // 滚轮监听用 ref 存最新值，避免闭包过期；必须用原生非 passive
  // 监听才能 preventDefault（否则页面会跟着滚）。
  const kRef = useRef(k);
  kRef.current = k;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const el = dialRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (disabledRef.current) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 0.02;
      const dk = -Math.sign(e.deltaY) * step;
      onChangeRef.current(Math.min(1, Math.max(0, kRef.current + dk)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const angle = -135 + k * 270;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startY: e.clientY, startK: k };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !dragging) return;
    const dk = (d.startY - e.clientY) / 120;
    onChange(Math.min(1, Math.max(0, d.startK + dk)));
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(Math.min(1, k + step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(Math.max(0, k - step));
    }
  };

  return (
    <div className={`knob ${dragging ? 'knob-dragging' : ''} ${disabled ? 'knob-disabled' : ''}`}>
      <div
        className="knob-dial"
        ref={dialRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${name} ${note}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(k * 100)}
        aria-valuetext={valueText}
        title={disabled ? '仿真未就绪' : '拖动 / 滚轮改值 · 双击恢复默认'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          if (!disabled) onChange(defaultK);
        }}
        onKeyDown={onKeyDown}
      >
        {TICK_ANGLES.map((a) => (
          <span
            key={a}
            className={`knob-tick ${a % 135 === 0 ? 'knob-tick-major' : ''}`}
            style={{ transform: `rotate(${a}deg) translateY(-24px)` }}
          />
        ))}
        <span
          className="knob-pointer"
          style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
        />
      </div>
      <div className="knob-value">{valueText}</div>
      <div className="knob-name">{name}</div>
      <div className="knob-note">{note}</div>
      <div className="knob-model mono">{modelText}</div>
    </div>
  );
}

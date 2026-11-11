/**
 * 参数滑杆控件（PR2：替换 Phase 3/4 的旋转旋钮——用户反馈旋钮用鼠标
 * 滑不动、操作太费事）。
 *
 * 每个参数一行：横向原生 range 滑杆（28 px 高触控区）+ 数字读数 +
 * −/+ 步进按钮 + 可直接输精确值的数字框。只改归一化值 k in [0,1]；
 * 到模型参数的映射由调用方负责（KNOB_MAP，STIMULUS 非线性 0.5·4^k，
 * 其余线性），映射与范围与原来一致。
 * 滚轮改值（步进 0.02，Shift 加速 0.1）、双击滑杆恢复默认值、
 * 方向键微调保留。数字框输入的是映射后的实际值（如 2.00），提交时
 * clamp 到范围再反推 k；输错/越界不崩，只回落到当前值或边界值。
 */
import { useEffect, useRef, useState } from 'react';

/** 步进按钮与滚轮在 k 上走的步长（与旧旋钮的滚轮步进一致）。 */
const K_STEP = 0.02;

interface ParamControlProps {
  name: string;
  note: string;
  /** 归一化值 0–1（滑杆位置）。 */
  k: number;
  defaultK: number;
  /** 大字读数（如 "2.00"、"100 MS"）。 */
  displayText: string;
  /** 数字框里的值（如 "2.00"、"100"），只含数字。 */
  inputText: string;
  /** 模型参数说明（如 "幅度 2.00 · 0.5–2.0"）。 */
  modelText: string;
  /** 数字框实际值的范围与步进（映射后的单位）。 */
  min: number;
  max: number;
  inputStep: number;
  /** 数字框输入的实际值 -> k（STIMULUS 为对数反推，其余线性）。 */
  toK: (value: number) => number;
  disabled?: boolean;
  onChange: (k: number) => void;
}

export default function ParamControl({
  name,
  note,
  k,
  defaultK,
  displayText,
  inputText,
  modelText,
  min,
  max,
  inputStep,
  toK,
  disabled,
  onChange,
}: ParamControlProps) {
  const sliderRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(inputText);

  // 外部 k 变化时同步数字框；正在框里打字时不抢（避免输一半被改写）。
  useEffect(() => {
    if (document.activeElement !== numberRef.current) setText(inputText);
  }, [inputText]);

  // 滚轮监听用 ref 存最新值，避免闭包过期；必须用原生非 passive
  // 监听才能 preventDefault（否则页面会跟着滚）。与旧旋钮同一做法。
  const kRef = useRef(k);
  kRef.current = k;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (disabledRef.current) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : K_STEP;
      const dk = -Math.sign(e.deltaY) * step;
      onChangeRef.current(Math.min(1, Math.max(0, kRef.current + dk)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const decimals = inputStep >= 1 ? 0 : inputStep === 0.1 ? 1 : 2;

  /** 提交数字框：解析失败回落当前值；越界 clamp 到范围边界。 */
  const commitNumber = () => {
    const v = parseFloat(text);
    if (Number.isNaN(v)) {
      setText(inputText);
      return;
    }
    const clamped = Math.min(max, Math.max(min, v));
    setText(clamped.toFixed(decimals));
    onChange(Math.min(1, Math.max(0, toK(clamped))));
  };

  const stepK = (dk: number) => {
    if (disabled) return;
    onChange(Math.min(1, Math.max(0, k + dk)));
  };

  const onSliderKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const step = e.shiftKey ? 0.1 : K_STEP;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      stepK(step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      stepK(-step);
    }
  };

  return (
    <div className={`param ${disabled ? 'param-disabled' : ''}`} data-param={name}>
      <div className="param-head">
        <span className="param-name">{name}</span>
        <span className="param-note">{note}</span>
        <span className="param-value mono">{displayText}</span>
      </div>
      <div className="param-row">
        <button
          type="button"
          className="param-step"
          aria-label={`${name} 减小`}
          disabled={disabled}
          title="减小"
          onClick={() => stepK(-K_STEP)}
        >
          −
        </button>
        <input
          type="range"
          className="param-slider"
          ref={sliderRef}
          min={0}
          max={1000}
          step={1}
          value={Math.round(k * 1000)}
          aria-label={`${name} ${note}`}
          aria-valuetext={displayText}
          title={disabled ? '仿真未就绪' : '拖动 / 滚轮改值 · 双击恢复默认'}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value) / 1000)}
          onDoubleClick={() => {
            if (!disabled) onChange(defaultK);
          }}
          onKeyDown={onSliderKeyDown}
        />
        <button
          type="button"
          className="param-step"
          aria-label={`${name} 增大`}
          disabled={disabled}
          title="增大"
          onClick={() => stepK(K_STEP)}
        >
          +
        </button>
        <input
          type="number"
          className="param-number mono"
          ref={numberRef}
          aria-label={`${name} 数值`}
          min={min}
          max={max}
          step={inputStep}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitNumber}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitNumber();
              numberRef.current?.blur();
            }
          }}
        />
      </div>
      <div className="param-model mono">{modelText}</div>
    </div>
  );
}

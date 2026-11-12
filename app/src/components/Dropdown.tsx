import type { CSSProperties } from 'react';

/**
 * 统一的下拉框（UI 封装）。
 *
 * 项目里原来 36 处 <select> 各写各的：裸原生（浏览器默认白底弹窗，配不
 * 上深色仪器风）、.eeg-control-group 的 100% 宽规则、ExperimentLab 的
 * 内联 style 对象、TfrTab 的 marginLeft 内联样式——外观、尺寸、焦点态
 * 各不相同。本组件把它们收成一个入口：外观只由 .ui-dropdown（App.css）
 * 决定；行为仍是原生 <select>（键盘操作、无障碍、弹出列表都不变），只
 * 统一外观与交互，不改任何计算与接线。
 *
 * 值用 String() 往返：option 的 value 永远是字符串，number 型值（如脑
 * 区序号、电极序号）按 String(value) 找回原值，不用调用方再 Number()。
 */
export type DropdownOption<T extends string | number = string> = {
  value: T;
  label: string;
  /** 单个选项禁用（极少用；整框禁用走 disabled）。 */
  disabled?: boolean;
};

export type DropdownProps<T extends string | number> = {
  value: T;
  onChange: (value: T) => void;
  options: readonly DropdownOption<T>[];
  ariaLabel: string;
  id?: string;
  disabled?: boolean;
  /** 'auto'（默认，自然宽度）| 'fill'（width: 100%，用于表单列）。 */
  width?: 'auto' | 'fill';
  className?: string;
  /** 仅用于保留调用方原有的布局尺寸（如宽 90px、左间距）；不要在这里写颜色/边框。 */
  style?: CSSProperties;
  title?: string;
};

export default function Dropdown<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  disabled,
  width = 'auto',
  className,
  style,
  title,
}: DropdownProps<T>) {
  const cls = `ui-dropdown${width === 'fill' ? ' ui-dropdown--fill' : ''}${className ? ` ${className}` : ''}`;
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className={cls}
      style={style}
      title={title}
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const hit = options.find((o) => String(o.value) === e.target.value);
        if (hit) onChange(hit.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

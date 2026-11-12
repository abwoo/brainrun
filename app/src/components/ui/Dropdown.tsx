import type { ReactNode, SelectHTMLAttributes, CSSProperties } from 'react';

/**
 * Shared, accessible BrainRun dropdown: keep native select for OS keyboard
 * navigation, type-ahead, screen readers and phone/tablet pickers.
 * Decorative chevron must not intercept pointer or keyboard input.
 */
export interface DropdownProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'style'> {
  children: ReactNode;
  style?: CSSProperties;
  width?: string | number;
}
export default function Dropdown({
  children, className, style, width, disabled, ...selectProps
}: DropdownProps) {
  return (
    <span className="brainrun-dropdown" style={{ ...style, width }}>
      <select {...selectProps}
        className={'brainrun-dropdown-native' + (className ? ' ' + className : '')}
        disabled={disabled}>{children}</select>
      <svg aria-hidden="true" className="brainrun-dropdown-chevron"
        viewBox="0 0 24 24" width="16" height="16">
        <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}

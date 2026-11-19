/**
 * BenchDrillDown — the one overlay shell for every pictorial-bench
 * drill-down (design §6).
 *
 * A full-screen layer over the picture: it never unmounts ClosedLoopBench
 * (state is kept, a running protocol keeps running), never navigates, and
 * never stops a running protocol — closing only hides the overlay. One
 * drill-down at a time. Back via the "← 回到回路图" button, Esc, or the
 * backdrop. Focus goes to the back button on open and returns to the
 * element that opened the drill-down on close.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

export interface BenchDrillDownProps {
  title: string;
  drill: string;
  onClose: () => void;
  children: ReactNode;
}

export default function BenchDrillDown(props: BenchDrillDownProps) {
  const { title, drill, onClose, children } = props;
  const { t } = useI18n();
  const backRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    backRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const opener = openerRef.current as HTMLElement | null;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [onClose]);

  return (
    <div className="pict-drill" data-testid="bench-drilldown" data-drill={drill}>
      <div
        className="pict-drill-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="pict-drill-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="pict-drill-header">
          <h2>{title}</h2>
          <button
            ref={backRef}
            type="button"
            className="ui-button"
            data-testid="bench-drilldown-back"
            onClick={onClose}
          >
            {t('bench.drilldownBack')}
          </button>
        </header>
        <div className="pict-drill-body">{children}</div>
      </div>
    </div>
  );
}

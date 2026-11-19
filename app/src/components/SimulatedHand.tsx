/**
 * SimulatedHand — the 2D SVG hand on the experiment computer's keyboard
 * (pictorial bench, design §3).
 *
 * A line-drawn right hand (top view, index finger reaching for the space
 * bar), in Fig. 12.1's line style. It does ONE thing: it presses. The
 * press animation is a CSS class (.hand-pressing, translateY 6px +
 * space-bar dip + fading ripple), added by PictorialLoop when a
 * benchProtocol 'response' event arrives (the simulated subject pressing
 * Space on an oddball trial) and removed 250 ms later. The hand sends no
 * events and takes part in no computation — it is a representation of
 * the simulated subject, labelled as such. Clicking it opens the
 * experiment-computer drill-down (same as clicking the keyboard).
 *
 * Rendered as an SVG <g> so it lives inside PictorialLoop's SVG: the
 * outer <g> carries the placement transform, the inner <g> carries the
 * press transform (a CSS transform would override the placement
 * attribute on the same element).
 */
export interface SimulatedHandProps {
  x: number;
  y: number;
  pressing: boolean;
  onOpen: () => void;
  label: string;
}

export default function SimulatedHand(props: SimulatedHandProps) {
  const { x, y, pressing, onOpen, label } = props;
  return (
    <g
      transform={`translate(${x} ${y})`}
      className="pict-hand-wrap"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <g className={pressing ? 'pict-hand hand-pressing' : 'pict-hand'}>
        {/* Palm + curled fingers (top), index finger reaching down to the
            space bar. Stroke only, schematic line drawing. */}
        <g fill="#0d1824" stroke="#d7e5ef" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round">
          <rect x={34} y={6} width={52} height={40} rx={13} />
          <rect x={38} y={-2} width={10} height={14} rx={5} />
          <rect x={51} y={-4} width={10} height={16} rx={5} />
          <rect x={64} y={-4} width={10} height={16} rx={5} />
          <rect x={77} y={-2} width={9} height={13} rx={4.5} />
          <rect x={60} y={40} width={11} height={28} rx={5.5} />
          <rect x={22} y={18} width={10} height={22} rx={5} transform="rotate(-28 27 29)" />
        </g>
        {pressing && (
          <circle className="pict-hand-ripple" cx={65} cy={72} r={10} fill="none" stroke="#ffb340" strokeWidth={2} />
        )}
      </g>
    </g>
  );
}

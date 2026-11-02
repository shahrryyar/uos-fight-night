/**
 * The mark's red/blue start lines as a divider: red line (red corner) | mat ring | blue line (blue corner).
 * Decorative only (aria-hidden). Use under matchup names on posters/cards, or between flyer sections.
 *   <MatDivider />                     full width, with ring
 *   <MatDivider short />               136px stub, like the mark's start lines
 *   <MatDivider ring={false} thick />  two heavy bars, no ring
 */
export interface MatDividerProps {
  /** show the mat ring between the lines (default true) */
  ring?: boolean
  /** compact 136px version (left-aligned) */
  short?: boolean
  /** 10px bars instead of 6px */
  thick?: boolean
  className?: string
}

export default function MatDivider({ ring = true, short, thick, className = '' }: MatDividerProps) {
  const cls = ['mat-divider', short && 'mat-divider--short', thick && 'mat-divider--thick', className].filter(Boolean).join(' ')
  return (
    <div className={cls} aria-hidden="true">
      <span className="r" />
      {ring && <span className="md-ring" />}
      <span className="b" />
    </div>
  )
}

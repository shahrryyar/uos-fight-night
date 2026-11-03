import type { ReactNode } from 'react'

/** A leader line (label, dotted rule, value), DESIGN 11.10. Works on ink and on paper. */
export default function Lead({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ssn-lead" role="listitem">
      <span className="label">{label}</span><span className="dots" aria-hidden="true" />
      <span className="v">{children}</span>
    </div>
  )
}

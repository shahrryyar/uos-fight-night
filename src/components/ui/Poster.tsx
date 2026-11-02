/**
 * MATERIAL A: the taped poster. ONLY for the one thing you can act on right now (the open main event,
 * the login card, a booking you must answer). At most one per screen. The paper layer tilts; text never does.
 */
import type { CSSProperties, HTMLAttributes } from 'react'
import Tape from './Tape'
import { cx } from './cx'

type Tag = 'div' | 'section' | 'article' | 'form'

export interface PosterProps extends HTMLAttributes<HTMLElement> {
  /** paper tilt, -0.7deg to -0.9deg (default -.7deg) */
  tilt?: string
  /** show the two tape strips (default true) */
  tape?: boolean
  as?: Tag
}

export default function Poster({ tilt, tape = true, as: As = 'article', className, style, children, ...rest }: PosterProps) {
  const st = (tilt ? { ...style, '--tilt': tilt } : style) as CSSProperties | undefined
  return (
    <As className={cx('poster', className)} style={st} {...(rest as HTMLAttributes<HTMLElement>)}>
      {tape && <><Tape side="l" /><Tape side="r" /></>}
      {children}
    </As>
  )
}

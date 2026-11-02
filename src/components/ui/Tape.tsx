/** A strip of masking tape (decorative). Only inside <Poster>. side l = long strip top-left, r = short strip top-right. */
import type { CSSProperties } from 'react'

export default function Tape({ side, style }: { side: 'l' | 'r'; style?: CSSProperties }) {
  return <span className={`tape tape--${side}`} style={style} aria-hidden="true" />
}

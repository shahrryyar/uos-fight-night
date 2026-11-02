/**
 * Ticket stocks.
 *   <Ticket>  toner stock with perforated top: the pick panel inside the main-event poster.
 *   <Stub>    bone notched ticket: header balance, Me wallet. (For a link stub use className="stub balance" on a <Link>.)
 */
import type { HTMLAttributes } from 'react'
import { cx } from './cx'

type Tag = 'div' | 'section' | 'aside' | 'form'
interface P extends HTMLAttributes<HTMLElement> { as?: Tag }

export function Ticket({ as: As = 'section', className, ...rest }: P) {
  return <As className={cx('ticket', className)} {...(rest as HTMLAttributes<HTMLElement>)} />
}

export function Stub({ as: As = 'div', className, ...rest }: P) {
  return <As className={cx('stub', className)} {...(rest as HTMLAttributes<HTMLElement>)} />
}

export default Ticket

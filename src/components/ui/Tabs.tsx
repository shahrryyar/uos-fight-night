/**
 * In-page tabs (Ranks: Fighters/Pickers, Me: Picks/Points log/Account): role=tablist, roving tabindex,
 * arrow keys + Home/End. Pair with <TabPanel>.
 *   const [tab, setTab] = useState('fighters')
 *   <Tabs label="Rankings" value={tab} onChange={setTab} tabs={[{ id: 'fighters', label: 'Fighters' }, { id: 'pickers', label: 'Pickers' }]} />
 *   <TabPanel id="fighters" value={tab}>...</TabPanel>
 *
 * Section links (Admin): <NavTabs items={[{ to: '/admin', label: 'Fights', end: true }, ...]} />
 * NavLink sets aria-current="page", which .tab styles.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { cx } from './cx'

export interface TabItem<T extends string = string> { id: T; label: ReactNode }

const tabId = (id: string) => `tab-${id}`
const panelId = (id: string) => `panel-${id}`

export function Tabs<T extends string>({ tabs, value, onChange, label, className }: { tabs: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = tabs.length
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (j < 0) return
    e.preventDefault()
    onChange(tabs[j].id)
    refs.current[j]?.focus()
  }
  return (
    <div className={cx('tabs', className)} role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.id} ref={el => { refs.current[i] = el }} type="button" role="tab" className="tab"
          id={tabId(t.id)} aria-controls={panelId(t.id)} aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)} onKeyDown={e => onKey(e, i)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function TabPanel({ id, value, children, className }: { id: string; value: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={panelId(id)} aria-labelledby={tabId(id)} hidden={id !== value} tabIndex={0} className={className}>
      {id === value && children}
    </div>
  )
}

export interface NavTabItem { to: string; label: ReactNode; end?: boolean }

export function NavTabs({ items, label = 'Sections', className }: { items: NavTabItem[]; label?: string; className?: string }) {
  return (
    <nav className={cx('tabs', items.length >= 5 && 'tabs--5', className)} aria-label={label}>
      {items.map(t => <NavLink key={t.to} to={t.to} end={t.end} className="tab">{t.label}</NavLink>)}
    </nav>
  )
}

export default Tabs

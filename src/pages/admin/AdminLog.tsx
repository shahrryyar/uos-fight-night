import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { AdminLogRow } from '../../lib/types'
import { Btn, Empty, ErrorBox, SectionTitle, fmtDate, must, useAction } from '../../components/admin/ui'

const PAGE = 50

function compact(details: unknown): string {
  if (details == null) return ''
  if (typeof details !== 'object') return String(details)
  return Object.entries(details as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

export default function AdminLog() {
  const [rows, setRows] = useState<AdminLogRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [more, setMore] = useState(true)
  const act = useAction()
  const actRun = act.run

  const fetchPage = useCallback((from: number) => actRun(async () => {
    const page = must(await supabase.from('admin_log').select('*')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + PAGE - 1)) as AdminLogRow[]
    setRows(r => (from === 0 ? page : [...r, ...page]))
    setMore(page.length === PAGE)
  }), [actRun])

  useEffect(() => {
    void fetchPage(0)
    void supabase.from('profiles').select('id, username, display_name').then(({ data }) => {
      if (data) setNames(Object.fromEntries((data as { id: string; username: string; display_name: string | null }[])
        .map(p => [p.id, p.display_name?.trim() || p.username])))
    })
  }, [fetchPage])

  return (
    <div>
      <SectionTitle right={<Btn className="text-sm" onClick={() => void fetchPage(0)} busy={act.busy}>Refresh</Btn>}>Admin log</SectionTitle>
      <ErrorBox error={act.error} />
      {!act.busy && rows.length === 0 && <Empty>Nothing logged yet.</Empty>}
      <ol className="space-y-2">
        {rows.map(r => (
          <li key={r.id} className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">
                <span className="text-gold">{r.actor ? names[r.actor] ?? '…' : 'system'}</span>{' '}
                <span className="font-mono text-sm text-bone">{r.action}</span>
              </span>
              <time className="shrink-0 text-xs text-muted" dateTime={r.created_at}>{fmtDate(r.created_at)}</time>
            </div>
            {r.details != null && (
              <p className="mt-1 font-mono text-xs text-muted break-words">{compact(r.details)}</p>
            )}
          </li>
        ))}
      </ol>
      {more && rows.length > 0 && (
        <Btn className="w-full mt-3" onClick={() => void fetchPage(rows.length)} busy={act.busy}>Load more</Btn>
      )}
    </div>
  )
}

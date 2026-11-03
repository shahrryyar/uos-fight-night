import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fmtDelta, fmtNum } from '../../lib/copy'
import { useAppBalance } from '../../lib/balance'
import { END_SEASON_CONFIRM, type Balance, type CurrentChampion, type EndSeasonResult, type Season } from '../../lib/types'
import { ChampionBelt } from '../../components/brand'
import { BadgeSeal } from '../../components/badges'
import {
  ArrowCounterClockwise, Button, ButtonLink, Check, ClockCounterClockwise, Field, FlagCheckered, Input, Loading, Paper,
  Stamp, Warning, WarningOctagon, useToast,
} from '../../components/ui'
import { FormError, LoadError, SectionHead, focusFirstInvalid, must, useAction } from '../../components/admin/ui'
import { fmtSeasonDay, fmtSpan, nextSeasonName, pickerName } from '../../components/season/format'
import { seasonError } from '../../components/season/errors'
import '../../components/season/season.css'
import Lead from '../../components/season/Lead'

interface Pending { id: string; title: string | null; status: string }
interface Preview {
  season: Season
  settled: number
  pending: Pending[]
  champion: CurrentChampion | null
  topElo: { fighter_id: string; nickname: string; elo: number } | null
  topPicker: (Balance & { rank: number }) | null
  members: number
  /** every profile, switched-off ones included: admin_end_season resets them all */
  everyone: number
  above: number
  below: number
  netDelta: number
  fighters: number
}

/**
 * Season (CONTRACT B7, DESIGN 11.16): the running season's numbers on ink, then the END SEASON sheet on
 * paper. The sheet lists every consequence in plain words; typing END SEASON is the confirm step (no modal),
 * and the result replaces the sheet inline with a summary. admin_end_season(p_confirm, p_name_next).
 */
export default function AdminSeason() {
  const toast = useToast()
  const { reload: reloadBalance } = useAppBalance()
  const [pv, setPv] = useState<Preview | null>(null)
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errs, setErrs] = useState<Partial<Record<'name' | 'confirm', string>>>({})
  const [done, setDone] = useState<{ res: EndSeasonResult; ended: Season | null } | null>(null)
  const load = useAction()
  const loadRun = load.run
  const act = useAction()
  const formRef = useRef<HTMLFormElement>(null)

  const refresh = useCallback(() => loadRun(async () => {
    const season = must(await supabase.from('seasons').select('*').is('ended_at', null).maybeSingle()) as Season | null
    if (!season) { setPv(null); return }
    const [settled, pending, champ, lead, pick, profs, bal, fighters] = await Promise.all([
      supabase.from('fights').select('id', { count: 'exact', head: true }).eq('status', 'settled').gte('settled_at', season.started_at),
      supabase.from('fights').select('id, title, status').in('status', ['open', 'locked']).order('scheduled_at'),
      supabase.from('current_champion').select('*').maybeSingle(),
      // same tie-break as admin_end_season: elo desc, season wins desc, nickname
      supabase.from('fighter_rankings').select('fighter_id, nickname, elo').eq('season_ranked', true)
        .order('elo', { ascending: false }).order('season_wins', { ascending: false }).order('nickname').limit(1),
      // same tie-break as admin_end_season's top picker: balance desc, display name, id
      supabase.from('leaderboard_bettors').select('*').order('balance', { ascending: false })
        .order('display_name').order('user_id').limit(1),
      supabase.from('profiles').select('id, active'),
      supabase.from('balances').select('user_id, balance'),
      supabase.from('fighters').select('id', { count: 'exact', head: true }).or('elo.neq.1000,season_wins.gt.0,season_losses.gt.0'),
    ])
    if (settled.error) throw settled.error
    if (fighters.error) throw fighters.error
    const all = must(profs) as { id: string; active: boolean }[]
    const active = all.filter(p => p.active).length
    const balOf = new Map((must(bal) as { user_id: string; balance: number }[]).map(b => [b.user_id, Number(b.balance)]))
    let above = 0, below = 0, net = 0
    for (const { id } of all) {
      const b = balOf.get(id) ?? 0
      if (b > 1000) above++
      else if (b < 1000) below++
      net += 1000 - b
    }
    setPv({
      season, settled: settled.count ?? 0, pending: must(pending) as Pending[],
      champion: must(champ) as CurrentChampion | null,
      topElo: (must(lead) as Preview['topElo'][])[0] ?? null,
      topPicker: (must(pick) as NonNullable<Preview['topPicker']>[])[0] ?? null,
      members: active, everyone: all.length, above, below, netDelta: net, fighters: fighters.count ?? 0,
    })
    setName(n => n || nextSeasonName(season.name))
  }), [loadRun])
  useEffect(() => { void refresh() }, [refresh])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pv) return
    const next: typeof errs = {}
    const nm = name.trim()
    if (!nm) next.name = 'Name the next season, like “Season 2”.'
    else if (nm.length > 40) next.name = 'Keep it to 40 characters.'
    if (confirm.trim() !== END_SEASON_CONFIRM) next.confirm = `Type ${END_SEASON_CONFIRM} in capitals to confirm.`
    setErrs(next)
    if (Object.values(next).some(Boolean)) { focusFirstInvalid(formRef.current); return }
    if (pv.pending.length) { act.setError('Settle or cancel open and locked fights first.'); return }
    act.setError(null)
    const res = await act.run(async () => {
      const { data, error } = await supabase.rpc('admin_end_season', { p_confirm: END_SEASON_CONFIRM, p_name_next: nm })
      if (error) throw new Error(seasonError(error))
      return data as EndSeasonResult
    })
    if (!res) return
    const ended = (await supabase.from('seasons').select('*').eq('id', res.ended_season_id).maybeSingle()).data as Season | null
    setDone({ res, ended })
    setConfirm(''); setName('')
    reloadBalance()
    toast(`${res.ended_season_name} is in the books.`, { icon: FlagCheckered })
  }

  const again = () => { setDone(null); void refresh() }

  return (
    <section className="adm-section" aria-labelledby="ssn-h">
      <SectionHead id="ssn-h" title={pv && !done ? <bdi>{pv.season.name}</bdi> : 'Season'} 
        sub={pv && !done
          ? <span className="data"><span className="nowrap">Since {fmtSeasonDay(pv.season.started_at)}</span>{' · '}<span className="nowrap">{fmtSpan(pv.season.started_at)} in</span></span>
          : 'End the season at the end of term. The standings are kept on the Seasons page, then everyone starts again.'} />
      <LoadError error={load.error} what="the season" onRetry={() => void refresh()} busy={load.busy} />
      {!pv && load.busy && !load.error && <Loading label="Loading the season…" />}
      {!load.busy && !load.error && !pv && !done && (
        <p className="ink-help">No season is running. Ask a developer to check the seasons table.</p>
      )}

      {done ? <Done res={done.res} ended={done.ended} onDone={again} /> : pv && (
        <>
          <Stats pv={pv} />
          <Paper className="ssn-end" aria-labelledby="ssn-end-h">
            <form ref={formRef} className="form form--flush" onSubmit={submit} noValidate aria-labelledby="ssn-end-h">
              <div>
                <h3 id="ssn-end-h" className="t-head">End <bdi>{pv.season.name}</bdi></h3>
                <p className="t-help" style={{ marginTop: 6 }}>Do this at the end of term. The standings are kept on the Seasons page, then everyone starts again.</p>
              </div>

              {pv.pending.length > 0 && (
                <div className="ssn-blocker" role="status">
                  <Warning />
                  <p><b>{pv.pending.length === 1 ? '1 fight is' : `${pv.pending.length} fights are`} still open or locked.</b></p>
                  <p>Settle or cancel {pv.pending.length === 1 ? 'it' : 'them'} first, so no pick from this season lands after the reset. <Link to="/admin/fights">Go to Fights</Link></p>
                </div>
              )}

              <div>
                <p className="field-label" id="ssn-what">What happens</p>
                <ul className="ssn-steps" role="list" aria-labelledby="ssn-what">
                  <li><Check /><span>Final ranks and points are saved to the <b>Seasons</b> page.</span></li>
                  <li><Check /><span>{pv.champion
                    ? <><b><bdi>{pv.champion.nickname}</bdi></b> is named season champion (holds the belt).</>
                    : pv.topElo ? <>The belt is vacant, so top Elo <b><bdi>{pv.topElo.nickname}</bdi></b> is named season champion.</>
                    : <>Nobody has fought this season, so there is no season champion.</>}</span></li>
                  <li><ArrowCounterClockwise /><span>Every member goes back to <b className="nowrap">1,000&nbsp;pts</b> ({fmtNum(pv.everyone)} member{pv.everyone === 1 ? '' : 's'}{pv.above + pv.below > 0 ? <>: {pv.above} above, {pv.below} below</> : ''}). Switched-off accounts are reset too, so nobody brings old points back.</span></li>
                  <li><ArrowCounterClockwise /><span>Every fighter's Elo goes back to <b>1,000</b> and their season record to <b>0–0</b>. All-time records and streaks stay.</span></li>
                  <li><Check /><span>{pv.champion ? <>The belt stays with <b><bdi>{pv.champion.nickname}</bdi></b>.</> : <>The belt stays vacant.</>}</span></li>
                  <li className="final"><WarningOctagon /><span><b>This can't be undone.</b></span></li>
                </ul>
              </div>

              <Field label="Next season's name" hint="Up to 40 characters. Members see it on Ranks." error={errs.name}>
                <Input name="season-name" value={name} maxLength={40} autoComplete="off"
                  onChange={e => { setName(e.target.value); setErrs(x => ({ ...x, name: undefined })) }} />
              </Field>
              <Field className="ssn-confirm" label={`Type ${END_SEASON_CONFIRM} to confirm`} error={errs.confirm}>
                <Input name="confirm" value={confirm} autoComplete="off" spellCheck={false} autoCapitalize="characters"
                  onChange={e => { setConfirm(e.target.value); setErrs(x => ({ ...x, confirm: undefined })) }} />
              </Field>
              <FormError error={act.error} />
              <Button type="submit" variant="danger" wrap busy={act.busy} busyLabel="Ending the season">End <bdi>{pv.season.name}</bdi></Button>
            </form>
          </Paper>
        </>
      )}
    </section>
  )
}

function Stats({ pv }: { pv: Preview }) {
  return (
    <div className="ssn-stats">
      <div className="leaders" role="list">
        <Lead label="Bouts settled"><span className="data"><b>{fmtNum(pv.settled)}</b></span></Lead>
        <Lead label="Open or locked"><span className="data"><b>{fmtNum(pv.pending.length)}</b></span></Lead>
        <Lead label="Champion">{pv.champion
          ? <><ChampionBelt size={20} label="Belt holder" className="mr-1" /><bdi>{pv.champion.nickname}</bdi></>
          : <span className="data">Vacant</span>}</Lead>
        <Lead label="Top Elo">{pv.topElo ? <><bdi>{pv.topElo.nickname}</bdi> <span className="data nowrap">{fmtNum(pv.topElo.elo)}</span></> : <span className="data">No fights yet</span>}</Lead>
        <Lead label="Top picker">{pv.topPicker ? <><bdi>{pickerName(pv.topPicker)}</bdi> <span className="data nowrap">{fmtNum(Number(pv.topPicker.balance))} pts</span></> : <span className="data">Nobody yet</span>}</Lead>
        <Lead label="Active members"><span className="data"><b>{fmtNum(pv.members)}</b></span></Lead>
      </div>
    </div>
  )
}

function Done({ res, ended, onDone }: { res: EndSeasonResult; ended: Season | null; onDone: () => void }) {
  const snap = ended?.snapshot ?? null
  const champ = snap?.champion ?? null
  const top = snap?.top_bettor ?? null
  return (
    <Paper className="ssn-done done" role="status" aria-labelledby="ssn-done-h">
      <Stamp tone="ink" rot={-4} land stateKey={res.ended_season_id}>Season over</Stamp>
      <h3 id="ssn-done-h" className="t-head"><bdi>{res.ended_season_name}</bdi> is in the books</h3>
      <p className="t-help"><bdi>{res.next_season_name}</bdi> is running now. Everyone starts on 1,000.</p>
      <div className="leaders" role="list">
        <Lead label="Champion">{champ
          ? <>{champ.source === 'belt' && <BadgeSeal icon="Crown" size={20} rot={-2} className="ssn-seal mr-1" />}<bdi>{champ.nickname}</bdi></>
          : <span className="data">None</span>}</Lead>
        {champ && <Lead label="Chosen as"><span className="data">{champ.source === 'belt' ? 'Belt holder' : 'Top Elo'}</span></Lead>}
        <Lead label="Top picker">{top ? <><bdi>{pickerName(top)}</bdi> <span className="data nowrap">{fmtNum(top.balance)} pts</span></> : <span className="data">None</span>}</Lead>
        <Lead label="Members reset"><span className="data"><b>{fmtNum(res.members_reset)}</b></span></Lead>
        <Lead label="Net points change"><span className="data"><b>{fmtDelta(res.points_delta)}</b> pts</span></Lead>
      </div>
      <details>
        <summary>Technical details</summary>
        <pre>{JSON.stringify(res, null, 2)}</pre>
      </details>
      <div className="actions">
        <ButtonLink to="/app/seasons" variant="ghost" icon={ClockCounterClockwise}>Seasons</ButtonLink>
        <Button variant="ink" onClick={onDone}>Done</Button>
      </div>
    </Paper>
  )
}

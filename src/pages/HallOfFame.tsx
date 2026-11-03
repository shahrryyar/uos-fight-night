import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import type { HallOfFame as Hof } from '../lib/types'
import { Alert, CaretLeft, Loading } from '../components/ui'
import { ChampionsList, SeasonList } from '../components/hof/HofLists'
import RecordBook from '../components/hof/RecordBook'
import '../components/season/season.css'
import '../components/hof/hof.css'

/** Hall of Fame (C7, hall_of_fame()): champions and reigns, season champions, then the record book. */
export default function HallOfFame() {
  const st = useAsync(async () => {
    const r = await supabase.rpc('hall_of_fame')
    if (r.error) throw r.error
    return r.data as Hof
  }, [])
  const d = st.data

  return (
    <div className="pg-hof">
      <div className="pagehead" style={{ marginBottom: 0 }}>
        <Link className="back" to="/app/leaderboard"><CaretLeft />Ranks</Link>
      </div>
      <h1 className="t-title">Hall of Fame</h1>
      <p className="lede t-body">Every champion, every finished season and the all-time records.</p>

      {st.loading && !d ? <Loading label="Loading the Hall of Fame…" shape="rows" />
        : st.error && !d ? <Alert title="Couldn't load the Hall of Fame." onRetry={() => void st.reload()} className="mt-4">Check your connection and try again.</Alert>
        : d && (
          <>
            <section className="section" aria-labelledby="hof-champs">
              <div className="section-head">
                <h2 id="hof-champs" className="t-head">Champions</h2>
                {d.champions.length > 0 && <span className="data c-2">{d.champions.length} {d.champions.length === 1 ? 'reign' : 'reigns'}</span>}
              </div>
              <ChampionsList reigns={d.champions} />
            </section>

            <section className="section" aria-labelledby="hof-seasons">
              <div className="section-head">
                <h2 id="hof-seasons" className="t-head">Season champions</h2>
                <Link className="seasons-link" to="/app/seasons">All seasons</Link>
              </div>
              <SeasonList seasons={d.season_champions} />
            </section>

            <div className="section">
              <RecordBook records={d.records} asOf={d.generated_at} />
            </div>
          </>
        )}
    </div>
  )
}

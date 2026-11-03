import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDay, record } from '../../lib/hooks'
import { fmtNum } from '../../lib/copy'
import type { Fighter } from '../../lib/types'
import { resizeImage } from '../../components/admin/resizeImage'
import {
  Button, CaretLeft, CaretRight, EmptyState, Field, HalftonePhoto, Input, Loading, Paper, Plus, Seg, Stamp, Trash,
  UploadSimple, WarningOctagon, X, useToast,
} from '../../components/ui'
import { FieldGroup, FormError, LoadError, SectionHead, focusFirstInvalid, must, useAction } from '../../components/admin/ui'
import { kgLabel } from '../../components/admin/fightTypes'
import { AwardBelt, ChampBelt, useChampion } from '../../components/belt'

const BUCKET = 'fighter-photos'
/** DESIGN 8 photo direction, shown at the upload so new photos halftone well. */
const PHOTO_DIRECTION = 'Chest up, straight on, plain wall, flash on, game face.'

interface Draft { id: string | null; nickname: string; weight: string; catchphrase: string; hidden: boolean; photo_path: string | null }

const blank: Draft = { id: null, nickname: '', weight: '', catchphrase: '', hidden: false, photo_path: null }
const toDraft = (f: Fighter): Draft => ({
  id: f.id, nickname: f.nickname, weight: f.weight_kg == null ? '' : String(f.weight_kg),
  catchphrase: f.catchphrase ?? '', hidden: f.hidden, photo_path: f.photo_path,
})

async function upsert(d: Draft, photoPath: string | null): Promise<string> {
  const w = d.weight.trim() === '' ? null : Number(d.weight)
  return must(await supabase.rpc('admin_upsert_fighter', {
    p_id: d.id, p_nickname: d.nickname.trim(), p_weight_kg: w,
    p_catchphrase: d.catchphrase.trim() || null, p_photo_path: photoPath, p_hidden: d.hidden,
  })) as string
}

async function uploadPhoto(fighterId: string, file: File): Promise<string> {
  const { blob, ext, type } = await resizeImage(file, 800, 0.85)
  const path = `fighters/${fighterId}/${crypto.randomUUID()}.${ext}`
  must(await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false, cacheControl: '3600' }))
  return path
}

export default function AdminFighters() {
  const [list, setList] = useState<Fighter[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<Draft | null>(null)
  const load = useAction()
  const loadRun = load.run
  const { champion } = useChampion()

  const refresh = useCallback(() => loadRun(async () => {
    setList(must(await supabase.from('fighters').select('*').order('hidden').order('nickname')) as Fighter[])
    setLoaded(true)
  }), [loadRun])
  useEffect(() => { void refresh() }, [refresh])

  if (editing) {
    return <FighterForm initial={editing} onDone={() => { setEditing(null); void refresh() }} onCancel={() => setEditing(null)} />
  }

  return (
    <section className="adm-section" aria-labelledby="roster-h">
      <SectionHead id="roster-h" title="Roster" count={loaded ? list.length : undefined}
        right={<Button variant="bone" size="sm" icon={Plus} onClick={() => setEditing({ ...blank })}>New fighter</Button>}
        sub="Tap a fighter to edit their file, photo or title belt." />
      {loaded && (
        <p className="adm-champ t-help">
          {champion
            ? <><ChampBelt size={28} /><span>Champion: <b><bdi>{champion.nickname}</bdi></b>, since <span className="data nowrap">{fmtDay(champion.since)}</span>. Open their file to vacate the belt.</span></>
            : <span>The title belt is vacant. Open a fighter's file to award it.</span>}
        </p>
      )}
      <LoadError error={load.error} what="the roster" onRetry={() => void refresh()} busy={load.busy} />
      {!loaded && !load.error && <Loading label="Loading the roster…" shape="rows" />}
      {loaded && list.length === 0 && <EmptyState title="No fighters yet" body="Add the first one with New fighter." />}
      <ul className="rows adm-rows" role="list">
        {list.map(f => (
          <li key={f.id}>
            <button type="button" className="adm-row" onClick={() => setEditing(toDraft(f))} aria-label={`Edit ${f.nickname}`}>
              <HalftonePhoto path={f.photo_path} name={f.nickname} size={48} ink="bone" />
              <span style={{ minWidth: 0 }}>
                <span className="t-sub">{champion?.fighter_id === f.id && <ChampBelt size={22} />}<bdi>{f.nickname}</bdi></span>
                <span className="meta">
                  <span className="data"><span className="nowrap">{record(f)}</span>{f.weight_kg != null && <> · <span className="nowrap">{kgLabel(f.weight_kg)}</span></>}</span>
                  {f.hidden && <Stamp tone="bone" size="sm" rot={-2}>Hidden</Stamp>}
                </span>
              </span>
              <span className="end end--chev">
                <span><span className="data-lg">{fmtNum(f.elo)}</span><span className="label">Elo</span></span>
                <CaretRight className="chev" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FighterForm({ initial, onDone, onCancel }: { initial: Draft; onDone: () => void; onCancel: () => void }) {
  const toast = useToast()
  const [d, setD] = useState<Draft>(initial)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [errs, setErrs] = useState<{ nickname?: string; weight?: string; photo?: string }>({})
  const act = useAction()
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const isNew = !d.id

  // revoke the previous object URL whenever the preview changes / on unmount
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const pickFile = (f: File | null) => {
    if (f && !f.type.startsWith('image/')) { setErrs(e => ({ ...e, photo: 'That file isn\'t a photo. Pick a JPG, PNG or WebP.' })); return }
    setErrs(e => ({ ...e, photo: undefined }))
    setFile(f); setPreview(f ? URL.createObjectURL(f) : null)
  }
  const resetFile = () => { pickFile(null); if (fileRef.current) fileRef.current.value = '' }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(p => ({ ...p, [k]: v }))

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) pickFile(f)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errs = {}
    if (!d.nickname.trim()) next.nickname = 'Give them a nickname. It\'s how members know them.'
    if (d.weight.trim() && !(Number(d.weight) > 0 && Number(d.weight) < 1000)) next.weight = 'Weight is a number in kg, like 72.5.'
    if (file && file.size > 25 * 1024 * 1024) next.photo = 'That photo is over 25MB. Pick a smaller one.'
    setErrs(next)
    if (Object.values(next).some(Boolean)) { focusFirstInvalid(formRef.current); return }
    const res = await act.run(async () => {
      // 1) create/update to get an id
      const id = await upsert(d, d.photo_path)
      setD(p => ({ ...p, id })) // so a failed upload retry updates instead of duplicating
      let path = d.photo_path
      // 2) upload photo (needs id for the path), then save path
      if (file) {
        const old = d.photo_path
        path = await uploadPhoto(id, file)
        await upsert({ ...d, id }, path)
        if (old && old !== path) void supabase.storage.from(BUCKET).remove([old]) // best effort cleanup
      }
      return { id, path }
    })
    if (res) {
      setD(p => ({ ...p, id: res.id, photo_path: res.path }))
      resetFile()
      toast(isNew ? `${d.nickname.trim()} is on the roster.` : 'Saved.')
      if (isNew) onDone()
    }
  }

  const removePhoto = async () => {
    if (!d.id || !d.photo_path) return
    const old = d.photo_path
    const r = await act.run(async () => { await upsert(d, null); return true })
    if (r) { void supabase.storage.from(BUCKET).remove([old]); setD(p => ({ ...p, photo_path: null })); toast('Photo removed.') }
  }

  const name = d.nickname.trim() || 'New fighter'

  return (
    <section className="adm-section" aria-labelledby="ff-h">
      <button type="button" className="back" onClick={onCancel} style={{ background: 'transparent', border: 0, padding: 0 }}>
        <CaretLeft />Roster
      </button>
      <Paper style={{ marginTop: 8 }}>
        <form ref={formRef} className="form form--flush" onSubmit={save} noValidate aria-labelledby="ff-h">
          <h2 id="ff-h" className="t-head"><bdi>{isNew ? 'New fighter' : d.nickname || 'Edit fighter'}</bdi></h2>

          <div className="field">
            <span className="field-label" id="ff-photo">Photo</span>
            <div className="drop" data-over={over ? '' : undefined} role="group" aria-labelledby="ff-photo"
              onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
              {preview
                ? <HalftonePhoto key={preview} src={preview} name={name} size={112} alt="new photo preview" />
                : <HalftonePhoto path={d.photo_path} name={name} size={112} />}
              <div className="side-col">
                <span className="btn btn--ink btn--sm file-btn">
                  <UploadSimple />{d.photo_path || preview ? 'Change photo' : 'Choose photo'}
                  <input ref={fileRef} type="file" accept="image/*" aria-label={d.photo_path || preview ? 'Change photo' : 'Choose photo'}
                    aria-describedby="ff-dir" onChange={e => pickFile(e.target.files?.[0] ?? null)} />
                </span>
                {preview && <Button variant="ghost" size="sm" icon={X} onClick={resetFile}>Discard new</Button>}
                {!preview && d.photo_path && d.id && (
                  <Button variant="danger" size="sm" icon={Trash} onClick={removePhoto} busy={act.busy} busyLabel="Removing">Remove</Button>
                )}
                <p className="t-help">{preview ? 'Preview. Saved when you press Save.' : 'Or drop a photo here.'}</p>
              </div>
              <p id="ff-dir" className="t-help direction"><b>{PHOTO_DIRECTION}</b> Resized to 800px. Only members can see it.</p>
            </div>
            {errs.photo && <p className="field-error" role="alert"><WarningOctagon />{errs.photo}</p>}
          </div>

          <Field label="Nickname" error={errs.nickname}>
            <Input value={d.nickname} maxLength={40} required name="nickname" autoComplete="off"
              onChange={e => { set('nickname', e.target.value); setErrs(x => ({ ...x, nickname: undefined })) }} />
          </Field>
          <Field label={<>Weight, kg <span className="opt">(optional)</span></>} error={errs.weight}>
            <Input look="data" inputMode="decimal" value={d.weight} name="weight_kg" autoComplete="off"
              onChange={e => { set('weight', e.target.value.replace(/[^\d.,]/g, '').replace(',', '.')); setErrs(x => ({ ...x, weight: undefined })) }} />
          </Field>
          <Field label={<>Catchphrase <span className="opt">(optional)</span></>} hint="Shown on their profile, in quotes.">
            <Input value={d.catchphrase} maxLength={120} name="catchphrase" autoComplete="off" onChange={e => set('catchphrase', e.target.value)} />
          </Field>
          <FieldGroup label="On the roster" hint={d.hidden ? 'Hidden fighters don\'t show to members and can\'t be booked.' : 'Members can see this fighter.'}>
            <div className="segs">
              <Seg pressed={!d.hidden} onClick={() => set('hidden', false)}>Shown</Seg>
              <Seg pressed={d.hidden} onClick={() => set('hidden', true)}>Hidden</Seg>
            </div>
          </FieldGroup>

          <FormError error={act.error} />
          <div className="actions">
            <Button variant="ghost" onClick={onCancel}>Back</Button>
            <Button type="submit" busy={act.busy} busyLabel="Saving">{isNew ? 'Add fighter' : 'Save'}</Button>
          </div>
        </form>
      </Paper>
      {d.id && <AwardBelt fighter={{ id: d.id, nickname: initial.nickname || d.nickname, hidden: initial.hidden }} />}
    </section>
  )
}


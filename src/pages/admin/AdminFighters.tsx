import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Fighter } from '../../lib/types'
import FighterPhoto from '../../components/FighterPhoto'
import { resizeImage } from '../../components/admin/resizeImage'
import { Btn, Card, Empty, ErrorBox, Field, OkBox, Pill, SectionTitle, inputCls, must, useAction } from '../../components/admin/ui'

const BUCKET = 'fighter-photos'

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
  const [editing, setEditing] = useState<Draft | null>(null)
  const load = useAction()
  const loadRun = load.run

  const refresh = useCallback(() => loadRun(async () => {
    setList(must(await supabase.from('fighters').select('*').order('hidden').order('nickname')) as Fighter[])
  }), [loadRun])
  useEffect(() => { void refresh() }, [refresh])

  if (editing) {
    return <FighterForm initial={editing} onDone={() => { setEditing(null); void refresh() }} onCancel={() => setEditing(null)} />
  }

  return (
    <div>
      <SectionTitle right={<Btn variant="red" onClick={() => setEditing({ ...blank })}>+ New fighter</Btn>}>
        Roster <span className="text-muted text-xl">({list.length})</span>
      </SectionTitle>
      <ErrorBox error={load.error} />
      {!load.busy && list.length === 0 && <Empty>No fighters yet. Add the first one.</Empty>}
      <ul className="space-y-2">
        {list.map(f => (
          <li key={f.id}>
            <button type="button" onClick={() => setEditing(toDraft(f))}
              className={`w-full flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left hover:border-muted ${f.hidden ? 'opacity-60' : ''}`}>
              <FighterPhoto path={f.photo_path} nickname={f.nickname} className="size-12 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-display text-2xl tracking-wide truncate">{f.nickname}</span>
                  {f.hidden && <Pill>Hidden</Pill>}
                </span>
                <span className="block text-xs text-muted">
                  {f.wins}-{f.losses} · Elo {f.elo}{f.weight_kg != null && ` · ${f.weight_kg} kg`}
                </span>
              </span>
              <span className="text-muted text-sm">Edit ›</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FighterForm({ initial, onDone, onCancel }: { initial: Draft; onDone: () => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(initial)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [ok, setOk] = useState('')
  const act = useAction()
  const fileRef = useRef<HTMLInputElement>(null)
  const isNew = !d.id

  // revoke the previous object URL whenever the preview changes / on unmount
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const pickFile = (f: File | null) => { setFile(f); setPreview(f ? URL.createObjectURL(f) : null) }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(p => ({ ...p, [k]: v }))

  const save = async (e: FormEvent) => {
    e.preventDefault(); setOk('')
    if (!d.nickname.trim()) return act.setError('Nickname is required.')
    if (d.weight.trim() && !(Number(d.weight) > 0 && Number(d.weight) < 1000)) return act.setError('Weight should be a number in kg.')
    if (file && file.size > 25 * 1024 * 1024) return act.setError('That photo is huge. Pick one under 25MB.')
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
      pickFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setOk(isNew ? 'Fighter added to the roster.' : 'Saved.')
      if (isNew) onDone()
    }
  }

  const removePhoto = async () => {
    if (!d.id || !d.photo_path) return
    const old = d.photo_path
    const r = await act.run(async () => { await upsert(d, null); return true })
    if (r) { void supabase.storage.from(BUCKET).remove([old]); setD(p => ({ ...p, photo_path: null })); setOk('Photo removed.') }
  }

  return (
    <Card>
      <SectionTitle right={<Btn onClick={onCancel}>‹ Back</Btn>}>{isNew ? 'New fighter' : 'Edit fighter'}</SectionTitle>
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center gap-4">
          {preview
            ? <img src={preview} alt="New photo preview" className="size-24 rounded-full object-cover ring-2 ring-gold" />
            : <FighterPhoto path={d.photo_path} nickname={d.nickname || '?'} className="size-24 text-3xl" />}
          <div className="flex-1 space-y-2">
            <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface-2 px-4 font-semibold hover:border-muted">
              {d.photo_path || preview ? 'Change photo' : 'Add photo'}
              <input ref={fileRef} type="file" accept="image/*" className="sr-only"
                onChange={e => pickFile(e.target.files?.[0] ?? null)} />
            </label>
            {preview && <Btn className="w-full text-sm" onClick={() => { pickFile(null); if (fileRef.current) fileRef.current.value = '' }}>Discard new photo</Btn>}
            {!preview && d.photo_path && d.id && <Btn variant="danger" className="w-full text-sm" onClick={removePhoto} busy={act.busy}>Remove photo</Btn>}
          </div>
        </div>
        <p className="text-xs text-muted">Photos are resized to 800px and only visible to members.</p>

        <Field label="Nickname">
          <input className={`${inputCls} font-display text-2xl tracking-wide`} value={d.nickname} maxLength={40} required
            onChange={e => set('nickname', e.target.value)} placeholder="The Mattress Crusher" />
        </Field>
        <Field label="Weight (kg)">
          <input className={inputCls} inputMode="decimal" value={d.weight} onChange={e => set('weight', e.target.value)} placeholder="72.5" />
        </Field>
        <Field label="Catchphrase">
          <input className={inputCls} value={d.catchphrase} maxLength={120} onChange={e => set('catchphrase', e.target.value)} placeholder="Lights out, roommate." />
        </Field>
        <label className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3">
          <span>
            <span className="block font-semibold">Hidden</span>
            <span className="block text-xs text-muted">Hidden fighters don't show to members</span>
          </span>
          <input type="checkbox" className="size-6 accent-red" checked={d.hidden} onChange={e => set('hidden', e.target.checked)} />
        </label>

        <ErrorBox error={act.error} />
        <OkBox>{ok}</OkBox>
        <Btn type="submit" variant="red" busy={act.busy} className="w-full min-h-12 font-display text-2xl tracking-widest">
          {isNew ? 'Add fighter' : 'Save'}
        </Btn>
      </form>
    </Card>
  )
}

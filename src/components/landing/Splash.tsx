/**
 * The one loading fallback used everywhere (auth gate + lazy route Suspense).
 * `inline` fills the content area inside AppLayout instead of the full viewport.
 */
export default function Splash({ inline = false }: { inline?: boolean }) {
  return (
    <div role="status" aria-live="polite"
      className={`${inline ? 'min-h-[50dvh]' : 'min-h-dvh'} grid place-items-center font-display text-3xl tracking-wider text-muted`}>
      LOADING…
    </div>
  )
}

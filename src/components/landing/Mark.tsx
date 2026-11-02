/** Brand mark: red glove with gold cuff (same art as /favicon.svg). */
export default function Mark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ufn-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ef3344" />
          <stop offset="1" stopColor="#a4121f" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#16161a" />
      <path d="M64 40 L64 50 Q64 64 50 64 L34 64 Z" fill="#2a6fdb" opacity=".9" />
      <path d="M21 45 C15 41 12.5 33 13.5 25 C15 14 23 8 33.5 8 C45 8 52 15.5 52 26.5 C52 35 48.5 41 43 45 Z" fill="url(#ufn-mark-g)" />
      <path d="M13.6 28.5 C10 29.5 9.5 35.5 13.5 38.5 C17 41 24 40.5 28.5 36.5 C30.5 34.7 29.8 31.6 27.2 31.3 C23.5 30.9 20.5 31.7 18 31 C16.3 30.5 15.3 28.1 13.6 28.5 Z" fill="#c4152a" stroke="#6e0b15" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M26 13.5 C31 11.6 38.5 11.8 43.5 15.5" fill="none" stroke="#ff8a95" strokeWidth="2.6" strokeLinecap="round" opacity=".75" />
      <rect x="19" y="44" width="25.5" height="12.5" rx="3" fill="#e3b341" />
      <path d="M19 49.5 H44.5" stroke="#8a6512" strokeWidth="1.6" />
    </svg>
  )
}

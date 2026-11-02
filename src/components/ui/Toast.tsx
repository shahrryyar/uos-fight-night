/**
 * Toast (DESIGN 11.17): bone strip, 4s, tap to dismiss, role=status. Transient confirmations only
 * ("Pick saved...", "Password saved.", "Copied."). Errors are inline <Alert>/<FieldError>, never toasts.
 *
 *   const toast = useToast(); toast('Password saved.')
 *   toast('Pick taken back. 50 pts are yours again.', { icon: ArrowCounterClockwise })
 *
 * <ToastProvider> is mounted once in main.tsx. It sits 76px above the bottom when the tab bar is
 * on screen, 16px otherwise.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, type IconComponent } from './Icon'

interface ToastMsg { id: number; text: ReactNode; icon: IconComponent; tabbar: boolean }
export type ShowToast = (text: ReactNode, opts?: { icon?: IconComponent; ms?: number }) => void

const Ctx = createContext<ShowToast>(() => {})

export function useToast(): ShowToast { return useContext(Ctx) }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const seq = useRef(0)
  const show = useCallback<ShowToast>((text, opts) => {
    window.clearTimeout(timer.current)
    const tabbar = typeof document !== 'undefined' && !!document.querySelector('.tabbar')
    setMsg({ id: ++seq.current, text, icon: opts?.icon ?? Check, tabbar })
    timer.current = window.setTimeout(() => setMsg(null), opts?.ms ?? 4000)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const Ico = msg?.icon
  return (
    <Ctx.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true">
        {msg && Ico && (
          <button key={msg.id} type="button" data-enter="" className={`toast${msg.tabbar ? '' : ' toast--no-tabbar'}`}
            onClick={() => setMsg(null)}>
            <Ico />
            <span>{msg.text}</span>
            <span className="sr-only"> (tap to dismiss)</span>
          </button>
        )}
      </div>
    </Ctx.Provider>
  )
}

export default ToastProvider

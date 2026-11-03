import { createContext, useContext, type ReactNode } from 'react'
import type { IconComponent } from './Icon'

export type ShowToast = (text: ReactNode, opts?: { icon?: IconComponent; ms?: number }) => void

export const Ctx = createContext<ShowToast>(() => {})

export function useToast(): ShowToast {
  return useContext(Ctx)
}

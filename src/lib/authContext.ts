import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Profile } from './types'

export interface AuthCtx {
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const Ctx = createContext<AuthCtx | null>(null)
export const AuthCtxProvider = Ctx.Provider

export function useAuth(): AuthCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

/** The name shown on screens: admin-set display_name, falling back to @username. */
export function shownName(p: Pick<Profile, 'display_name' | 'username'> | null | undefined): string {
  if (!p) return ''
  return p.display_name?.trim() || `@${p.username}`
}

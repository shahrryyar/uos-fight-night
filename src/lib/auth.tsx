import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, usernameToEmail, USERNAME_RE } from './supabase'
import type { Profile } from './types'

interface AuthCtx {
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  signIn: (username: string, password: string) => Promise<void>
  signUp: (username: string, password: string, invite: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    setProfile((data as Profile) ?? null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session?.user.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      // defer DB call out of the auth callback (supabase-js recommendation)
      setTimeout(() => { void loadProfile(s?.user.id) }, 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const signIn = async (username: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password })
    if (error) throw error
  }
  const signUp = async (username: string, password: string, invite: string) => {
    const u = username.trim().toLowerCase()
    if (!USERNAME_RE.test(u)) throw new Error('Username: 3-20 letters, numbers or _')
    if (password.length < 8) throw new Error('Password must be at least 8 characters')
    const { error } = await supabase.auth.signUp({
      email: usernameToEmail(u),
      password,
      options: { data: { username: u, invite_code: invite.trim().toUpperCase() } },
    })
    if (error) throw error
  }
  const signOut = async () => { await supabase.auth.signOut() }

  return (
    <Ctx.Provider value={{
      session, profile, loading,
      isAdmin: profile?.role === 'admin' && profile.active,
      signIn, signUp, signOut,
      refreshProfile: () => loadProfile(session?.user.id),
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

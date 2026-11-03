import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, usernameToEmail } from './supabase'
import type { Profile } from './types'
import { AuthCtxProvider } from './authContext'

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
  const signOut = async () => { await supabase.auth.signOut() }

  return (
    <AuthCtxProvider value={{
      session, profile, loading,
      isAdmin: profile?.role === 'admin' && profile.active,
      signIn, signOut,
      refreshProfile: () => loadProfile(session?.user.id),
    }}>
      {children}
    </AuthCtxProvider>
  )
}

export default AuthProvider

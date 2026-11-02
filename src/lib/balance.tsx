/**
 * Header balance shared by AppLayout (the .stub.balance ticket) and pages that change it.
 * Pages call `useAppBalance().reload()` after a pick, a take-back or an admin points change,
 * so the header stub stays true. Outside AppLayout it falls back to a no-op.
 */
import { createContext, useContext } from 'react'

export interface AppBalance { balance: number | null; loading: boolean; reload: () => void }

export const BalanceContext = createContext<AppBalance>({ balance: null, loading: false, reload: () => {} })

export function useAppBalance(): AppBalance { return useContext(BalanceContext) }

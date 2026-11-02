export type Side = 'red' | 'blue'
export type FightStatus = 'scheduled' | 'open' | 'locked' | 'settled' | 'cancelled'
export type WinMethod = 'pin' | 'submission' | 'decision'
export type BetStatus = 'active' | 'cancelled' | 'won' | 'lost' | 'refunded'
export const EMOJIS = ['🔥', '💀', '😂', '💪', '👑', '😱'] as const
export type Emoji = (typeof EMOJIS)[number]

export interface Profile {
  id: string
  username: string
  display_name: string | null
  role: 'member' | 'admin'
  fighter_id: string | null
  active: boolean
  created_at: string
}
export interface Fighter {
  id: string
  nickname: string
  weight_kg: number | null
  catchphrase: string | null
  photo_path: string | null
  elo: number
  wins: number
  losses: number
  streak: number
  hidden: boolean
  created_at: string
}
export interface Fight {
  id: string
  title: string | null
  red_fighter_id: string
  blue_fighter_id: string
  scheduled_at: string
  lock_at: string
  status: FightStatus
  winner_side: Side | null
  method: WinMethod | null
  result_note: string | null
  recorded_by: string | null
  settled_at: string | null
  red_elo_before: number | null
  blue_elo_before: number | null
  elo_delta: number | null
  created_by: string | null
  created_at: string
}
export interface Vote { fight_id: string; user_id: string; side: Side; is_participant: boolean; updated_at: string }
export interface Bet {
  id: string; fight_id: string; user_id: string; side: Side; amount: number
  status: BetStatus; payout: number | null; created_at: string
}
export interface LedgerRow {
  id: number; user_id: string; delta: number
  reason: 'signup' | 'weekly' | 'topup' | 'bet' | 'bet_cancel' | 'payout' | 'refund' | 'admin_adjust'
  ref_id: string | null; note: string | null; created_at: string
}
export interface FightPool { fight_id: string; red_total: number; blue_total: number; red_count: number; blue_count: number }
export interface Reaction { fight_id: string; user_id: string; emoji: Emoji; created_at: string }
export interface Invite {
  code: string; created_by: string | null; max_uses: number; uses: number
  expires_at: string | null; revoked: boolean; created_at: string
}
export interface AdminLogRow { id: number; actor: string | null; action: string; target_id: string | null; details: unknown; created_at: string }
export interface Balance { user_id: string; username: string; balance: number }
export interface BettorRank extends Balance { rank: number }
export interface FighterRanking {
  fighter_id: string; nickname: string; elo: number; wins: number; losses: number
  streak: number; fights: number; ranked: boolean; rank: number | null
}
export interface VoteTotals { red_votes: number; blue_votes: number; red_pct: number; blue_pct: number }
export interface PublicNextFight {
  id: string; title: string | null; lock_at: string; scheduled_at: string
  status: FightStatus; red_nickname: string; blue_nickname: string
}

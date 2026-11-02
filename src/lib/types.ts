// Row types for the Supabase schema (supabase/migrations). Owned by the db agent.
export type Side = 'red' | 'blue'
export type FightStatus = 'scheduled' | 'open' | 'locked' | 'settled' | 'cancelled'
export type WinMethod = 'pin' | 'submission' | 'decision'
export type CancelKind = 'cancelled' | 'no_contest' | 'declined'
export type BetStatus = 'active' | 'cancelled' | 'won' | 'lost' | 'refunded'
export type Role = 'member' | 'admin'
export type LedgerReason =
  | 'signup' | 'weekly' | 'topup' | 'bet' | 'bet_cancel' | 'payout' | 'refund' | 'admin_adjust'
  | 'payout_reversal'
export const EMOJIS = ['🔥', '💀', '😂', '💪', '👑', '😱'] as const
export type Emoji = (typeof EMOJIS)[number]

export interface Profile {
  id: string
  username: string
  /** Required; set by admins only. Show this on every screen instead of username. */
  display_name: string
  role: Role
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
  /** Referee note (settled) or cancel reason (cancelled). ≤200 chars. */
  result_note: string | null
  recorded_by: string | null
  settled_at: string | null
  red_elo_before: number | null
  blue_elo_before: number | null
  /** Change applied to red; blue got -elo_delta. */
  elo_delta: number | null
  created_by: string | null
  created_at: string
  // Addendum A — match stats (weights are the snapshot for this match)
  red_weight_kg: number | null
  blue_weight_kg: number | null
  rounds: number | null
  red_score: number | null
  blue_score: number | null
  finish_move: string | null
  // B2 — consent / cancel kind
  red_accepted_at: string | null
  blue_accepted_at: string | null
  cancel_kind: CancelKind | null
  // B3 — card
  bout_order: number
  is_main_event: boolean
  /** Asia/Baghdad calendar date of scheduled_at, 'YYYY-MM-DD'. */
  card_date: string
}
export interface Vote { fight_id: string; user_id: string; side: Side; is_participant: boolean; updated_at: string }
export interface Bet {
  id: string; fight_id: string; user_id: string; side: Side; amount: number
  status: BetStatus; payout: number | null; created_at: string
}
export interface LedgerRow {
  id: number; user_id: string; delta: number
  reason: LedgerReason
  ref_id: string | null; note: string | null; created_at: string
}
export interface FightPool { fight_id: string; red_total: number; blue_total: number; red_count: number; blue_count: number }
export interface Reaction { fight_id: string; user_id: string; emoji: Emoji; created_at: string }
export interface AdminLogRow { id: number; actor: string | null; action: string; target_id: string | null; details: unknown; created_at: string }
/** View `balances` (own row for members, all rows for admins). */
export interface Balance { user_id: string; username: string; balance: number; display_name: string }
/** View `leaderboard_bettors`. */
export interface BettorRank extends Balance { rank: number }
/** View `fighter_rankings` (stats over settled fights). */
export interface FighterRanking {
  fighter_id: string; nickname: string; elo: number; wins: number; losses: number
  streak: number; fights: number; ranked: boolean; rank: number | null
  total_rounds: number; points_for: number; points_against: number
  wins_pin: number; wins_submission: number; wins_decision: number
  losses_pin: number; losses_submission: number; losses_decision: number
  /** Current fighter weight (extra column, not in the contract list). */
  weight_kg: number | null
}
/** View `fight_results`: one row per settled fight per fighter perspective. */
export interface FightResult {
  fight_id: string
  fighter_id: string
  opponent_id: string
  side: Side
  result: 'W' | 'L'
  method: WinMethod
  finish_move: string | null
  rounds: number
  score_for: number
  score_against: number
  weight_kg: number | null
  opponent_weight_kg: number | null
  /** Signed for this fighter. */
  elo_delta: number
  settled_at: string
  result_note: string | null
}
export interface VoteTotals { red_votes: number; blue_votes: number; red_pct: number; blue_pct: number }
export interface PublicNextFight {
  id: string; title: string | null; lock_at: string; scheduled_at: string
  status: FightStatus; red_nickname: string; blue_nickname: string
  red_weight_kg: number | null; blue_weight_kg: number | null; is_main_event: boolean
}
/** admin_settle_fight() result. */
export interface SettleResult {
  fight_id: string; winner_side: Side; method: WinMethod; rounds: number
  red_score: number; blue_score: number; total_pool: number; winning_pool: number
  winners: number; dust: number; refunded: number; elo_delta: number
  red_elo_before: number; blue_elo_before: number
}
/** admin_correct_result() result. */
export interface CorrectResult {
  fight_id: string; status: 'locked'; reversed_payouts: number; bets_restored: number
  red_elo: number; blue_elo: number
}
/** Edge Function admin-create-user. */
export interface CreateUserBody {
  username: string; display_name: string; password: string; role: Role; fighter_id?: string | null
}
export interface CreateUserResult { user_id: string; username: string }

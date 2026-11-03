// Row types for the Supabase schema (supabase/migrations). Owned by the db agent.
export type Side = 'red' | 'blue'
export type FightStatus = 'scheduled' | 'open' | 'locked' | 'settled' | 'cancelled'
export type WinMethod = 'pin' | 'submission' | 'decision'
export type CancelKind = 'cancelled' | 'no_contest' | 'declined'
export type BetStatus = 'active' | 'cancelled' | 'won' | 'lost' | 'refunded'
export type Role = 'member' | 'admin'
export type LedgerReason =
  | 'signup' | 'weekly' | 'topup' | 'bet' | 'bet_cancel' | 'payout' | 'refund' | 'admin_adjust'
  | 'payout_reversal' | 'season_reset'
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
  // B7 — current-season record (elo is per season: reset to 1000 by admin_end_season)
  season_wins: number
  season_losses: number
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
  /** B5 — the champion is in this fight. Live for scheduled/open/locked (moves with the belt), frozen once settled. */
  is_title_fight: boolean
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
  // B7 — season board (elo above is already the season Elo)
  season_wins: number; season_losses: number; season_fights: number
  /** season_fights >= 1 */
  season_ranked: boolean
  season_rank: number | null
  /** B5 — holds the belt now. */
  is_champion: boolean
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
  // B5
  is_title_fight: boolean
  /** Which corner the champion is in (null = not a title fight). */
  champion_side: Side | null
  /** Current champion's nickname, even when not in this fight (null = vacant). */
  champion_nickname: string | null
}
/** admin_settle_fight() result. */
export interface SettleResult {
  fight_id: string; winner_side: Side; method: WinMethod; rounds: number
  red_score: number; blue_score: number; total_pool: number; winning_pool: number
  winners: number; dust: number; refunded: number; elo_delta: number
  red_elo_before: number; blue_elo_before: number
  // Wave B
  is_title_fight: boolean
  /** 'changed' = the champion lost and the winner took the belt. */
  belt: 'none' | 'defended' | 'changed'
  fighter_badges: { fighter_id: string; code: FighterBadgeCode }[]
  /** Count of new bet-based user badges (high_roller, comeback). sharp_eye / perfect_night sync silently. */
  user_badges: number
}
/** admin_correct_result() result. */
export interface CorrectResult {
  fight_id: string; status: 'locked'; reversed_payouts: number; bets_restored: number
  red_elo: number; blue_elo: number
  // Wave B
  belt_restored: boolean; fighter_badges_removed: number; user_badges_removed: number
}
/** Edge Function admin-create-user. */
export interface CreateUserBody {
  username: string; display_name: string; password: string; role: Role; fighter_id?: string | null
}
export interface CreateUserResult { user_id: string; username: string }

// ---------------------------------------------------------------------------
// Wave B — B4 live scoring
// ---------------------------------------------------------------------------
export type LiveAction = 'start' | 'pause' | 'next_round' | 'red_add' | 'blue_add' | 'set_round_seconds' | 'reset'
/** Table `live_scores` (realtime). Elapsed = accumulated_seconds + (now - round_started_at) while running, capped at round_seconds. */
export interface LiveScore {
  fight_id: string
  round: number
  red_score: number
  blue_score: number
  /** Start of the current running segment; null when paused. */
  round_started_at: string | null
  /** Seconds banked in this round before round_started_at. */
  accumulated_seconds: number
  round_seconds: number
  running: boolean
  updated_at: string
  updated_by: string | null
}
/** View `live_score_state`, `get_live_score(p_fight_id)` row and `admin_live_update()` result. */
export interface LiveScoreState extends LiveScore {
  elapsed_seconds: number
  remaining_seconds: number
  time_up: boolean
  /** running, or updated in the last 10 minutes. */
  is_live: boolean
  /** Server clock at read time: use it to correct the local clock offset. */
  server_now: string
}

// ---------------------------------------------------------------------------
// Wave B — B5 title belt
// ---------------------------------------------------------------------------
export type BeltEndReason = 'lost' | 'vacated' | 'reassigned'
/** Table `belt_reigns`. ended_at null = current reign (at most one). */
export interface BeltReign {
  id: string
  fighter_id: string
  won_fight_id: string | null
  lost_fight_id: string | null
  started_at: string
  ended_at: string | null
  end_reason: BeltEndReason | null
  note: string | null
  awarded_by: string | null
  created_at: string
}
/** View `belt_reign_history`. */
export interface BeltReignHistory {
  reign_id: string; fighter_id: string; nickname: string
  started_at: string; ended_at: string | null; end_reason: BeltEndReason | null
  won_fight_id: string | null; lost_fight_id: string | null; note: string | null
  defenses: number; is_current: boolean
}
/** View `current_champion` (0 or 1 row). */
export interface CurrentChampion {
  fighter_id: string; nickname: string; since: string; defenses: number
  reign_id: string; won_fight_id: string | null
}
/** admin_award_belt() result. fighter_id null = vacated. */
export interface AwardBeltResult {
  reign_id: string | null; fighter_id: string | null
  prev_fighter_id: string | null; prev_reign_id: string | null
}

// ---------------------------------------------------------------------------
// Wave B — B6 badges
// ---------------------------------------------------------------------------
export type FighterBadgeCode = 'first_win' | 'streak_3' | 'streak_5' | 'upset' | 'iron_man' | 'shutout' | 'belt_holder'
export type UserBadgeCode = 'sharp_eye' | 'high_roller' | 'perfect_night' | 'comeback'
export type BadgeCode = FighterBadgeCode | UserBadgeCode
export type BadgeKind = 'fighter' | 'user'
/** Table `badge_catalog` (source of truth for label/description/icon). icon = Phosphor icon name. */
export interface BadgeCatalogRow { code: BadgeCode; kind: BadgeKind; label: string; description: string; icon: string; sort: number }
/** Tables `fighter_badges` / `user_badges`: one row per award. fight_id null = admin award. */
export interface FighterBadge { id: number; fighter_id: string; code: FighterBadgeCode; fight_id: string | null; awarded_at: string }
export interface UserBadge { id: number; user_id: string; code: UserBadgeCode; fight_id: string | null; awarded_at: string }
/** list_badges(p_kind, p_id) row: one per code earned, catalog order. */
export interface BadgeSummary {
  code: BadgeCode; label: string; description: string; icon: string
  times: number; first_awarded_at: string; last_awarded_at: string; last_fight_id: string | null
}
/** Mirror of badge_catalog for static rendering (keep in sync with the migration). */
export const BADGES: Record<BadgeCode, { kind: BadgeKind; label: string; description: string; icon: string }> = {
  first_win:     { kind: 'fighter', label: 'First Blood',   description: 'Won their first fight',                            icon: 'HandFist' },
  streak_3:      { kind: 'fighter', label: 'Heating Up',    description: 'Won 3 fights in a row',                            icon: 'Fire' },
  streak_5:      { kind: 'fighter', label: 'Unstoppable',   description: 'Won 5 fights in a row',                            icon: 'Lightning' },
  upset:         { kind: 'fighter', label: 'Giant Killer',  description: 'Beat an opponent rated 100+ Elo higher',           icon: 'TrendUp' },
  shutout:       { kind: 'fighter', label: 'Shutout',       description: 'Won without the opponent scoring a point',         icon: 'ShieldCheck' },
  iron_man:      { kind: 'fighter', label: 'Iron Man',      description: 'Fought 10 fights',                                 icon: 'Barbell' },
  belt_holder:   { kind: 'fighter', label: 'Belt Holder',   description: 'Held the title belt',                              icon: 'Crown' },
  sharp_eye:     { kind: 'user',    label: 'Sharp Eye',     description: 'Picked the winner 5 fights in a row',              icon: 'Eye' },
  high_roller:   { kind: 'user',    label: 'Bold Pick',     description: 'Won a pick of 400+ points',                        icon: 'Trophy' },
  perfect_night: { kind: 'user',    label: 'Perfect Night', description: 'Picked every winner on a fight night (2+ fights)', icon: 'Target' },
  comeback:      { kind: 'user',    label: 'Comeback Kid',  description: 'Climbed from under 50 points back to 1000+',       icon: 'ArrowFatLinesUp' },
}

// ---------------------------------------------------------------------------
// Wave B — B7 seasons
// ---------------------------------------------------------------------------
export const END_SEASON_CONFIRM = 'END SEASON'
export interface SeasonSnapshot {
  season: { id: number; name: string; started_at: string; ended_at: string }
  champion: { fighter_id: string; nickname: string; source: 'belt' | 'elo'; elo: number
              season_wins: number; season_losses: number } | null
  top_bettor: { user_id: string; username: string; display_name: string; balance: number; rank: number } | null
  fighters: { fighter_id: string; nickname: string; elo: number; season_wins: number; season_losses: number
              wins: number; losses: number; streak: number; is_champion: boolean; rank: number | null }[]
  bettors: { user_id: string; username: string; display_name: string; balance: number; rank: number }[]
}
/** Table `seasons`. ended_at null = current season (exactly one). */
export interface Season {
  id: number; name: string; started_at: string; ended_at: string | null
  champion_fighter_id: string | null; top_bettor_user_id: string | null
  snapshot: SeasonSnapshot | null; ended_by: string | null
}
/** admin_end_season() result. */
export interface EndSeasonResult {
  ended_season_id: number; ended_season_name: string
  next_season_id: number; next_season_name: string
  champion_fighter_id: string | null; champion_source: 'belt' | 'elo' | null
  top_bettor_user_id: string | null; members_reset: number; points_delta: number
}

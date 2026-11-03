// Row types for the Supabase schema (supabase/migrations). Owned by the db agent.
export type Side = 'red' | 'blue'
export type FightStatus = 'scheduled' | 'open' | 'locked' | 'settled' | 'cancelled'
export type WinMethod = 'pin' | 'submission' | 'decision'
export type CancelKind = 'cancelled' | 'no_contest' | 'declined'
export type BetStatus = 'active' | 'cancelled' | 'won' | 'lost' | 'refunded'
/** C2: 'referee' = member + live scoring (admin_live_update / referee screen) only. */
export type Role = 'member' | 'admin' | 'referee'
export type LedgerReason =
  | 'signup' | 'weekly' | 'topup' | 'bet' | 'bet_cancel' | 'payout' | 'refund' | 'admin_adjust'
  | 'payout_reversal' | 'season_reset'
  // C6 shop: purchase / custom title request (negative), rejected title request refund (positive)
  | 'shop' | 'shop_refund'
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
  | 'fight_of_the_night'
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
  fight_of_the_night: { kind: 'fighter', label: 'Fight of the Night', description: 'Fans voted their bout Fight of the Night', icon: 'Star' },
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

// ---------------------------------------------------------------------------
// Wave C — C1 lockdown
// ---------------------------------------------------------------------------
/** public_site_status() (anon + members). message is null whenever lockdown is off. */
export interface SiteStatus { lockdown: boolean; message: string | null }
/** Table `site_settings` (singleton id = 1, realtime). */
export interface SiteSettings {
  id: 1; lockdown: boolean; lockdown_message: string | null; updated_at: string; updated_by: string | null
}
/** admin_set_lockdown(p_on, p_message) result. */
export interface SetLockdownResult { lockdown: boolean; message: string | null; updated_at: string }

// ---------------------------------------------------------------------------
// Wave C — C3 recap / C4 Fight of the Night
// ---------------------------------------------------------------------------
export type FotnStatus = 'not_ready' | 'open' | 'closed'
/** get_fotn(p_card_date) and cast_fotn_vote(p_fight_id) result. counts/total/winner only once closed. */
export interface FotnState {
  card_date: string
  status: FotnStatus
  open: boolean
  /** When the card became complete = its last settle or cancellation (window start); null until complete. */
  opens_at: string | null
  /** opens_at + 24h. */
  closes_at: string | null
  my_vote: string | null
  /** Settled fight ids of the card, bout order. */
  candidates: string[]
  winner_fight_id: string | null
  counts: { fight_id: string; votes: number }[] | null
  total_votes: number | null
}
/** Table `fotn_votes` (own row only). */
export interface FotnVote { card_date: string; user_id: string; fight_id: string; created_at: string; updated_at: string }
/** Table `fotn_results` (one row per closed card). */
export interface FotnResult {
  card_date: string; winner_fight_id: string | null; counts: { fight_id: string; votes: number }[]
  total_votes: number; closes_at: string; finalized_at: string
}
export interface CardRecapCorner {
  fighter_id: string
  /** null = hidden fighter (non-admins): render "Fighter". */
  nickname: string | null
  /** Fight snapshot weight, else current weight. */
  kg: number | null
  score: number | null
}
export interface CardRecapFight {
  fight_id: string; bout_order: number; is_main_event: boolean; is_title_fight: boolean
  title: string | null; status: FightStatus; cancel_kind: CancelKind | null
  winner_side: Side | null; method: WinMethod | null; finish_move: string | null
  rounds: number | null; settled_at: string | null
  is_fotn: boolean
  red: CardRecapCorner; blue: CardRecapCorner
}
/** get_card_recap(p_card_date) result. */
export interface CardRecap {
  card_date: string
  /** No scheduled/open/locked fight left (and the card has fights). */
  complete: boolean
  settled_count: number
  /** Belt holder at the card's last settle (current holder if nothing is settled yet); null = vacant or hidden. */
  champion: { fighter_id: string; nickname: string } | null
  fotn: { status: FotnStatus; closes_at: string | null; winner_fight_id: string | null }
  fights: CardRecapFight[]
}

// ---------------------------------------------------------------------------
// Wave C — C5 callouts
// ---------------------------------------------------------------------------
export type CalloutStatus = 'pending' | 'accepted' | 'declined' | 'approved' | 'rejected' | 'booked'
export const CALLOUT_MESSAGE_MAX = 140
/** Table `callouts` (members, realtime). */
export interface Callout {
  id: string
  challenger_fighter_id: string
  target_fighter_id: string
  message: string | null
  status: CalloutStatus
  /** Settled fight this is a rematch of. */
  rematch_of: string | null
  /** Fight created by admin_book_callout. */
  fight_id: string | null
  created_by: string | null
  created_at: string
  responded_at: string | null
  responded_by: string | null
  decided_at: string | null
  decided_by: string | null
  decision_note: string | null
}
/** View `callout_board`. is_open = pending | accepted | approved. */
export interface CalloutBoardRow {
  id: string; status: CalloutStatus; message: string | null
  challenger_fighter_id: string; challenger_nickname: string
  target_fighter_id: string; target_nickname: string
  rematch_of: string | null; fight_id: string | null; created_by: string | null
  created_at: string; responded_at: string | null; decided_at: string | null
  decision_note: string | null; is_open: boolean
}
/** admin_approve_callout() result: prefill for the create-fight form (red = challenger). */
export interface CalloutPrefill {
  callout_id: string
  red_fighter_id: string; blue_fighter_id: string
  red_nickname: string; blue_nickname: string
  red_weight_kg: number | null; blue_weight_kg: number | null
  title: string
  rematch_of: string | null
}

// ---------------------------------------------------------------------------
// Wave C — C6 shop (fun points, cosmetic only)
// ---------------------------------------------------------------------------
export const SHOP_DISCLAIMER = 'Fun points — no cash value. Items are cosmetic.'
export type ShopKind = 'name_color' | 'frame' | 'title'
export type ShopItemCode =
  | 'color_gold' | 'color_crimson' | 'color_ice_blue' | 'color_neon_green'
  | 'frame_flame' | 'frame_chain' | 'frame_crown'
  | 'title_custom' | 'title_the_butcher' | 'title_iron_grip' | 'title_mat_rat'
/** Code bought through request_title() instead of buy_item(). */
export const CUSTOM_TITLE_CODE = 'title_custom'
export const CUSTOM_TITLE_MAX = 24
/** Allowed custom title characters (server check, after trim + collapsing spaces). */
export const CUSTOM_TITLE_RE = /^[A-Za-z0-9 '.,!?&-]{1,24}$/
/** Table `shop_items`. value = token key for name_color/frame (frontend maps it), text for titles. */
export interface ShopItem {
  code: ShopItemCode; kind: ShopKind; label: string; value: string | null
  price: number; active: boolean; sort: number
}
/** Table `user_items` (own rows; others' rows only when equipped). */
export interface UserItem {
  user_id: string; code: ShopItemCode; kind: ShopKind
  /** Approved custom title text (code title_custom). */
  custom_value: string | null
  purchased_at: string; equipped: boolean; equipped_at: string | null
}
export type TitleRequestStatus = 'pending' | 'approved' | 'rejected'
/** Table `title_requests` (own rows + admins). */
export interface TitleRequest {
  id: string; user_id: string; title: string; price: number; status: TitleRequestStatus
  created_at: string; decided_at: string | null; decided_by: string | null; decision_note: string | null
}
/** View `member_cosmetics`: one row per active member wearing at least one item. */
export interface MemberCosmetics {
  user_id: string
  name_color: string | null
  frame: string | null
  title: string | null
  name_color_code: ShopItemCode | null
  frame_code: ShopItemCode | null
  title_code: ShopItemCode | null
}
/** buy_item() result. */
export interface BuyItemResult { code: ShopItemCode; kind: ShopKind; price: number; balance: number }

// ---------------------------------------------------------------------------
// Wave C — C7 Hall of Fame
// ---------------------------------------------------------------------------
export interface HofFighterRecord { rank: number; fighter_id: string; nickname: string; value: number }
export interface HofUpsetRecord {
  rank: number; fight_id: string; card_date: string; settled_at: string
  /** Elo gap (loser before − winner before). */
  value: number
  winner_fighter_id: string; winner_nickname: string; winner_elo_before: number
  loser_fighter_id: string; loser_nickname: string; loser_elo_before: number
}
export interface HofPeakRecord { rank: number; user_id: string; display_name: string; value: number; at: string }
/** hall_of_fame() result. Record lists are the top 3 (ties share a rank). */
export interface HallOfFame {
  generated_at: string
  champions: {
    reign_id: string; fighter_id: string; nickname: string; started_at: string; ended_at: string | null
    end_reason: BeltEndReason | null; defenses: number; is_current: boolean; won_fight_id: string | null
  }[]
  season_champions: {
    season_id: number; name: string; started_at: string; ended_at: string
    champion_fighter_id: string | null; champion_nickname: string | null; champion_source: 'belt' | 'elo' | null
    top_bettor_user_id: string | null; top_bettor_display_name: string | null; top_bettor_balance: number | null
  }[]
  records: {
    longest_win_streak: HofFighterRecord[]
    most_wins: HofFighterRecord[]
    most_rounds: HofFighterRecord[]
    most_fotn: HofFighterRecord[]
    biggest_upset: HofUpsetRecord[]
    top_bettor_peak: HofPeakRecord[]
  }
}

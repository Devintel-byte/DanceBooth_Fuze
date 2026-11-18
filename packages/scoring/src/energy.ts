import type { MoveResult } from './scorer';
import type { ScoringConfig } from './judge';

/**
 * FUZE energy meter. Players fill one shared meter (0..100 %) by copying the
 * moves: every judged move adds voltage in proportion to how accurately it
 * was copied. A miss, standing still, moving at random or being out of view
 * adds nothing, and the meter never drains.
 *
 * `fullChargeShare` sets how much of a song's judged moves, all matched,
 * fill the meter: 0.75 means a dancer matching every move is full about two
 * thirds of the way through, and a looser but genuine follower by the end.
 * Duo: both players feed the same meter, each with half the weight, so the
 * meter fills fastest when both dance.
 */
export interface EnergyConfig {
  fullChargeShare: number;
}

export const DEFAULT_ENERGY: EnergyConfig = { fullChargeShare: 0.75 };

/** Relative voltage for one judged move (0..1.2): close matches give some, clean matches more, the cleanest the most. */
export function moveVoltage(r: Pick<MoveResult, 'valid' | 'feedback' | 'combined'>, c: Pick<ScoringConfig, 'matchAt' | 'closeAt'>): number {
  if (!r.valid) return 0;
  if (r.feedback === 'perfect' || r.feedback === 'great') {
    // matchAt -> 0.85, a flawless move -> 1.2
    return 0.85 + 0.35 * Math.min(1, Math.max(0, (r.combined - c.matchAt) / Math.max(1e-6, 1 - c.matchAt)));
  }
  if (r.feedback === 'good') {
    // closeAt -> 0.35, just below a match -> 0.7
    return 0.35 + 0.35 * Math.min(1, Math.max(0, (r.combined - c.closeAt) / Math.max(1e-6, c.matchAt - c.closeAt)));
  }
  return 0;
}

export interface EnergyGain {
  slot: 1 | 2;
  /** Percent added to the meter by this move. */
  percent: number;
  moveTimeSec: number;
}

export interface EnergySummary {
  /** 0..100, rounded down to a whole percent. */
  percent: number;
  /** Song time the meter reached 100 %, or null. */
  fullAtSec: number | null;
  /** Share each player added, in percent of the meter. */
  contributed: Partial<Record<1 | 2, number>>;
}

export class EnergyMeter {
  private level = 0;
  private full: number | null = null;
  private readonly contributed: Partial<Record<1 | 2, number>> = {};
  private readonly unit: number;

  /**
   * @param judgeableMoves moves one player is judged on in this dance (the same for every player)
   * @param players 1 for solo, 2 for duo (each player's voltage then counts half)
   */
  constructor(
    judgeableMoves: number,
    private readonly players: 1 | 2,
    private readonly scoring: Pick<ScoringConfig, 'matchAt' | 'closeAt'>,
    config: EnergyConfig = DEFAULT_ENERGY,
  ) {
    const movesToFull = Math.max(1, judgeableMoves * config.fullChargeShare);
    this.unit = 100 / movesToFull / players;
  }

  /** Adds a judged move; returns what it added (0 when nothing). */
  add(slot: 1 | 2, r: MoveResult): EnergyGain {
    const raw = moveVoltage(r, this.scoring) * this.unit;
    const added = Math.max(0, Math.min(100 - this.level, raw));
    this.level += added;
    this.contributed[slot] = (this.contributed[slot] ?? 0) + added;
    if (this.full === null && this.level >= 100 - 1e-9) {
      this.level = 100;
      // The move that tipped it over completed when its window closed; credit the move time.
      this.full = r.moveTimeSec;
    }
    return { slot, percent: added, moveTimeSec: r.moveTimeSec };
  }

  /** 0..1, for the stage and the meter. */
  get fraction(): number {
    return this.level / 100;
  }

  get isFull(): boolean {
    return this.full !== null;
  }

  summary(): EnergySummary {
    return { percent: Math.floor(this.level + 1e-9), fullAtSec: this.full, contributed: { ...this.contributed } };
  }
}

/**
 * Whole-number score for leaderboards and the main leaderboard feed (higher is
 * better): a full meter scores 1000 plus 10 per second of song left when it
 * filled, so the fastest charge ranks first; otherwise 10 per percent.
 */
export function energyPoints(s: EnergySummary, songDurationSec: number): number {
  if (s.fullAtSec !== null) return 1000 + Math.max(0, Math.round((songDurationSec - s.fullAtSec) * 10));
  return Math.max(0, Math.min(99, s.percent)) * 10;
}

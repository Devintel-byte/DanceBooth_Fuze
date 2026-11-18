import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_PRESETS } from './judge';
import { PlayerScorer, type MoveResult, type ScorableRoutine } from './scorer';
import { perform, type PerformerKind } from './fairness';
import { EnergyMeter, energyPoints, moveVoltage } from './energy';

const c = DIFFICULTY_PRESETS.easy;
const move = (feedback: MoveResult['feedback'], combined: number, t = 10): MoveResult => ({
  moveIndex: 0, moveTimeSec: t, valid: feedback !== 'no-read', poseQuality: combined, timingQuality: 1, timingOffsetSec: 0, combined, points: 0, feedback, evidence: 1, breakdown: [],
});

describe('energy meter', () => {
  it('charges more for more accurate moves, nothing for misses or unreadable moves', () => {
    expect(moveVoltage(move('miss', 0.4), c)).toBe(0);
    expect(moveVoltage(move('no-read', 0), c)).toBe(0);
    const close = moveVoltage(move('good', c.closeAt), c);
    const better = moveVoltage(move('good', (c.closeAt + c.matchAt) / 2), c);
    const match = moveVoltage(move('perfect', c.matchAt), c);
    const flawless = moveVoltage(move('perfect', 1), c);
    expect(close).toBeGreaterThan(0);
    expect(better).toBeGreaterThan(close);
    expect(match).toBeGreaterThan(better);
    expect(flawless).toBeGreaterThan(match);
  });

  it('fills to exactly 100 %, records when, and never drains', () => {
    const m = new EnergyMeter(20, 1, c);
    let t = 0;
    while (!m.isFull && t < 100) m.add(1, move('perfect', 1, (t += 1)));
    expect(m.summary().percent).toBe(100);
    const at = m.summary().fullAtSec!;
    expect(at).toBeGreaterThan(5);
    m.add(1, move('miss', 0, 99));
    m.add(1, move('perfect', 1, 100));
    expect(m.summary()).toMatchObject({ percent: 100, fullAtSec: at });
  });

  it('duo: one shared meter, each player counts half, so it fills fastest when both dance', () => {
    const both = new EnergyMeter(20, 2, c);
    const one = new EnergyMeter(20, 2, c);
    for (let i = 0; i < 6; i++) {
      both.add(1, move('perfect', 0.9, i));
      both.add(2, move('perfect', 0.9, i));
      one.add(1, move('perfect', 0.9, i));
      one.add(2, move('miss', 0.2, i));
    }
    expect(both.fraction).toBeCloseTo(one.fraction * 2, 5);
    expect(both.summary().contributed[1]).toBeCloseTo(both.summary().contributed[2]!, 5);
  });

  it('ranks a full meter above any partial one, and a faster charge above a slower one', () => {
    const fast = energyPoints({ percent: 100, fullAtSec: 25, contributed: {} }, 45);
    const slow = energyPoints({ percent: 100, fullAtSec: 40, contributed: {} }, 45);
    const almost = energyPoints({ percent: 99, fullAtSec: null, contributed: {} }, 45);
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(almost);
    expect(energyPoints({ percent: 0, fullAtSec: null, contributed: {} }, 45)).toBe(0);
    for (const p of [fast, slow, almost]) expect(Number.isInteger(p)).toBe(true);
  });
});

describe('energy on the bundled songs (simulated players, easy)', () => {
  const dir = path.resolve(__dirname, '../../../assets/routines');
  const routines = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'dev-groove.json')
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as ScorableRoutine & { durationSec: number; bpm?: number; variations?: { moves: unknown }[] });
  const run = (kind: PerformerKind) => {
    const out: { percent: number; at: number | null }[] = [];
    routines.forEach((r0, ri) => {
      for (const dance of [r0, ...(r0.variations ?? []).slice(0, 2).map((x) => ({ ...r0, moves: x.moves as ScorableRoutine['moves'] }))]) {
        const p = perform(kind, dance, { seed: 131 + ri, durationSec: r0.durationSec, bpm: r0.bpm, other: routines[(ri + 3) % routines.length] });
        const sc = new PlayerScorer(dance, c);
        const m = new EnergyMeter(sc.judgeableMoves, 1, c);
        p.frames.forEach((f, i) => {
          sc.addSample(i, f.songTimeSec, f.pose, f.alt);
          for (const r of sc.advance(f.songTimeSec)) m.add(1, r);
        });
        for (const r of sc.finish()) m.add(1, r);
        const s = m.summary();
        out.push({ percent: s.percent, at: s.fullAtSec === null ? null : s.fullAtSec / r0.durationSec });
      }
    });
    return out;
  };

  it('players who follow the dancer power the stage, well before the song ends', () => {
    for (const kind of ['expert', 'good', 'late', 'sameside'] as const) {
      for (const r of run(kind)) {
        expect(r.percent, kind).toBe(100);
        expect(r.at!, kind).toBeLessThan(0.85);
      }
    }
  });

  it('standing still, moving at random or half-heartedly never powers it', () => {
    for (const kind of ['still', 'bobber', 'flailer', 'sloppy', 'wrong'] as const) {
      const rs = run(kind);
      expect(rs.every((r) => r.at === null), kind).toBe(true);
      expect(rs.reduce((a, r) => a + r.percent, 0) / rs.length, kind).toBeLessThan(kind === 'wrong' ? 40 : 25);
    }
    expect(run('still').every((r) => r.percent === 0)).toBe(true);
  });
});

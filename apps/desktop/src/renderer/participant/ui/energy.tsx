import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoutineManifest, SegmentName } from '@booth/contracts';
import type { BoothRuntime, EnergyView } from '../runtime/runtime';

type Pose = Partial<Record<SegmentName, readonly [number, number]>>;

const MILESTONES = [25, 50, 75];

/**
 * The FUZE energy meter: a tall gauge that fills as players copy the moves.
 * Each charging move pulses it and floats "+n%"; milestones light up at
 * 25/50/75 %, and at 100 % it reads "Stage powered".
 */
export function EnergyGauge({ view, label }: { view: EnergyView | null; label: string }) {
  const percent = view?.percent ?? 0;
  const [pops, setPops] = useState<{ id: number; text: string }[]>([]);
  const lastSeq = useRef(0);
  useEffect(() => {
    const g = view?.lastGain;
    if (!g || g.seq === lastSeq.current) return;
    lastSeq.current = g.seq;
    const id = g.seq;
    const text = `+${Math.max(1, Math.round(g.percent))}%`;
    setPops((p) => [...p.slice(-3), { id, text }]);
    const t = window.setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1100);
    return () => window.clearTimeout(t);
  }, [view?.lastGain]);
  const full = !!view?.full;
  return (
    <div className={`energy-gauge ${full ? 'is-full' : ''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span className="energy-label">{label}</span>
      <div className="energy-tube">
        <div className="energy-fill" style={{ height: `${percent}%` }} />
        {view?.lastGain && <span key={view.lastGain.seq} className="energy-flash" />}
        {MILESTONES.map((m) => (
          <span key={m} className={`energy-tick ${percent >= m ? 'is-on' : ''}`} style={{ bottom: `${m}%` }} />
        ))}
        {pops.map((p) => (
          <span key={p.id} className="energy-pop tabular" style={{ bottom: `${Math.min(92, percent)}%` }}>
            {p.text}
          </span>
        ))}
      </div>
      <span className="energy-percent tabular">{percent}%</span>
      {full && <span className="energy-full">Stage powered!</span>}
    </div>
  );
}

// Proportions of the move figures (torso = 1).
const L = { torso: 1, upper: 0.62, fore: 0.56, thigh: 0.86, shin: 0.82 };

function dir(p: Pose, seg: SegmentName, fallback: readonly [number, number]): [number, number] {
  const v = p[seg] ?? fallback;
  const n = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / n, v[1] / n];
}

/** A stick figure of a judged pose (display space, y up), as an SVG path. */
export function poseFigure(p: Pose): { limbs: string; head: [number, number] } {
  const add = (a: [number, number], d: [number, number], l: number): [number, number] => [a[0] + d[0] * l, a[1] + d[1] * l];
  const hip: [number, number] = [0, 0];
  const torso = dir(p, 'torso', [0, 1]);
  const neck = add(hip, torso, L.torso);
  const side: [number, number] = [torso[1], -torso[0]]; // perpendicular, to the figure's left (screen right)
  const sh = (s: number): [number, number] => [neck[0] + side[0] * 0.3 * s, neck[1] + side[1] * 0.3 * s];
  const hp = (s: number): [number, number] => [hip[0] + side[0] * 0.18 * s, hip[1] + side[1] * 0.18 * s];
  const lS = sh(1), rS = sh(-1), lH = hp(1), rH = hp(-1);
  const lE = add(lS, dir(p, 'leftUpperArm', [0.12, -1]), L.upper);
  const lW = add(lE, dir(p, 'leftForearm', [0.06, -1]), L.fore);
  const rE = add(rS, dir(p, 'rightUpperArm', [-0.12, -1]), L.upper);
  const rW = add(rE, dir(p, 'rightForearm', [-0.06, -1]), L.fore);
  const lK = add(lH, dir(p, 'leftThigh', [0.03, -1]), L.thigh);
  const lF = add(lK, dir(p, 'leftShin', [0, -1]), L.shin);
  const rK = add(rH, dir(p, 'rightThigh', [-0.03, -1]), L.thigh);
  const rF = add(rK, dir(p, 'rightShin', [0, -1]), L.shin);
  // SVG: y down, so flip.
  const pt = (a: [number, number]) => `${(a[0] * 40).toFixed(1)},${(-a[1] * 40).toFixed(1)}`;
  const line = (...ps: [number, number][]) => `M${ps.map(pt).join(' L')}`;
  const limbs = [line(hip, neck), line(lS, rS), line(lH, rH), line(lS, lE, lW), line(rS, rE, rW), line(lH, lK, lF), line(rH, rK, rF)].join(' ');
  const headC = add(neck, torso, 0.38);
  return { limbs, head: [headC[0] * 40, -headC[1] * 40] };
}

function MoveFigure({ pose }: { pose: Pose }) {
  const f = useMemo(() => poseFigure(pose), [pose]);
  return (
    <svg className="move-figure" viewBox="-90 -100 180 180" aria-hidden="true">
      <path d={f.limbs} />
      <circle cx={f.head[0]} cy={f.head[1]} r={13} />
    </svg>
  );
}

/** Seconds of upcoming moves shown, and how far ahead the strip looks. */
const AHEAD_SEC = 4.2;
const BEHIND_SEC = 0.6;
const LIT_SEC = 0.45;

/**
 * The illuminated move sequence: upcoming moves glide towards the marker and
 * light up when it is time to hit them. Drawn from the same poses the booth
 * judges, so what is shown is what is scored.
 */
export function MoveStrip({ routine, runtime }: { routine: RoutineManifest | null; runtime: BoothRuntime }) {
  const moves = useMemo(() => (routine?.moves ?? []).filter((m) => m.judged !== false), [routine]);
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setT(runtime.frame.songTimeSec);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime]);
  const visible = moves.filter((m) => m.timeSec > t - BEHIND_SEC && m.timeSec < t + AHEAD_SEC);
  return (
    <div className="move-strip" aria-hidden="true">
      <span className="move-marker" />
      {visible.map((m) => {
        const dt = m.timeSec - t;
        const lit = Math.abs(dt) <= LIT_SEC;
        // 0 at the marker (left), 1 at the far end.
        const x = Math.max(-0.12, dt / AHEAD_SEC);
        return (
          <div
            key={m.timeSec}
            className={`move-card ${lit ? 'is-lit' : dt < 0 ? 'is-past' : ''}`}
            style={{ left: `calc(var(--strip-pad) + ${x} * (100% - 2 * var(--strip-pad)))`, opacity: dt < 0 ? Math.max(0, 1 + dt / BEHIND_SEC) : Math.min(1, (AHEAD_SEC - dt) / 0.8) }}
          >
            <MoveFigure pose={m.pose} />
          </div>
        );
      })}
    </div>
  );
}

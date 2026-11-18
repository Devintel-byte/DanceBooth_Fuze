import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { QualityPreset } from '@booth/contracts';

/**
 * The FUZE festival stage, powered by the players. It reads the shared energy
 * meter (0..1) every frame and comes alive in steps:
 *
 * - 0 %: a dark stage; only a work light on the dancers and the dim screen.
 * - 25 %: LED edge strips, the truss outline and the floor grid glow.
 * - 50 %: par cans on the truss pulse to the beat.
 * - 75 %: the LED screen animates and moving-head beams sweep.
 * - 100 %: the full show: lasers, beat strobes, colour cycling, confetti
 *   cannons and spark fountains (the dancers celebrate via the runtime).
 *
 * The two power towers either side always show the meter's level. Light
 * counts never change at runtime (no shader recompiles): everything that
 * switches on is an unlit, additive mesh faded by opacity. Quality presets
 * scale particle and beam counts; reduced motion freezes sweeps and drops
 * the strobe.
 *
 * Branding is the event name drawn as text on the screen and the event
 * colours; no logo is placed in the scene.
 */
export interface FuzeColors {
  primary: string;
  primaryDark: string;
  energy: string;
  energyLight: string;
  background: string;
  panel: string;
}

export interface FuzeStageProps {
  layout: 'solo' | 'duo';
  quality: QualityPreset;
  reducedMotion: boolean;
  dancers: number[];
  beatPhase: () => number;
  /** Meter level, 0..1. */
  energy: () => number;
  colors: FuzeColors;
  /** Text shown on the LED screen (the event name). */
  title: string;
  displayFont: string;
}

/** Thresholds of the power levels. */
export const POWER_LEVELS = [0.25, 0.5, 0.75, 1] as const;

const BUDGET: Record<QualityPreset, { beams: number; confetti: number; sparks: number; lasers: number }> = {
  low: { beams: 4, confetti: 160, sparks: 40, lasers: 4 },
  medium: { beams: 6, confetti: 420, sparks: 70, lasers: 6 },
  high: { beams: 8, confetti: 800, sparks: 110, lasers: 8 },
};

/** Shared per-frame state, written by <Driver> before the other parts read it. */
interface Live {
  t: number;
  level: number;
  /** Smoothed 0..1 for each power level. */
  tiers: [number, number, number, number];
  /** 1 on the beat, decaying to 0. */
  pulse: number;
  /** Clock time the meter became full (-1: not full). */
  fullAt: number;
  /** Incremented on each beat (beat phase wrapped). */
  beat: number;
  lastPhase: number;
}

function Driver({ live, energy, beatPhase, reducedMotion }: { live: Live; energy: () => number; beatPhase: () => number; reducedMotion: boolean }) {
  useFrame((state, dt) => {
    const L = Math.min(1, Math.max(0, energy()));
    live.t = state.clock.elapsedTime;
    live.level += (L - live.level) * (1 - Math.pow(0.004, dt));
    const k = 1 - Math.pow(0.03, dt);
    for (let i = 0; i < 4; i++) {
      const on = L >= POWER_LEVELS[i]! - 1e-6 ? 1 : 0;
      live.tiers[i] = reducedMotion ? on : live.tiers[i]! + (on - live.tiers[i]!) * k;
    }
    if (L >= 1 - 1e-6) {
      if (live.fullAt < 0) live.fullAt = live.t;
    } else live.fullAt = -1;
    const ph = beatPhase();
    if (ph < live.lastPhase - 0.5) live.beat++;
    live.lastPhase = ph;
    live.pulse = reducedMotion ? 0.3 : Math.pow(1 - ph, 2);
  });
  return null;
}

function canvasTex(c: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** The event name, white on transparent, for the LED screen. */
function wordmark(title: string, font: string): THREE.CanvasTexture {
  const [c, g] = makeCanvas(2048, 716);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 250;
  g.font = `800 ${size}px "${font}", system-ui, sans-serif`;
  const w = g.measureText(title).width;
  if (w > 1300) size = Math.floor((size * 1300) / w);
  g.font = `800 ${size}px "${font}", system-ui, sans-serif`;
  g.fillText(title.toUpperCase(), 1024, 380);
  const t = canvasTex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** LED floor tiles: thin bright grid lines on black (used as an emissive map). */
function floorGrid(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#fff';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 253);
  const r = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  r.addColorStop(0, 'rgba(255,255,255,0.14)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  return canvasTex(c, [9, 5]);
}

/** Vertical fade, bright at the top (beam source). */
function beamFade(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(4, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#fff');
  gr.addColorStop(0.5, '#555');
  gr.addColorStop(1, '#000');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  return canvasTex(c);
}

function softDot(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return canvasTex(c);
}

const additive = (color: string, opacity = 0, map?: THREE.Texture) =>
  new THREE.MeshBasicMaterial({ color, ...(map ? { map } : {}), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });

// ---------------------------------------------------------------- LED screen

const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const SCREEN_FRAG = /* glsl */ `
uniform float uTime, uLevel, uT1, uT3, uFull, uPulse;
uniform vec3 uA, uB, uC;
uniform sampler2D uMark;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 g = fract(uv * vec2(180.0, 72.0));
  float px = smoothstep(0.0, 0.18, g.x) * smoothstep(1.0, 0.82, g.x) * smoothstep(0.0, 0.18, g.y) * smoothstep(1.0, 0.82, g.y);
  vec3 col = vec3(0.012, 0.014, 0.03);
  // The charge rising from the bottom of the screen.
  float edge = smoothstep(uLevel + 0.01, uLevel - 0.01, uv.y);
  col += mix(uA, uB, uv.y) * (0.06 + 0.1 * uT1) * edge;
  col += uB * 0.35 * smoothstep(0.012, 0.0, abs(uv.y - uLevel)) * step(0.001, uLevel) * (1.0 - uFull);
  // 75 %: sweeping bars and rings on the beat.
  vec2 c = (uv - 0.5) * vec2(2.5, 1.0);
  float bars = 0.5 + 0.5 * sin(uv.x * 14.0 - uTime * 2.2 + sin(uv.y * 6.0 + uTime) * 1.6);
  float rings = 0.5 + 0.5 * sin(length(c) * 16.0 - uTime * 5.0);
  vec3 pat = mix(uA, uB, bars) * (0.3 + 0.7 * rings * (0.4 + 0.6 * uPulse));
  col = mix(col, pat * 0.85, uT3 * 0.8);
  // 100 %: colour-cycling plasma.
  float pl = sin(c.x * 4.0 + uTime * 1.7) + sin(c.y * 5.0 - uTime * 1.3) + sin(length(c) * 6.0 - uTime * 2.0);
  vec3 cyc = 0.5 + 0.5 * cos(6.2831 * (pl * 0.15 + uTime * 0.12 + vec3(0.0, 0.33, 0.67)));
  col = mix(col, mix(cyc, uC, 0.3) * (0.8 + 0.4 * uPulse), uFull * 0.85);
  // Event name.
  float m = texture2D(uMark, uv).a;
  vec3 markCol = mix(vec3(0.35), vec3(1.0), clamp(uLevel * 1.2, 0.0, 1.0)) + uC * 0.15 * uT1;
  col = mix(col, markCol, m * (0.55 + 0.45 * uLevel));
  col *= mix(0.78, 1.0, px);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function LedScreen({ live, colors, title, font }: { live: Live; colors: FuzeColors; title: string; font: string }) {
  const mark = useMemo(() => wordmark(title, font), [title, font]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SCREEN_VERT,
        fragmentShader: SCREEN_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uLevel: { value: 0 },
          uT1: { value: 0 },
          uT3: { value: 0 },
          uFull: { value: 0 },
          uPulse: { value: 0 },
          uA: { value: new THREE.Color(colors.primary) },
          uB: { value: new THREE.Color(colors.energy) },
          uC: { value: new THREE.Color(colors.energyLight) },
          uMark: { value: mark },
        },
        toneMapped: false,
      }),
    [mark, colors.primary, colors.energy, colors.energyLight],
  );
  useEffect(() => () => {
    mat.dispose();
    mark.dispose();
  }, [mat, mark]);
  useFrame(() => {
    const u = mat.uniforms;
    u.uTime!.value = live.t;
    u.uLevel!.value = live.level;
    u.uT1!.value = live.tiers[0];
    u.uT3!.value = live.tiers[2];
    u.uFull!.value = live.tiers[3];
    u.uPulse!.value = live.pulse;
  });
  return (
    <group position={[0, 2.45, -3]}>
      <mesh position={[0, 0, -0.06]}>
        <boxGeometry args={[8.4, 3.1, 0.1]} />
        <meshStandardMaterial color="#07080d" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh material={mat}>
        <planeGeometry args={[8.0, 2.8]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- structure

/** An unlit strip that fades in with a power level. */
function GlowStrip({ live, tier, color, pos, size, base = 0.08 }: { live: Live; tier: number; color: string; pos: [number, number, number]; size: [number, number, number]; base?: number }) {
  const mat = useMemo(() => additive(color, base), [color, base]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const on = live.tiers[tier]!;
    const full = live.tiers[3];
    mat.opacity = base + on * (0.85 - base) + full * live.pulse * 0.15;
  });
  return (
    <mesh position={pos} material={mat}>
      <boxGeometry args={size} />
    </mesh>
  );
}

/** Power towers either side of the stage: they fill with the meter. */
function PowerTower({ live, x, colors }: { live: Live; x: number; colors: FuzeColors }) {
  const H = 4.2;
  const fill = useRef<THREE.Mesh>(null);
  const fillMat = useMemo(() => new THREE.MeshBasicMaterial({ color: colors.energy, toneMapped: false }), [colors.energy]);
  const capMat = useMemo(() => additive(colors.energyLight, 0), [colors.energyLight]);
  useEffect(() => () => [fillMat, capMat].forEach((m) => m.dispose()), [fillMat, capMat]);
  useFrame(() => {
    const L = Math.max(0.002, live.level);
    if (fill.current) {
      fill.current.scale.y = L;
      fill.current.position.y = (H * L) / 2;
    }
    fillMat.color.set(colors.energy).lerp(new THREE.Color(colors.energyLight), live.tiers[3] * live.pulse);
    capMat.opacity = live.tiers[3] * (0.4 + 0.6 * live.pulse);
  });
  return (
    <group position={[x, 0, -1.6]}>
      <mesh position={[0, H / 2, 0]}>
        <boxGeometry args={[0.5, H + 0.1, 0.5]} />
        <meshStandardMaterial color="#0b0c14" roughness={0.5} metalness={0.5} transparent opacity={0.9} />
      </mesh>
      <mesh ref={fill} position={[0, 0, 0.26]} material={fillMat}>
        <boxGeometry args={[0.32, H, 0.02]} />
      </mesh>
      {[0.25, 0.5, 0.75].map((m) => (
        <mesh key={m} position={[0, H * m, 0.275]}>
          <boxGeometry args={[0.42, 0.025, 0.01]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.35} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, H + 0.3, 0]} material={capMat}>
        <sphereGeometry args={[0.28, 16, 12]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- lights

/** 50 %: par cans along the truss, pulsing on the beat. */
function ParCans({ live, colors }: { live: Live; colors: FuzeColors }) {
  const xs = [-3.9, -2.35, -0.8, 0.8, 2.35, 3.9];
  const fade = useMemo(() => beamFade(), []);
  const geo = useMemo(() => {
    const g = new THREE.ConeGeometry(1.1, 4.6, 24, 1, true);
    g.translate(0, -2.3, 0);
    return g;
  }, []);
  const mats = useMemo(() => xs.map((_, i) => additive(i % 2 ? colors.energy : colors.primary, 0, fade)), [colors.energy, colors.primary, fade]); // eslint-disable-line react-hooks/exhaustive-deps
  const pools = useMemo(() => xs.map((_, i) => additive(i % 2 ? colors.energy : colors.primary, 0, softDotTex)), [colors.energy, colors.primary]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    [...mats, ...pools].forEach((m) => m.dispose());
    geo.dispose();
    fade.dispose();
  }, [mats, pools, geo, fade]);
  const a = useMemo(() => new THREE.Color(colors.primary), [colors.primary]);
  const b = useMemo(() => new THREE.Color(colors.energy), [colors.energy]);
  useFrame(() => {
    const on = live.tiers[1];
    const full = live.tiers[3];
    mats.forEach((m, i) => {
      const alt = (live.beat + i) % 2 === 0 ? 1 : 0.55;
      m.opacity = on * (0.05 + 0.12 * live.pulse * alt);
      if (full > 0.01) m.color.copy(a).lerp(b, 0.5 + 0.5 * Math.sin(live.t * 2 + i));
      pools[i]!.opacity = on * (0.18 + 0.3 * live.pulse * alt);
      pools[i]!.color.copy(m.color);
    });
  });
  return (
    <group>
      {xs.map((x, i) => (
        <group key={x}>
          <mesh position={[x, 4.75, 0.9]}>
            <cylinderGeometry args={[0.13, 0.17, 0.28, 12]} />
            <meshStandardMaterial color="#14151c" metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh geometry={geo} material={mats[i]} position={[x, 4.6, 0.9]} rotation-x={0.12} />
          <mesh rotation-x={-Math.PI / 2} position={[x * 0.92, 0.015, 0.4]} material={pools[i]}>
            <circleGeometry args={[1.2, 24]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

let softDotCache: THREE.CanvasTexture | null = null;
const softDotTex = (() => {
  // Lazily created on first import use in a browser context.
  if (typeof document === 'undefined') return undefined;
  softDotCache ??= softDot();
  return softDotCache;
})();

/** 75 %: moving-head beams sweeping over the stage and the crowd. */
function MovingBeams({ live, colors, count, reducedMotion }: { live: Live; colors: FuzeColors; count: number; reducedMotion: boolean }) {
  const fade = useMemo(() => beamFade(), []);
  const geo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.32, 9, 16, 1, true);
    g.translate(0, -4.5, 0);
    return g;
  }, []);
  const xs = useMemo(() => Array.from({ length: count }, (_, i) => -4.4 + (8.8 * i) / Math.max(1, count - 1)), [count]);
  const mats = useMemo(() => xs.map((_, i) => additive(i % 2 ? colors.energyLight : colors.primary, 0, fade)), [xs, colors.energyLight, colors.primary, fade]);
  const groups = useRef<(THREE.Group | null)[]>([]);
  useEffect(() => () => {
    mats.forEach((m) => m.dispose());
    geo.dispose();
    fade.dispose();
  }, [mats, geo, fade]);
  useFrame(() => {
    const on = live.tiers[2];
    const full = live.tiers[3];
    const speed = 0.7 + full * 0.9;
    groups.current.forEach((g, i) => {
      if (!g) return;
      const ph = reducedMotion ? 0 : live.t * speed + i * 0.9;
      const side = i < count / 2 ? 1 : -1;
      g.rotation.z = side * 0.25 + Math.sin(ph) * (0.45 + full * 0.2);
      g.rotation.x = -0.55 + Math.sin(ph * 0.7 + i) * 0.25;
      mats[i]!.opacity = on * (0.07 + 0.06 * live.pulse + full * 0.05);
    });
  });
  return (
    <group>
      {xs.map((x, i) => (
        <group key={x} position={[x, 4.95, 0.4]} ref={(g) => { groups.current[i] = g; }}>
          <mesh>
            <boxGeometry args={[0.22, 0.26, 0.22]} />
            <meshStandardMaterial color="#14151c" metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh geometry={geo} material={mats[i]} />
        </group>
      ))}
    </group>
  );
}

/** 100 %: lasers fanning across the stage from both sides of the screen. */
function Lasers({ live, colors, count, reducedMotion, x }: { live: Live; colors: FuzeColors; count: number; reducedMotion: boolean; x: number }) {
  const group = useRef<THREE.Group>(null);
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(0.012, 0.012, 16);
    g.translate(0, 0, 8);
    return g;
  }, []);
  const mats = useMemo(() => Array.from({ length: count }, (_, i) => additive(i % 2 ? colors.energy : colors.energyLight, 0)), [count, colors.energy, colors.energyLight]);
  useEffect(() => () => {
    geo.dispose();
    mats.forEach((m) => m.dispose());
  }, [geo, mats]);
  // Aim inwards and towards the crowd.
  const base = x < 0 ? 0.55 : -0.55;
  useFrame(() => {
    const full = live.tiers[3];
    if (group.current) {
      group.current.visible = full > 0.01;
      group.current.children.forEach((c, i) => {
        const spread = (i / Math.max(1, count - 1) - 0.5) * 0.9;
        c.rotation.y = base + spread + (reducedMotion ? 0 : Math.sin(live.t * 1.3 + i * 0.4) * 0.15);
        c.rotation.x = -0.05 - (reducedMotion ? 0.08 : 0.08 + 0.08 * Math.sin(live.t * 0.9 + i));
      });
    }
    mats.forEach((m, i) => (m.opacity = full * (0.5 + 0.5 * ((live.beat + i) % 3 === 0 ? live.pulse : 0.3))));
  });
  return (
    <group ref={group} position={[x, 1.1, -2.85]} visible={false}>
      {mats.map((m, i) => (
        <mesh key={i} geometry={geo} material={m} />
      ))}
    </group>
  );
}

/** 100 %: a beat-synced white wash (at most one flash per beat, never in reduced motion). */
function Strobe({ live, reducedMotion }: { live: Live; reducedMotion: boolean }) {
  const mat = useMemo(() => additive('#ffffff', 0), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    if (reducedMotion) {
      mat.opacity = 0;
      return;
    }
    // First 4 s after powering up: a flash every beat; then every other beat, softer.
    const since = live.fullAt < 0 ? -1 : live.t - live.fullAt;
    const every = since >= 0 && since < 4 ? 1 : 2;
    const flash = live.beat % every === 0 ? Math.pow(live.pulse, 6) : 0;
    mat.opacity = live.tiers[3] * flash * (since >= 0 && since < 4 ? 0.22 : 0.1);
  });
  return (
    <mesh position={[0, 2.5, -2.2]} material={mat}>
      <planeGeometry args={[16, 7]} />
    </mesh>
  );
}

// ---------------------------------------------------------------- particles

const HIDDEN = new THREE.Vector3(0, -10, 0);

/** 100 %: confetti cannons fire, then confetti keeps raining while the stage is powered. */
function Confetti({ live, colors, count }: { live: Live; colors: FuzeColors; count: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(0.11, 0.065), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), []);
  const parts = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        r: new THREE.Euler(),
        w: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3),
        alive: false,
      })),
    [count],
  );
  const firedAt = useRef(-1);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const palette = [colors.primary, colors.energy, colors.energyLight, '#ffffff', '#ffd84a'].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) m.setColorAt(i, palette[i % palette.length]!);
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [count, colors.primary, colors.energy, colors.energyLight]);
  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);
  useFrame((_, dtRaw) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(0.05, dtRaw);
    const full = live.fullAt >= 0;
    if (full && firedAt.current !== live.fullAt) {
      firedAt.current = live.fullAt;
      // Cannons at both front corners blast upwards and inwards.
      parts.forEach((q, i) => {
        const side = i % 2 ? 1 : -1;
        q.p.set(side * 4.3, 0.4, 1.6);
        q.v.set(-side * (1 + Math.random() * 3.2), 6 + Math.random() * 5, -Math.random() * 2.5);
        q.alive = true;
      });
    }
    m.visible = parts.some((q) => q.alive);
    if (!m.visible) return;
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i]!;
      if (q.alive) {
        q.v.y -= 9.8 * dt * (q.v.y > 0 ? 1 : 0.12); // flutters down slowly
        q.v.multiplyScalar(1 - 0.9 * dt);
        q.v.x += Math.sin(live.t * 3 + i) * 0.3 * dt;
        q.p.addScaledVector(q.v, dt);
        q.r.x += q.w.x * dt;
        q.r.y += q.w.y * dt;
        q.r.z += q.w.z * dt;
        if (q.p.y < 0.02) {
          if (full) {
            // Keep raining from above while the stage is powered.
            q.p.set(Math.random() * 11 - 5.5, 5.5 + Math.random() * 2, Math.random() * 4 - 2);
            q.v.set(0, -0.4, 0);
          } else q.alive = false;
        }
      }
      dummy.position.copy(q.alive ? q.p : HIDDEN);
      dummy.rotation.copy(q.r);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geo, mat, count]} frustumCulled={false} visible={false} />;
}

/** 100 %: spark fountains along the front edge, firing on power-up and every few seconds after. */
function Sparks({ live, colors, perFountain }: { live: Live; colors: FuzeColors; perFountain: number }) {
  const spots = [-4.2, -2.7, 2.7, 4.2];
  const n = spots.length * perFountain;
  const pts = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3).fill(-10), 3));
    return g;
  }, [n]);
  const mat = useMemo(
    () => new THREE.PointsMaterial({ color: colors.energyLight, size: 0.09, map: softDotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [colors.energyLight],
  );
  const state = useMemo(() => Array.from({ length: n }, () => ({ v: new THREE.Vector3(), life: 0 })), [n]);
  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);
  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, dtRaw);
    const since = live.fullAt < 0 ? -1 : live.t - live.fullAt;
    // Fountains run for 2.5 s on power-up, then 1.5 s every 8 s.
    const firing = since >= 0 && (since < 2.5 || since % 8 < 1.5);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    let any = false;
    for (let i = 0; i < n; i++) {
      const s = state[i]!;
      if (s.life <= 0 && firing && Math.random() < dt * 6) {
        const x = spots[Math.floor(i / perFountain)]!;
        arr[i * 3] = x;
        arr[i * 3 + 1] = 0.1;
        arr[i * 3 + 2] = 1.9;
        s.v.set((Math.random() - 0.5) * 0.9, 4.5 + Math.random() * 2.5, (Math.random() - 0.5) * 0.9);
        s.life = 0.7 + Math.random() * 0.6;
      }
      if (s.life > 0) {
        any = true;
        s.life -= dt;
        s.v.y -= 7 * dt;
        arr[i * 3] = arr[i * 3]! + s.v.x * dt;
        arr[i * 3 + 1] = arr[i * 3 + 1]! + s.v.y * dt;
        arr[i * 3 + 2] = arr[i * 3 + 2]! + s.v.z * dt;
        if (s.life <= 0) arr[i * 3 + 1] = -10;
      }
    }
    pos.needsUpdate = true;
    if (pts.current) pts.current.visible = any;
  });
  return <points ref={pts} geometry={geo} material={mat} frustumCulled={false} visible={false} />;
}

// ---------------------------------------------------------------- stage

export function FuzeStage(p: FuzeStageProps) {
  const { colors: c } = p;
  const budget = BUDGET[p.quality];
  const live = useMemo<Live>(() => ({ t: 0, level: 0, tiers: [0, 0, 0, 0], pulse: 0, fullAt: -1, beat: 0, lastPhase: 0 }), []);
  const grid = useMemo(() => floorGrid(), []);
  useEffect(() => () => grid.dispose(), [grid]);

  const floorMat = useRef<THREE.MeshStandardMaterial>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const rimA = useRef<THREE.DirectionalLight>(null);
  const rimB = useRef<THREE.DirectionalLight>(null);
  const primary = useMemo(() => new THREE.Color(c.primary), [c.primary]);
  const energyCol = useMemo(() => new THREE.Color(c.energy), [c.energy]);

  useFrame(() => {
    const L = live.level;
    if (floorMat.current) {
      floorMat.current.emissiveIntensity = 0.05 + live.tiers[0] * 0.5 + live.tiers[3] * live.pulse * 0.6;
      floorMat.current.emissive.copy(primary).lerp(energyCol, live.tiers[3] ? 0.5 + 0.5 * Math.sin(live.t * 1.5) : 0.35);
    }
    if (hemi.current) hemi.current.intensity = 0.25 + 0.45 * L;
    if (rimA.current) rimA.current.intensity = 0.2 + 1.4 * live.tiers[1] + live.tiers[3] * live.pulse * 0.8;
    if (rimB.current) rimB.current.intensity = 0.2 + 1.4 * live.tiers[1] + live.tiers[3] * live.pulse * 0.8;
  });

  return (
    <group>
      <Driver live={live} energy={p.energy} beatPhase={p.beatPhase} reducedMotion={p.reducedMotion} />
      <hemisphereLight ref={hemi} args={['#d9e6ff', '#120a1f', 0.3]} />
      {/* Work light: the dancers are always visible, even on a dark stage. */}
      <directionalLight position={[0, 5, 6]} intensity={1.05} color="#f2f4ff" />
      <directionalLight ref={rimA} position={[-5, 4, -3]} intensity={0.2} color={c.primary} />
      <directionalLight ref={rimB} position={[5, 4, -3]} intensity={0.2} color={c.energy} />

      {/* LED floor */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[18, 10]} />
        <meshStandardMaterial ref={floorMat} color="#05060b" roughness={0.45} metalness={0} emissive={c.primary} emissiveMap={grid} emissiveIntensity={0.05} envMapIntensity={0.12} />
      </mesh>

      {/* backdrop */}
      <mesh position={[0, 3, -3.4]}>
        <planeGeometry args={[18, 8]} />
        <meshStandardMaterial color={c.background} roughness={0.95} />
      </mesh>
      <LedScreen live={live} colors={c} title={p.title} font={p.displayFont} />

      {/* truss */}
      <mesh position={[0, 5.05, 0.7]}>
        <boxGeometry args={[11.6, 0.2, 0.2]} />
        <meshStandardMaterial color="#1a1b22" metalness={0.7} roughness={0.4} />
      </mesh>
      {[-5.7, 5.7].map((x) => (
        <mesh key={x} position={[x, 2.55, 0.7]}>
          <boxGeometry args={[0.2, 5.1, 0.2]} />
          <meshStandardMaterial color="#1a1b22" metalness={0.7} roughness={0.4} />
        </mesh>
      ))}

      {/* 25 %: edge strips, truss and screen outline */}
      <GlowStrip live={live} tier={0} color={c.energy} pos={[0, 0.03, 2.3]} size={[11, 0.05, 0.05]} />
      <GlowStrip live={live} tier={0} color={c.primary} pos={[0, 4.93, 0.82]} size={[11.4, 0.03, 0.03]} />
      <GlowStrip live={live} tier={0} color={c.energy} pos={[0, 0.88, -2.93]} size={[8.4, 0.04, 0.02]} base={0.12} />
      <GlowStrip live={live} tier={0} color={c.energy} pos={[0, 4.02, -2.93]} size={[8.4, 0.04, 0.02]} base={0.12} />
      <GlowStrip live={live} tier={0} color={c.primary} pos={[-5.7, 2.55, 0.82]} size={[0.03, 5, 0.03]} />
      <GlowStrip live={live} tier={0} color={c.primary} pos={[5.7, 2.55, 0.82]} size={[0.03, 5, 0.03]} />

      <PowerTower live={live} x={-5.0} colors={c} />
      <PowerTower live={live} x={5.0} colors={c} />

      <ParCans live={live} colors={c} />
      <MovingBeams live={live} colors={c} count={budget.beams} reducedMotion={p.reducedMotion} />
      <Lasers live={live} colors={c} count={budget.lasers / 2} reducedMotion={p.reducedMotion} x={-4.3} />
      <Lasers live={live} colors={c} count={budget.lasers / 2} reducedMotion={p.reducedMotion} x={4.3} />
      <Strobe live={live} reducedMotion={p.reducedMotion} />
      <Confetti live={live} colors={c} count={budget.confetti} />
      <Sparks live={live} colors={c} perFountain={Math.round(budget.sparks / 2)} />
    </group>
  );
}

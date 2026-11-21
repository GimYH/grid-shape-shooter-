import { Particle, FloatingText, Shockwave } from '../types/game';

export interface LaserBeam {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  alpha: number;
  life: number;
}

// Optimization (2.1): effect quality tiers. High is the full effect,
// medium (default) thins bursts to 60%, low drops glow sprites and
// trails and renders every particle as a plain square shard.
export type EffectQuality = 'high' | 'medium' | 'low';

export const EFFECT_QUALITY_CAPS: Record<EffectQuality, number> = {
  high: 240,
  medium: 120,
  low: 50,
};

export const EFFECT_QUALITY_SPAWN_SCALE: Record<EffectQuality, number> = {
  high: 1,
  medium: 0.6,
  low: 0.6,
};

// Optimization (1.1): the pool is allocated exactly once, sized to the
// largest quality cap. Live particles always occupy pool[0..particleCount)
// in no particular order; dead ones are removed swap-and-pop, so update()
// never allocates, filter()s or splice()s.
export const ABSOLUTE_MAX_PARTICLES = 240;

// Optimization (1.4): per-frame burst budget. It counts burst spawns
// (block destruction / launch bursts / trails) between two consecutive
// update() calls, i.e. one frame. A 6+ clash or multi-cell meteor burst
// that fires several emit calls in the same tick is clipped to this
// budget, so the effect concentrates on the first 1-2 centers instead
// of spraying hundreds of particles at once.
export const FRAME_SPAWN_BUDGET = 25;

export class ParticleSystem {
  // Fixed pool (see ABSOLUTE_MAX_PARTICLES). Only the first
  // `particleCount` entries are live; the rest hold stale field values
  // and are never read. Do NOT read `particles.length` as the live count.
  public particles: Particle[] = [];
  public particleCount = 0;
  public floatingTexts: FloatingText[] = [];
  public shockwaves: Shockwave[] = [];
  public laserBeams: LaserBeam[] = [];

  public quality: EffectQuality = 'medium';
  public maxParticles = EFFECT_QUALITY_CAPS.medium;
  public spawnScale = EFFECT_QUALITY_SPAWN_SCALE.medium;
  public squaresOnly = false;
  public glowEnabled = true;
  public trailsEnabled = true;
  // Optimization (2.2): auto frame defense scale (0.5 while degraded).
  public autoDegradeScale = 1;

  private overwriteCursor = 0;
  public frameSpawnCount = 0;

  constructor() {
    for (let i = 0; i < ABSOLUTE_MAX_PARTICLES; i++) {
      this.particles[i] = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 0,
        color: '#FFFFFF',
        alpha: 0,
        life: 0,
        maxLife: 1,
      };
    }
  }

  public setQuality(q: EffectQuality) {
    this.quality = q;
    this.maxParticles = EFFECT_QUALITY_CAPS[q];
    this.spawnScale = EFFECT_QUALITY_SPAWN_SCALE[q];
    this.squaresOnly = q === 'low';
    this.glowEnabled = q !== 'low';
    this.trailsEnabled = q !== 'low';
    if (this.particleCount > this.maxParticles) {
      this.particleCount = this.maxParticles;
    }
    if (this.overwriteCursor >= this.maxParticles) {
      this.overwriteCursor = 0;
    }
  }

  public setAutoDegraded(on: boolean) {
    this.autoDegradeScale = on ? 0.5 : 1;
  }

  public get autoDegraded(): boolean {
    return this.autoDegradeScale < 1;
  }

  private get effectiveSpawnScale(): number {
    return this.spawnScale * this.autoDegradeScale;
  }

  // Write one particle into a pooled slot. Returns false when the
  // per-frame burst budget is spent (caller stops its loop). All fields
  // are assigned every time so no stale shape/angle/spin leaks from a
  // previous life of the slot.
  private spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    color: string,
    life: number,
    maxLife: number,
    shape?: Particle['shape'],
    angle?: number,
    spin?: number,
  ): boolean {
    if (this.frameSpawnCount >= FRAME_SPAWN_BUDGET) return false;
    let idx: number;
    if (this.particleCount < this.maxParticles) {
      idx = this.particleCount++;
    } else {
      // Hard cap (1.1): ring-overwrite the oldest slot instead of
      // growing or skipping — the frame never drops for a burst.
      idx = this.overwriteCursor;
      this.overwriteCursor = (this.overwriteCursor + 1) % this.maxParticles;
    }
    const p = this.particles[idx];
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.size = size;
    p.color = color;
    p.alpha = 1;
    p.life = life;
    p.maxLife = maxLife;
    p.shape = shape;
    p.angle = angle;
    p.spin = spin;
    this.frameSpawnCount++;
    return true;
  }

  // Swap-and-pop removal for a live array: move the last element into
  // the vacated slot. No splice(), no allocation.
  private removeAt<T>(arr: T[], i: number): void {
    const last = arr.pop()!;
    if (i < arr.length) arr[i] = last;
  }

  public update(dt: number) {
    // New frame: the burst budget resets (1.4).
    this.frameSpawnCount = 0;

    // Update particles (swap-and-pop on the pool prefix).
    for (let i = 0; i < this.particleCount; i++) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.spin) p.angle = (p.angle ?? 0) + p.spin * dt;
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        this.particleCount--;
        if (i !== this.particleCount) {
          const tmp = this.particles[i];
          this.particles[i] = this.particles[this.particleCount];
          this.particles[this.particleCount] = tmp;
        }
        i--;
      }
    }

    // Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= 35 * dt;
      ft.life -= dt;
      ft.alpha = Math.min(1, ft.life * 1.5);
      if (ft.life <= 0) {
        this.removeAt(this.floatingTexts, i);
      }
    }

    // Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += 240 * dt;
      sw.alpha = Math.max(0, 1 - sw.radius / sw.maxRadius);
      if (sw.radius >= sw.maxRadius) {
        this.removeAt(this.shockwaves, i);
      }
    }

    // Update lasers
    for (let i = this.laserBeams.length - 1; i >= 0; i--) {
      const lb = this.laserBeams[i];
      lb.life -= dt;
      lb.alpha = Math.max(0, lb.life / 0.3);
      if (lb.life <= 0) {
        this.removeAt(this.laserBeams, i);
      }
    }
  }

  public emitBlockDestruction(x: number, y: number, color: string, count: number = 16) {
    const n = Math.round(count * this.effectiveSpawnScale);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 100 + Math.random() * 260;
      // Mostly tumbling shard triangles (shattering feel), a few soft
      // circles for glow dust.
      const isShard = Math.random() > 0.25;
      const life = 0.4 + Math.random() * 0.4;
      if (
        !this.spawn(
          x,
          y,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          4 + Math.random() * 8,
          color,
          life,
          0.8,
          isShard ? 'shard' : 'circle',
          Math.random() * Math.PI * 2,
          (Math.random() - 0.5) * 14,
        )
      ) {
        break;
      }
    }
  }

  public emitLaunchParticles(x: number, y: number, color: string) {
    const n = Math.round(10 * this.effectiveSpawnScale);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      const life = 0.3 + Math.random() * 0.2;
      if (
        !this.spawn(
          x,
          y,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          3 + Math.random() * 4,
          color,
          life,
          0.5,
        )
      ) {
        break;
      }
    }
  }

  public emitTrail(x: number, y: number, color: string, size: number = 4) {
    // Low quality disables afterimages (2.1).
    if (!this.trailsEnabled) return;
    this.spawn(
      x + (Math.random() - 0.5) * 10,
      y + (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20,
      size,
      color,
      0.25,
      0.25,
      'square',
    );
  }

  public addFloatingText(x: number, y: number, text: string, color: string, fontSize: number = 18) {
    this.floatingTexts.push({
      id: Math.random().toString(36).substring(2, 9),
      x,
      y,
      text,
      color,
      fontSize,
      alpha: 1,
      life: 0.9,
    });
  }

  public addShockwave(x: number, y: number, maxRadius: number, color: string) {
    this.shockwaves.push({
      x,
      y,
      radius: 10,
      maxRadius,
      color,
      alpha: 1,
    });
  }

  public addLaserBeam(x1: number, y1: number, x2: number, y2: number, color: string, width: number = 12) {
    this.laserBeams.push({
      id: Math.random().toString(36).substring(2, 9),
      x1,
      y1,
      x2,
      y2,
      color,
      width,
      alpha: 1,
      life: 0.3,
    });
  }

  public clear() {
    this.particleCount = 0;
    this.floatingTexts.length = 0;
    this.shockwaves.length = 0;
    this.laserBeams.length = 0;
    this.frameSpawnCount = 0;
    this.overwriteCursor = 0;
  }
}

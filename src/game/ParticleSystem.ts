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

export class ParticleSystem {
  public particles: Particle[] = [];
  public floatingTexts: FloatingText[] = [];
  public shockwaves: Shockwave[] = [];
  public laserBeams: LaserBeam[] = [];

  public update(dt: number) {
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= 35 * dt;
      ft.life -= dt;
      ft.alpha = Math.min(1, ft.life * 1.5);
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }

    // Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += 240 * dt;
      sw.alpha = Math.max(0, 1 - sw.radius / sw.maxRadius);
      if (sw.radius >= sw.maxRadius) {
        this.shockwaves.splice(i, 1);
      }
    }

    // Update lasers
    for (let i = this.laserBeams.length - 1; i >= 0; i--) {
      const lb = this.laserBeams[i];
      lb.life -= dt;
      lb.alpha = Math.max(0, lb.life / 0.3);
      if (lb.life <= 0) {
        this.laserBeams.splice(i, 1);
      }
    }
  }

  public emitBlockDestruction(x: number, y: number, color: string, count: number = 16) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 100 + Math.random() * 260;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 4 + Math.random() * 8,
        color,
        alpha: 1,
        life: 0.4 + Math.random() * 0.4,
        maxLife: 0.8,
        shape: Math.random() > 0.5 ? 'square' : 'circle',
      });
    }
  }

  public emitLaunchParticles(x: number, y: number, color: string) {
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 4,
        color,
        alpha: 1,
        life: 0.3 + Math.random() * 0.2,
        maxLife: 0.5,
      });
    }
  }

  public emitTrail(x: number, y: number, color: string, size: number = 4) {
    this.particles.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 10,
      vx: (Math.random() - 0.5) * 20,
      vy: (Math.random() - 0.5) * 20,
      size,
      color,
      alpha: 0.8,
      life: 0.25,
      maxLife: 0.25,
      shape: 'square',
    });
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
    this.particles = [];
    this.floatingTexts = [];
    this.shockwaves = [];
    this.laserBeams = [];
  }
}

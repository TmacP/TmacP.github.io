export class ParticleSystem {
  constructor() {
    this.particles = [];
    this.enabled = true;
  }

  emitBurst(x, y, opts = {}) {
    if (!this.enabled) return;
    const {
      count = 24,
      speedMin = 30,
      speedMax = 140,
      lifeMin = 0.3,
      lifeMax = 0.8,
      sizeMin = 0.5,
      sizeMax = 1.5,
      hue = 50,
      saturation = 90,
      lightness = 60,
      gravity = 500,
    } = opts;

    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speedMin + Math.random() * (speedMax - speedMin);
      const life = lifeMin + Math.random() * (lifeMax - lifeMin);
      const size = sizeMin + Math.random() * (sizeMax - sizeMin);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * -0.5, // bias upward a bit
        ax: 0,
        ay: gravity,
        age: 0,
        life,
        size,
        color: `hsl(${hue | 0} ${saturation}% ${lightness}%)`,
      });
    }
  }

  update(dt) {
    if (!this.enabled) return;
    const p = this.particles;
    for (let i = p.length - 1; i >= 0; i--) {
      const it = p[i];
      it.age += dt;
      if (it.age >= it.life) {
        p.splice(i, 1);
        continue;
      }
      it.vx += it.ax * dt;
      it.vy += it.ay * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
    }
  }

  render(ctx) {
    if (!this.enabled || this.particles.length === 0) return;
    // Additive blend for a soft glow look
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.particles.length; i++) {
      const it = this.particles[i];
      const t = it.age / it.life;
      const alpha = 1 - t;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = it.color;
      const s = it.size * (1 + 0.5 * (1 - t));
      ctx.beginPath();
      ctx.arc(it.x | 0, it.y | 0, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prev;
  }
}

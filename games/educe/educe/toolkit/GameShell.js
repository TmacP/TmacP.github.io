export class GameShell {
  constructor({ canvas, width = 960, height = 540, background = '#0b1021', autoStart = false } = {}) {
    this.canvas = canvas || document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.width = width;
    this.height = height;
    this.background = background;
    this._lastTime = 0;
    this._running = false;
    this._frameHandle = null;
    this._step = () => {};
    this.setSize(width, height);
    if (!canvas) document.body.appendChild(this.canvas);
    if (autoStart) this.start();
  }

  setStep(stepFn) {
    this._step = typeof stepFn === 'function' ? stepFn : () => {};
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  setBackground(color) {
    this.background = color;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    const tick = (time) => {
      if (!this._running) return;
      const dt = Math.min(0.05, (time - this._lastTime) / 1000);
      this._lastTime = time;
      this.clear();
      this._step({ dt, ctx: this.ctx, canvas: this.canvas, time });
      this._frameHandle = requestAnimationFrame(tick);
    };
    this._frameHandle = requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    if (this._frameHandle) cancelAnimationFrame(this._frameHandle);
  }

  toggle() {
    this._running ? this.stop() : this.start();
  }

  clear() {
    if (!this.ctx) return;
    this.ctx.fillStyle = this.background;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

/**
 * Educe Renderer - Canvas 2D rendering for tile-based games
 */

export class Renderer {
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.config = {
      gameWidth: config.gameWidth || 320,
      gameHeight: config.gameHeight || 256,
      backgroundColor: config.backgroundColor || 'rgb(100,148,237)',
      ...config
    };

    this.atlas = null;
    this.atlasWidth = 0;
    this.atlasHeight = 0;
  }

  async loadAtlas(imageUrl) {
    const blob = await fetch(imageUrl).then(r => r.blob());
    const bitmap = await createImageBitmap(blob);
    this.atlas = bitmap;
    this.atlasWidth = bitmap.width;
    this.atlasHeight = bitmap.height;
    return bitmap;
  }

  clear() {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = this.config.backgroundColor;
    this.ctx.fillRect(0, 0, this.config.gameWidth, this.config.gameHeight);
    this.ctx.restore();
  }

  drawTile(x, y, sx, sy, sw, sh) {
    if (!this.atlas) return;
    this.ctx.drawImage(this.atlas, sx, sy, sw, sh, x, y, sw, sh);
  }

  drawSprite(x, y, frame, facing = 1) {
    if (!this.atlas || !frame) return;
    
    const px = Math.round(x);
    const py = Math.round(y);

    if (facing < 0) {
      this.ctx.save();
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(
        this.atlas,
        frame.x, frame.y, frame.width, frame.height,
        -px - frame.width, py, frame.width, frame.height
      );
      this.ctx.restore();
    } else {
      this.ctx.drawImage(
        this.atlas,
        frame.x, frame.y, frame.width, frame.height,
        px, py, frame.width, frame.height
      );
    }
  }

  drawTiles(tileInstances) {
    if (!this.atlas || !tileInstances) return;
    
    const count = tileInstances.length / 6;
    for (let i = 0; i < count; i++) {
      const base = i * 6;
      const x = tileInstances[base + 0];
      const y = tileInstances[base + 1];
      const sx = tileInstances[base + 2];
      const sy = tileInstances[base + 3];
      const sw = tileInstances[base + 4];
      const sh = tileInstances[base + 5];
      this.ctx.drawImage(this.atlas, sx, sy, sw, sh, x, y, sw, sh);
    }
  }
}

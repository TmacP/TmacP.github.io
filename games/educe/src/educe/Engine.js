/**
 * Educe Engine - Core platformer engine
 * Provides physics, collision, room transitions, and entity management
 */

export class Engine {
  constructor(config = {}) {
    this.config = {
      roomCols: config.roomCols || 10,
      roomRows: config.roomRows || 8,
      tileWidth: config.tileWidth || 32,
      tileHeight: config.tileHeight || 32,
      gameWidth: config.gameWidth || 320,
      gameHeight: config.gameHeight || 256,
      gravity: config.gravity || 900,
      maxFallSpeed: config.maxFallSpeed || 900,
      playerWidth: config.playerWidth || 6,
      playerHeight: config.playerHeight || 6,
      ...config
    };

    this.player = {
      x: 16,
      y: 16,
      vx: 0,
      vy: 0,
      roomX: 0,
      roomY: 0,
      width: this.config.playerWidth,
      height: this.config.playerHeight,
      facing: 1,
      type: 0,
      onGround: false,
      frameTime: 0,
      currentFrame: 0,
    };

    this.input = {
      left: false,
      right: false,
      up: false,
      down: false,
      jump: false,
      action: false,
    };

    this.tiles = new Int32Array(this.config.roomCols * this.config.roomRows);
    this.npcs = [];
  }

  // NPC management
  setNpcs(npcs) {
    this.npcs = npcs || [];
  }

  getNpc(index) {
    return this.npcs[index] || null;
  }

  getNpcCount() {
    return this.npcs.length;
  }

  // Tile queries
  getTileAt(col, row) {
    if (col < 0 || col >= this.config.roomCols || row < 0 || row >= this.config.roomRows) {
      return 0;
    }
    return this.tiles[row * this.config.roomCols + col] | 0;
  }

  isSolidTile(tileId) {
    // Override this in your game to define which tiles are solid
    // By default: 0 = empty, 250 = exit (not solid), everything else solid
    return tileId !== 0 && tileId !== 250;
  }

  // Set tile grid for current room
  setTileGrid(flatTiles) {
    if (!(flatTiles instanceof Int32Array)) {
      this.tiles = new Int32Array(flatTiles);
    } else {
      this.tiles = new Int32Array(flatTiles);
    }
  }

  // Input handling
  setInput(input) {
    this.input = { ...this.input, ...input };
  }

  // Physics and collision
  moveAndCollide(dx, dy) {
    const { tileWidth, tileHeight } = this.config;
    const { width, height } = this.player;
    let x = this.player.x;
    let y = this.player.y;

    // Horizontal movement
    if (dx !== 0) {
      const dir = Math.sign(dx);
      const step = dir * tileWidth * 0.25;
      let remaining = dx;
      
      while (Math.abs(remaining) > 0) {
        const d = Math.abs(remaining) < Math.abs(step) ? remaining : step;
        const tryX = x + d;
        const left = Math.floor(tryX / tileWidth);
        const right = Math.floor((tryX + width - 1) / tileWidth);
        const top = Math.floor(y / tileHeight);
        const bottom = Math.floor((y + height - 1) / tileHeight);
        
        let blocked = false;
        for (let row = top; row <= bottom; row++) {
          const col = dir > 0 ? right : left;
          if (this.isSolidTile(this.getTileAt(col, row))) {
            blocked = true;
            break;
          }
        }
        
        if (blocked) break;
        x = tryX;
        remaining -= d;
      }
    }

    // Vertical movement
    this.player.onGround = false;
    if (dy !== 0) {
      const dir = Math.sign(dy);
      const step = dir * tileHeight * 0.25;
      let remaining = dy;
      
      while (Math.abs(remaining) > 0) {
        const d = Math.abs(remaining) < Math.abs(step) ? remaining : step;
        const tryY = y + d;
        const left = Math.floor(x / tileWidth);
        const right = Math.floor((x + width - 1) / tileWidth);
        const top = Math.floor(tryY / tileHeight);
        const bottom = Math.floor((tryY + height - 1) / tileHeight);
        
        let blocked = false;
        for (let col = left; col <= right; col++) {
          const row = dir > 0 ? bottom : top;
          if (this.isSolidTile(this.getTileAt(col, row))) {
            blocked = true;
            break;
          }
        }
        
        if (blocked) {
          if (dir > 0) this.player.onGround = true;
          break;
        }
        y = tryY;
        remaining -= d;
      }
    }

    this.player.x = x;
    this.player.y = y;
  }

  // Room transitions
  handleRoomTransition() {
    const { roomCols, roomRows, tileWidth, tileHeight } = this.config;
    const roomWidth = roomCols * tileWidth;
    const roomHeight = roomRows * tileHeight;
    let changed = false;

    if (this.player.x < 0) {
      this.player.x += roomWidth;
      this.player.roomX -= 1;
      changed = true;
    } else if (this.player.x >= roomWidth) {
      this.player.x -= roomWidth;
      this.player.roomX += 1;
      changed = true;
    }

    if (this.player.y < 0) {
      this.player.y += roomHeight;
      this.player.roomY -= 1;
      changed = true;
    } else if (this.player.y >= roomHeight) {
      this.player.y -= roomHeight;
      this.player.roomY += 1;
      changed = true;
    }

    return changed;
  }

  // Update loop - override this in your game for custom behavior
  update(dt) {
    // Default platformer physics
    const speed = 120;
    const jumpVel = -300;

    // Horizontal movement
    const targetVX = (this.input.left ? -speed : 0) + (this.input.right ? speed : 0);
    this.player.vx = targetVX;
    
    if (this.player.vx < 0) {
      this.player.facing = -1;
    } else if (this.player.vx > 0) {
      this.player.facing = 1;
    }

    // Jumping
    if (this.input.jump && this.player.onGround) {
      this.player.vy = jumpVel;
      this.player.onGround = false;
    }

    // Gravity
    this.player.vy = Math.min(this.config.maxFallSpeed, this.player.vy + this.config.gravity * dt);

    // Move with collision
    this.moveAndCollide(this.player.vx * dt, 0);
    this.moveAndCollide(0, this.player.vy * dt);

    // Room transitions
    this.handleRoomTransition();

    // Animation
    this.player.frameTime += dt;
    if (this.player.frameTime >= 0.12) {
      this.player.frameTime = 0;
      this.player.currentFrame = (this.player.currentFrame + 1) % 4;
    }
  }

  // Reset player to spawn position
  resetPlayer(roomX, roomY, x, y) {
    this.player.roomX = roomX | 0;
    this.player.roomY = roomY | 0;
    this.player.x = x;
    this.player.y = y;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.onGround = false;
    this.player.currentFrame = 0;
    this.player.frameTime = 0;
  }

  // Get player state
  getPlayer() {
    return { ...this.player };
  }

  // Set player type (for character switching)
  setPlayerType(type) {
    this.player.type = type | 0;
  }
}

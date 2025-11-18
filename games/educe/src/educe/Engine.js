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
      width: 32,
      height: 32,
      // Collider (bottom-aligned inside 32x32 sprite)
      colliderWidth: 8,
      colliderHeight: 8,
      colliderOffsetX: 12, // (32 - 8) / 2 centers horizontally
      colliderOffsetY: 0,  // 0 = collider bottom aligns with sprite bottom
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

    // World bounds in rooms (width x height). Default to single room.
    this.worldWidthRooms = 1;
    this.worldHeightRooms = 1;

    // Debug samples for collision probes
    this._debug = {
      horiz: [],
      vert: [],
    };
  }

  // NPC management
  setNpcs(npcs) {
    this.npcs = (npcs || []).map(npc => ({
      ...npc,
      frameTime: npc.frameTime || 0,
      currentFrame: npc.frame || 0,
    }));
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
    const { width, height, colliderWidth: cW, colliderHeight: cH, colliderOffsetX: offX, colliderOffsetY: offY } = this.player;

    // Debug: log collider values once
    if (!this._loggedCollider) {
      console.log('Collider config:', { width, height, cW, cH, offX, offY, tileWidth, tileHeight });
      console.log('Player pos:', this.player.x, this.player.y);
      const cy = this.player.y + height - cH + offY;
      console.log('Calculated collider Y:', cy, '(should be near sprite bottom)');
      this._loggedCollider = true;
    }

    // Clear debug samples
    this._debug.horiz.length = 0;
    this._debug.vert.length = 0;

    // Horizontal movement with sub-steps to prevent tunneling
    if (dx !== 0) {
      let remaining = dx;
      const maxStep = Math.max(1, Math.floor(tileWidth - 1));
      while (Math.abs(remaining) > 0.0001) {
        const step = Math.abs(remaining) > maxStep ? Math.sign(remaining) * maxStep : remaining;
        const x = this.player.x;
        const y = this.player.y;
        const cx = x + offX;
        const cy = y + height - cH + offY;
        const tryCX = cx + step;
        const topRow = Math.floor((cy + 1) / tileHeight);
        const bottomRow = Math.floor((cy + cH - 2) / tileHeight);

        if (step > 0) {
          const rightCol = Math.floor((tryCX + cW - 1) / tileWidth);
          let hit = false;
          for (let row = topRow; row <= bottomRow; row++) {
            const solid = this.isSolidTile(this.getTileAt(rightCol, row));
            this._debug.horiz.push({ col: rightCol, row, hit: !!solid });
            if (solid) {
              hit = true;
              break;
            }
          }
          if (!hit) {
            this.player.x = (tryCX - offX);
            remaining -= step;
          } else {
            // Attempt small step-up (up to one tile) to climb stairs
            let stepped = false;
            const maxStepUp = tileHeight; // 1 tile
            for (let s = 1; s <= maxStepUp; s++) {
              const testCY = cy - s;
              const tTop = Math.floor((testCY + 1) / tileHeight);
              const tBottom = Math.floor((testCY + cH - 2) / tileHeight);
              let clear = true;
              for (let r = tTop; r <= tBottom; r++) {
                const solid = this.isSolidTile(this.getTileAt(rightCol, r));
                this._debug.horiz.push({ col: rightCol, row: r, hit: !!solid, stepUp: s });
                if (solid) { clear = false; break; }
              }
              if (clear) {
                this.player.y = (testCY - (height - cH) - offY);
                this.player.x = (tryCX - offX);
                remaining -= step;
                stepped = true;
                break;
              }
            }
            if (!stepped) {
              const snapCX = rightCol * tileWidth - cW;
              this.player.x = snapCX - offX;
              this.player.vx = 0;
              break;
            }
          }
        } else {
          const leftCol = Math.floor(tryCX / tileWidth);
          let hit = false;
          for (let row = topRow; row <= bottomRow; row++) {
            const solid = this.isSolidTile(this.getTileAt(leftCol, row));
            this._debug.horiz.push({ col: leftCol, row, hit: !!solid });
            if (solid) {
              hit = true;
              break;
            }
          }
          if (!hit) {
            this.player.x = (tryCX - offX);
            remaining -= step;
          } else {
            // Attempt small step-up (up to one tile) to climb stairs
            let stepped = false;
            const maxStepUp = tileHeight; // 1 tile
            for (let s = 1; s <= maxStepUp; s++) {
              const testCY = cy - s;
              const tTop = Math.floor((testCY + 1) / tileHeight);
              const tBottom = Math.floor((testCY + cH - 2) / tileHeight);
              let clear = true;
              for (let r = tTop; r <= tBottom; r++) {
                const solid = this.isSolidTile(this.getTileAt(leftCol, r));
                this._debug.horiz.push({ col: leftCol, row: r, hit: !!solid, stepUp: s });
                if (solid) { clear = false; break; }
              }
              if (clear) {
                this.player.y = (testCY - (height - cH) - offY);
                this.player.x = (tryCX - offX);
                remaining -= step;
                stepped = true;
                break;
              }
            }
            if (!stepped) {
              const snapCX = (leftCol + 1) * tileWidth;
              this.player.x = snapCX - offX;
              this.player.vx = 0;
              break;
            }
          }
        }
      }
    }

    // Vertical movement with sub-steps to prevent tunneling
    if (dy !== 0) {
      this.player.onGround = false;
      let remaining = dy;
      const maxStep = Math.max(1, Math.floor(tileHeight - 1));
      while (Math.abs(remaining) > 0.0001) {
        const step = Math.abs(remaining) > maxStep ? Math.sign(remaining) * maxStep : remaining;
        const x = this.player.x;
        const y = this.player.y;
        const cx = x + offX;
        const cy = y + height - cH + offY;
        const tryCY = cy + step;
        const leftCol = Math.floor((cx + 1) / tileWidth);
        const rightCol = Math.floor((cx + cW - 2) / tileWidth);

        if (step > 0) {
          const bottomRow = Math.floor((tryCY + cH - 1) / tileHeight);
          let hit = false;
          for (let col = leftCol; col <= rightCol; col++) {
            const solid = this.isSolidTile(this.getTileAt(col, bottomRow));
            this._debug.vert.push({ col, row: bottomRow, hit: !!solid });
            if (solid) {
              hit = true;
              break;
            }
          }
          if (!hit) {
            this.player.y = (tryCY - (height - cH) - offY);
            remaining -= step;
          } else {
            const snapCY = bottomRow * tileHeight - cH;
            this.player.y = snapCY - (height - cH) - offY;
            this.player.vy = 0;
            this.player.onGround = true;
            break;
          }
        } else {
          const topRow = Math.floor(tryCY / tileHeight);
          let hit = false;
          for (let col = leftCol; col <= rightCol; col++) {
            const solid = this.isSolidTile(this.getTileAt(col, topRow));
            this._debug.vert.push({ col, row: topRow, hit: !!solid });
            if (solid) {
              hit = true;
              break;
            }
          }
          if (!hit) {
            this.player.y = (tryCY - (height - cH) - offY);
            remaining -= step;
          } else {
            const snapCY = (topRow + 1) * tileHeight;
            this.player.y = snapCY - (height - cH) - offY;
            this.player.vy = 0;
            break;
          }
        }
      }
    }
  }

  // Get collider world rect for debug/UI
  getPlayerColliderRect() {
    const offX = this.player.colliderOffsetX | 0;
    const offY = this.player.colliderOffsetY | 0;
    const cH = this.player.colliderHeight | 0;
    // Collider is bottom-aligned: y = sprite.y + sprite.height - collider.height + offset
    return {
      x: (this.player.x + offX),
      y: (this.player.y + this.player.height - cH + offY),
      width: this.player.colliderWidth | 0,
      height: cH,
    };
  }

  getDebugSamples() {
    return {
      horiz: this._debug.horiz.slice(0, 256),
      vert: this._debug.vert.slice(0, 256),
    };
  }

  // Room transitions
  handleRoomTransition() {
    const { roomCols, roomRows, tileWidth, tileHeight } = this.config;
    const roomWidth = roomCols * tileWidth;
    const roomHeight = roomRows * tileHeight;
    let changed = false;

    // Horizontal transitions with clamping at world edges
    if (this.player.x < 0) {
      if (this.player.roomX > 0) {
        this.player.x += roomWidth;
        this.player.roomX -= 1;
        changed = true;
      } else {
        this.player.x = 0;
        this.player.vx = 0;
      }
    } else if (this.player.x + this.player.width > roomWidth) {
      if (this.player.roomX < (this.worldWidthRooms - 1)) {
        this.player.x -= roomWidth;
        this.player.roomX += 1;
        changed = true;
      } else {
        this.player.x = roomWidth - this.player.width;
        this.player.vx = 0;
      }
    }

    // Vertical transitions with clamping at world edges
    if (this.player.y < 0) {
      if (this.player.roomY > 0) {
        this.player.y += roomHeight;
        this.player.roomY -= 1;
        changed = true;
      } else {
        this.player.y = 0;
        this.player.vy = 0;
      }
    } else if (this.player.y + this.player.height > roomHeight) {
      if (this.player.roomY < (this.worldHeightRooms - 1)) {
        this.player.y -= roomHeight;
        this.player.roomY += 1;
        changed = true;
      } else {
        this.player.y = roomHeight - this.player.height;
        this.player.vy = 0;
        this.player.onGround = true;
      }
    }

    return changed;
  }

  // World bounds API
  setWorldBounds(widthRooms, heightRooms) {
    const w = Math.max(1, Number(widthRooms) || 1);
    const h = Math.max(1, Number(heightRooms) || 1);
    this.worldWidthRooms = w | 0;
    this.worldHeightRooms = h | 0;
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
      this.player.facing = 1;
    } else if (this.player.vx > 0) {
      this.player.facing = -1;
    }

    // Jumping
    if (this.input.jump && this.player.onGround) {
      this.player.vy = jumpVel;
      this.player.onGround = false;
    }

    // Gravity: keep grounded players pinned instead of reapplying downward velocity
    if (this.player.onGround && this.player.vy >= 0) {
      this.player.vy = 0;
    } else {
      this.player.vy = Math.min(this.config.maxFallSpeed, this.player.vy + this.config.gravity * dt);
    }

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

    // Update NPC animations
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      npc.frameTime = (npc.frameTime || 0) + dt;
      if (npc.frameTime >= 0.15) {
        npc.frameTime = 0;
        npc.currentFrame = ((npc.currentFrame || 0) + 1) % 4;
      }
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
    this.player.type = type;
    // Scale collider proportionally to sprite size (keep 1/4 of sprite width/height as collider)
    const baseColliderRatio = 0.25;
    const newColliderWidth = Math.max(6, Math.round(this.player.width * baseColliderRatio));
    const newColliderHeight = Math.max(6, Math.round(this.player.height * baseColliderRatio));
    this.player.colliderWidth = newColliderWidth;
    this.player.colliderHeight = newColliderHeight;
    this.player.colliderOffsetX = Math.round((this.player.width - newColliderWidth) * 0.5);
    this.player.colliderOffsetY = 0; // Keep bottom-aligned
  }

  // Allow runtime adjustment of collider
  setPlayerCollider(width, height, offsetX, offsetY) {
    if (Number.isFinite(width) && width > 0) this.player.colliderWidth = width | 0;
    if (Number.isFinite(height) && height > 0) this.player.colliderHeight = height | 0;
    if (Number.isFinite(offsetX)) this.player.colliderOffsetX = offsetX | 0;
    if (Number.isFinite(offsetY)) this.player.colliderOffsetY = offsetY | 0;
  }
}

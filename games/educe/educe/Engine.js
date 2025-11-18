import { createPlayerState, setPlayerType as applyPlayerType, setPlayerSpriteSize as applyPlayerSpriteSize } from './player/PlayerState.js';
import { movePlayerWithCollision } from './physics/PhysicsSystem.js';
import { handleRoomTransition as transitionRooms } from './world/RoomTransitions.js';

/**
 * Educe Engine - Core platformer engine
 * Coordinates input, physics, room transitions, and entity management
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
      playerWidth: config.playerWidth ?? 32,
      playerHeight: config.playerHeight ?? 32,
      colliderRatio: config.colliderRatio ?? 0.25,
      minColliderSize: config.minColliderSize ?? 6,
      ...config,
    };

    this.player = createPlayerState({
      width: this.config.playerWidth,
      height: this.config.playerHeight,
      colliderRatio: this.config.colliderRatio,
      minColliderSize: this.config.minColliderSize,
    });

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
    this.worldWidthRooms = 1;
    this.worldHeightRooms = 1;
    this._debug = { horiz: [], vert: [] };
  }

  setNpcs(npcs) {
    this.npcs = (npcs || []).map((npc) => ({
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

  getTileAt(col, row) {
    if (col < 0 || col >= this.config.roomCols || row < 0 || row >= this.config.roomRows) {
      return 0;
    }
    return this.tiles[row * this.config.roomCols + col] | 0;
  }

  isSolidTile(tileId) {
    return tileId !== 0 && tileId !== 250;
  }

  setTileGrid(flatTiles) {
    if (!(flatTiles instanceof Int32Array)) {
      this.tiles = new Int32Array(flatTiles);
    } else {
      this.tiles = new Int32Array(flatTiles);
    }
  }

  setInput(input) {
    this.input = { ...this.input, ...input };
  }

  moveAndCollide(dx, dy) {
    movePlayerWithCollision(this, dx, dy);
  }

  getPlayerColliderRect() {
    const offX = this.player.colliderOffsetX | 0;
    const offY = this.player.colliderOffsetY | 0;
    const cH = this.player.colliderHeight | 0;
    return {
      x: this.player.x + offX,
      y: this.player.y + this.player.height - cH + offY,
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

  handleRoomTransition() {
    return transitionRooms(this);
  }

  setWorldBounds(widthRooms, heightRooms) {
    const w = Math.max(1, Number(widthRooms) || 1);
    const h = Math.max(1, Number(heightRooms) || 1);
    this.worldWidthRooms = w | 0;
    this.worldHeightRooms = h | 0;
  }

  update(dt) {
    const speed = 120;
    const jumpVel = -300;

    const targetVX = (this.input.left ? -speed : 0) + (this.input.right ? speed : 0);
    this.player.vx = targetVX;

    if (this.player.vx < 0) {
      this.player.facing = 1;
    } else if (this.player.vx > 0) {
      this.player.facing = -1;
    }

    if (this.input.jump && this.player.onGround) {
      this.player.vy = jumpVel;
      this.player.onGround = false;
    }

    if (this.player.onGround && this.player.vy >= 0) {
      this.player.vy = 0;
    } else {
      this.player.vy = Math.min(this.config.maxFallSpeed, this.player.vy + this.config.gravity * dt);
    }

    this.moveAndCollide(this.player.vx * dt, 0);
    this.moveAndCollide(0, this.player.vy * dt);

    this.handleRoomTransition();

    this.player.frameTime += dt;
    if (this.player.frameTime >= 0.12) {
      this.player.frameTime = 0;
      this.player.currentFrame = (this.player.currentFrame + 1) % 4;
    }

    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      npc.frameTime = (npc.frameTime || 0) + dt;
      if (npc.frameTime >= 0.15) {
        npc.frameTime = 0;
        npc.currentFrame = ((npc.currentFrame || 0) + 1) % 4;
      }
    }
  }

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

  getPlayer() {
    return { ...this.player };
  }

  setPlayerType(type) {
    applyPlayerType(this.player, type);
  }

  setPlayerSpriteSize(width, height, options) {
    applyPlayerSpriteSize(this.player, width, height, options);
  }

  setPlayerCollider(width, height, offsetX, offsetY) {
    if (Number.isFinite(width) && width > 0) this.player.colliderWidth = width | 0;
    if (Number.isFinite(height) && height > 0) this.player.colliderHeight = height | 0;
    if (Number.isFinite(offsetX)) this.player.colliderOffsetX = offsetX | 0;
    if (Number.isFinite(offsetY)) this.player.colliderOffsetY = offsetY | 0;
  }
}

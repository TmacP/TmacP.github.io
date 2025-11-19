// Compatibility wrapper around the new Educe Engine
// Maintains the old WASM-like API for backward compatibility

import { Engine } from '/educe/Engine.js';

export function createJsEngine({
  roomCols,
  roomRows,
  tileWidth,
  tileHeight,
}) {
  const engine = new Engine({
    roomCols,
    roomRows,
    tileWidth,
    tileHeight,
  });

  // Wrapper API that matches old WASM interface
  const api = {
    WebInit(w, h) {
      engine.config.gameWidth = w | 0;
      engine.config.gameHeight = h | 0;
    },

    SetControllerInput(
      _padIndex,
      isAnalog, stickX, stickY,
      moveUp, moveDown, moveLeft, moveRight,
      actionUp, actionDown, actionLeft, actionRight,
      leftShoulder, rightShoulder, start, back
    ) {
      engine.setInput({
        left: !!moveLeft,
        right: !!moveRight,
        up: !!moveUp,
        down: !!moveDown,
        jump: !!(actionDown || moveUp),
        action: !!actionUp,
      });
    },

    WebUpdateAndRender(dt) {
      engine.update(dt);
    },

    SetTileGrid(flatTiles, cols, rows) {
      engine.config.roomCols = cols | 0;
      engine.config.roomRows = rows | 0;
      engine.setTileGrid(flatTiles);
    },

    SetWorldBounds(widthRooms, heightRooms) {
      engine.setWorldBounds(widthRooms | 0, heightRooms | 0);
    },

    GetTileAt(col, row) {
      return engine.getTileAt(col | 0, row | 0);
    },

    GetPlayerRoomX() {
      return engine.player.roomX | 0;
    },

    GetPlayerRoomY() {
      return engine.player.roomY | 0;
    },

    GetPlayerX() {
      return engine.player.x;
    },

    GetPlayerY() {
      return engine.player.y;
    },

    GetPlayerFacing() {
      return engine.player.facing;
    },

    GetCurrentFrame() {
      return engine.player.currentFrame | 0;
    },

    GetPlayerType() {
      return engine.player.type | 0;
    },

    SetPlayerType(t) {
      engine.setPlayerType(t | 0);
    },

    SetPlayerSpriteSize(width, height, preserveBottom = true) {
      if (typeof engine.setPlayerSpriteSize === 'function') {
        engine.setPlayerSpriteSize(width, height, { preserveBottom });
      }
    },

    SetPlayerPosition(x, y) {
      engine.player.x = x;
      engine.player.y = y;
    },

    ResetPlayerState(roomX, roomY, x, y) {
      engine.resetPlayer(roomX, roomY, x, y);
    },

    // NPC interfaces
    SetNpcs(npcs) {
      engine.setNpcs(npcs);
    },

    GetNpcCount() {
      return engine.getNpcCount();
    },

    GetNpcX(index) {
      const npc = engine.getNpc(index | 0);
      return npc ? npc.x : 0;
    },

    GetNpcY(index) {
      const npc = engine.getNpc(index | 0);
      return npc ? npc.y : 0;
    },

    GetNpcFrame(index) {
      const npc = engine.getNpc(index | 0);
      return npc ? (npc.currentFrame || 0) : 0;
    },

    GetNpcType(index) {
      const npc = engine.getNpc(index | 0);
      return npc ? (npc.type || 0) : 0;
    },

    GetNpcFacing(index) {
      const npc = engine.getNpc(index | 0);
      return npc ? (npc.facing || 1) : 1;
    },

    // Debug probes
    GetDebugSamples() {
      if (typeof engine.getDebugSamples === 'function') {
        return engine.getDebugSamples();
      }
      return { horiz: [], vert: [] };
    },

    // Collider APIs
    GetPlayerCollider() {
      if (typeof engine.getPlayerColliderRect === 'function') {
        return engine.getPlayerColliderRect();
      }
      return { x: engine.player.x, y: engine.player.y, width: engine.player.width, height: engine.player.height };
    },
    SetPlayerCollider(w, h, ox, oy) {
      if (typeof engine.setPlayerCollider === 'function') {
        engine.setPlayerCollider(w, h, ox, oy);
      }
    },

    // Particles rendering
    RenderParticles(ctx) {
      if (typeof engine.renderParticles === 'function') {
        engine.renderParticles(ctx);
      }
    },
  };

  return api;
}

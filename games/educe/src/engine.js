// Compatibility wrapper around the new Educe Engine
// Maintains the old WASM-like API for backward compatibility

import { Engine } from './educe/Engine.js';

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

    SetPlayerPosition(x, y) {
      engine.player.x = x;
      engine.player.y = y;
    },

    ResetPlayerState(roomX, roomY, x, y) {
      engine.resetPlayer(roomX, roomY, x, y);
    },

    // NPC interfaces (no-op for now)
    GetNpcCount() {
      return 0;
    },
    GetNpcX() {
      return 0;
    },
    GetNpcY() {
      return 0;
    },
    GetNpcFrame() {
      return 0;
    },
    GetNpcType() {
      return 0;
    },
    GetNpcFacing() {
      return 1;
    },
  };

  return api;
}

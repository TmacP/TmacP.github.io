/**
 * Mousey Merge - Character evolution platformer
 * Built on the Educe engine
 */

import { Engine } from '../educe/Engine.js';

export const PLAYER_TYPE = {
  BLOB: 0,
  WALKER: 1,
  MOUSE: 2,
};

export const PLAYER_EVOLUTION_ORDER = [
  PLAYER_TYPE.BLOB,
  PLAYER_TYPE.WALKER,
  PLAYER_TYPE.MOUSE,
];

export class MouseyMergeGame extends Engine {
  constructor(config) {
    super(config);
    
    this.mergeHistory = [];
    this.exitTileId = 250;
    
    // Override player size based on type
    this.playerSizes = {
      [PLAYER_TYPE.BLOB]: { width: 24, height: 24 },
      [PLAYER_TYPE.WALKER]: { width: 24, height: 24 },
      [PLAYER_TYPE.MOUSE]: { width: 24, height: 24 },
    };

    // Event callbacks
    this.onLevelComplete = null;
    this.onRoomChange = null;
    this.onMerge = null;
    this.onSplit = null;
  }

  // Override player type setter to update size
  setPlayerType(type) {
    super.setPlayerType(type);
    const size = this.playerSizes[type] || { width: 24, height: 24 };
    this.player.width = size.width;
    this.player.height = size.height;
  }

  // Check if player is touching exit tile
  isOnExitTile() {
    const { tileWidth, tileHeight } = this.config;
    const playerBounds = {
      left: Math.floor(this.player.x / tileWidth),
      right: Math.floor((this.player.x + this.player.width - 1) / tileWidth),
      top: Math.floor(this.player.y / tileHeight),
      bottom: Math.floor((this.player.y + this.player.height - 1) / tileHeight),
    };

    for (let row = playerBounds.top; row <= playerBounds.bottom; row++) {
      for (let col = playerBounds.left; col <= playerBounds.right; col++) {
        if (this.getTileAt(col, row) === this.exitTileId) {
          return true;
        }
      }
    }
    return false;
  }

  // Check for NPC collision and merge
  checkNpcMerge(npcs) {
    const currentType = this.player.type;
    const nextType = this.getNextEvolution(currentType);
    
    if (nextType === currentType) {
      return null; // Already at max evolution
    }

    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i];
      if (npc.type !== currentType) continue;

      // Simple AABB overlap check
      if (this.rectanglesOverlap(
        this.player.x, this.player.y, this.player.width, this.player.height,
        npc.x, npc.y, npc.width, npc.height
      )) {
        return { index: i, npc, nextType };
      }
    }
    return null;
  }

  rectanglesOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  getNextEvolution(type) {
    const idx = PLAYER_EVOLUTION_ORDER.indexOf(type);
    if (idx === -1 || idx >= PLAYER_EVOLUTION_ORDER.length - 1) {
      return type;
    }
    return PLAYER_EVOLUTION_ORDER[idx + 1];
  }

  getPreviousEvolution(type) {
    const idx = PLAYER_EVOLUTION_ORDER.indexOf(type);
    if (idx <= 0) {
      return PLAYER_EVOLUTION_ORDER[0];
    }
    return PLAYER_EVOLUTION_ORDER[idx - 1];
  }

  merge(npc) {
    const currentType = this.player.type;
    const nextType = this.getNextEvolution(currentType);
    
    this.mergeHistory.push({
      previousType: currentType,
      spawnType: nextType,
      x: npc.x,
      y: npc.y,
      npcData: { ...npc },
    });

    this.setPlayerType(nextType);
    
    if (this.onMerge) {
      this.onMerge(currentType, nextType, npc);
    }
  }

  split() {
    if (this.mergeHistory.length === 0) {
      return null;
    }

    const currentType = this.player.type;
    if (currentType === PLAYER_TYPE.BLOB) {
      return null; // Can't split blob
    }

    const record = this.mergeHistory.pop();
    const targetType = record.previousType;
    
    this.setPlayerType(targetType);

    if (this.onSplit) {
      this.onSplit(currentType, targetType, record);
    }

    return record;
  }

  // Override update to add game-specific logic
  update(dt) {
    super.update(dt);

    // Check for level completion
    if (this.isOnExitTile() && this.onLevelComplete) {
      this.onLevelComplete();
    }
  }

  // Override room transition to trigger callback
  handleRoomTransition() {
    const changed = super.handleRoomTransition();
    if (changed && this.onRoomChange) {
      this.onRoomChange(this.player.roomX, this.player.roomY);
    }
    return changed;
  }
}

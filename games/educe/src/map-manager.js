import { ROOM_TILE_COLS, ROOM_TILE_ROWS } from './config.js';

function clampInt(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  const truncated = Math.trunc(numeric);
  if (truncated < min) return min;
  if (truncated > max) return max;
  return truncated;
}

const MAX_NPCS_PER_ROOM = 16;
const DEFAULT_NPC_ID = 'player_walk_left';

const WORLD_FILE_URL = new URL('../assets/world.json', import.meta.url);

export class MapManager {
  constructor(worldData, options = {}) {
    this.world = worldData;
    const maxRoomX = Math.max(0, (worldData.worldWidth ?? 1) - 1);
    const maxRoomY = Math.max(0, (worldData.worldHeight ?? 1) - 1);
    const spawn = options.spawn;
    if (spawn && typeof spawn === 'object') {
      this.currentRoomX = clampInt(spawn.roomX ?? worldData.startRoomX ?? 0, 0, maxRoomX);
      this.currentRoomY = clampInt(spawn.roomY ?? worldData.startRoomY ?? 0, 0, maxRoomY);
    } else {
      this.currentRoomX = clampInt(worldData.startRoomX ?? 0, 0, maxRoomX);
      this.currentRoomY = clampInt(worldData.startRoomY ?? 0, 0, maxRoomY);
    }
    this.ensureNpcGrid();
    this.levelSource = options.source ?? null;
  }

  normalizeNpcEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const row = Number(entry.row);
    const col = Number(entry.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) {
      return null;
    }
    const clampedRow = Math.max(0, Math.min(Math.trunc(row), ROOM_TILE_ROWS - 1));
    const clampedCol = Math.max(0, Math.min(Math.trunc(col), ROOM_TILE_COLS - 1));
    const id = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : DEFAULT_NPC_ID;
    const rawLabel = typeof entry.label === 'string' ? entry.label.trim() : '';
    const label = rawLabel.length > 0
      ? rawLabel
      : (id === DEFAULT_NPC_ID ? 'NPC Spawn' : id);
    return { row: clampedRow, col: clampedCol, id, label };
  }

  ensureNpcGrid() {
    const rooms = this.world.rooms || [];
    const maxY = this.world.worldHeight ?? rooms.length;
    const maxX = this.world.worldWidth ?? (rooms[0]?.length ?? 0);

    if (!Array.isArray(this.world.npcs)) {
      this.world.npcs = Array.from({ length: maxY }, () => Array.from({ length: maxX }, () => []));
      return;
    }

    if (this.world.npcs.length < maxY) {
      for (let y = this.world.npcs.length; y < maxY; y++) {
        this.world.npcs[y] = Array.from({ length: maxX }, () => []);
      }
    }

    for (let y = 0; y < maxY; y++) {
      if (!Array.isArray(this.world.npcs[y])) {
        this.world.npcs[y] = Array.from({ length: maxX }, () => []);
      }

      if (this.world.npcs[y].length < maxX) {
        for (let x = this.world.npcs[y].length; x < maxX; x++) {
          this.world.npcs[y][x] = [];
        }
      }

      for (let x = 0; x < maxX; x++) {
        if (!Array.isArray(this.world.npcs[y][x])) {
          this.world.npcs[y][x] = [];
        }
      }
    }
  }

  ensureNpcList(roomX, roomY) {
    this.ensureNpcGrid();
    const grid = this.world.npcs;
    const safeRow = Math.max(0, Math.min(roomY, grid.length - 1));
    const row = grid[safeRow] ?? [];
    const safeCol = Math.max(0, Math.min(roomX, row.length - 1));
    if (!Array.isArray(row[safeCol])) {
      row[safeCol] = [];
    }
    const list = row[safeCol];
    for (let i = list.length - 1; i >= 0; i--) {
      const normalized = this.normalizeNpcEntry(list[i]);
      if (normalized) {
        list[i] = normalized;
      } else {
        list.splice(i, 1);
      }
    }
    return list;
  }

  getRoom(roomX, roomY) {
    const worldRows = this.world.rooms || [];
    const maxY = this.world.worldHeight ?? worldRows.length;
    const maxX = this.world.worldWidth ?? (worldRows[0]?.length ?? 0);

    if (roomY < 0 || roomY >= maxY || roomX < 0 || roomX >= maxX) {
      return null;
    }

    const row = worldRows[roomY];
    if (!row) return null;
    return row[roomX] || null;
  }

  getCurrentMap() {
    const width = Math.min(this.world.roomWidth, ROOM_TILE_COLS);
    const height = Math.min(this.world.roomHeight, ROOM_TILE_ROWS);
    
    // Ensure rooms array exists and has the current room
    if (!this.world.rooms || 
        !this.world.rooms[this.currentRoomY] || 
        !this.world.rooms[this.currentRoomY][this.currentRoomX]) {
      console.warn(`Room (${this.currentRoomX}, ${this.currentRoomY}) does not exist, returning empty map`);
      return {
        width,
        height,
        tileData: Array.from({ length: height }, () => Array.from({ length: width }, () => 0)),
        npcData: []
      };
    }
    
    return {
      width,
      height,
      tileData: this.world.rooms[this.currentRoomY][this.currentRoomX],
      npcData: this.ensureNpcList(this.currentRoomX, this.currentRoomY)
    };
  }

  getCurrentNpcs() {
    const list = this.ensureNpcList(this.currentRoomX, this.currentRoomY);
    return list.map((npc) => ({ ...npc }));
  }

  getNpcCount(roomX = this.currentRoomX, roomY = this.currentRoomY) {
    const list = this.ensureNpcList(roomX, roomY);
    return list.length;
  }

  removeNpcByIndex(roomX, roomY, index) {
    const list = this.ensureNpcList(roomX, roomY);
    if (index < 0 || index >= list.length) {
      return null;
    }
    const [removed] = list.splice(index, 1);
    return removed ?? null;
  }

  addNpc(roomX, roomY, npcInfo) {
    const list = this.ensureNpcList(roomX, roomY);
    const entry = this.normalizeNpcEntry(npcInfo);
    if (!entry) {
      return false;
    }
    list.push(entry);
    return true;
  }

  addNpcInCurrentRoom(npcInfo) {
    return this.addNpc(this.currentRoomX, this.currentRoomY, npcInfo);
  }

  toggleNpc(roomX, roomY, row, col, npcInfo = null) {
    if (row < 0 || col < 0 || row >= ROOM_TILE_ROWS || col >= ROOM_TILE_COLS) {
      return 'ignored';
    }

    const list = this.ensureNpcList(roomX, roomY);
    const index = list.findIndex((npc) => npc.row === row && npc.col === col);
    const infoId = npcInfo && typeof npcInfo.id === 'string' && npcInfo.id.length > 0 ? npcInfo.id : DEFAULT_NPC_ID;
    const infoLabel = npcInfo && typeof npcInfo.label === 'string' && npcInfo.label.length > 0
      ? npcInfo.label
      : (infoId === DEFAULT_NPC_ID ? 'NPC Spawn' : infoId);

    if (index === -1) {
      if (list.length >= MAX_NPCS_PER_ROOM) {
        return 'limit';
      }
      const entry = this.normalizeNpcEntry({ row, col, id: infoId, label: infoLabel });
      if (entry) {
        list.push(entry);
        return 'added';
      }
      return 'ignored';
    }

    const existing = list[index];
    const hasExistingId = typeof existing.id === 'string' && existing.id.length > 0;
    const idsMatch = hasExistingId && infoId && existing.id === infoId;
    const wantsLabelUpdate = infoId && infoLabel && existing.label !== infoLabel;

    if (infoId && (!hasExistingId || !idsMatch || wantsLabelUpdate)) {
      const updated = this.normalizeNpcEntry({ row, col, id: infoId, label: infoLabel });
      if (updated) {
        list[index] = updated;
        return 'updated';
      }
      return 'ignored';
    }

    list.splice(index, 1);
    return 'removed';
  }

  toggleNpcInCurrentRoom(row, col, npcInfo = null) {
    return this.toggleNpc(this.currentRoomX, this.currentRoomY, row, col, npcInfo);
  }

  setTile(row, col, tileId) {
    this.ensureNpcGrid();
    const map = this.world.rooms[this.currentRoomY][this.currentRoomX];
    if (
      row >= 0 && row < map.length && row < ROOM_TILE_ROWS &&
      col >= 0 && col < map[0].length && col < ROOM_TILE_COLS
    ) {
      map[row][col] = tileId;
      return true;
    }
    return false;
  }

  // #DEV_ONLY_START
  async saveWorld(filename = this.levelSource?.requestPath || this.levelSource?.url || WORLD_FILE_URL.href) {
    this.ensureNpcGrid();
    try {
      if (this.world) {
        const worldWidth = Math.max(1, Number(this.world.worldWidth) || 1);
        const worldHeight = Math.max(1, Number(this.world.worldHeight) || 1);
        this.world.startRoomX = clampInt(this.currentRoomX, 0, worldWidth - 1);
        this.world.startRoomY = clampInt(this.currentRoomY, 0, worldHeight - 1);

        const roomWidth = Math.max(1, Number(this.world.roomWidth) || ROOM_TILE_COLS);
        const roomHeight = Math.max(1, Number(this.world.roomHeight) || ROOM_TILE_ROWS);
        const spawn = (this.world.playerSpawn && typeof this.world.playerSpawn === 'object') ? this.world.playerSpawn : {};
        spawn.roomX = this.world.startRoomX;
        spawn.roomY = this.world.startRoomY;
        spawn.col = clampInt(spawn.col ?? Math.floor(roomWidth / 2), 0, roomWidth - 1);
        spawn.row = clampInt(spawn.row ?? Math.max(0, roomHeight - 3), 0, roomHeight - 1);
        this.world.playerSpawn = spawn;
      }

      let requestTarget = filename;
      try {
        const parsed = new URL(filename, window.location.origin);
        requestTarget = parsed.origin === window.location.origin
          ? parsed.pathname
          : parsed.href;
      } catch (err) {
        if (typeof filename === 'string' && filename.startsWith('/')) {
          requestTarget = filename;
        }
      }

      const downloadName = (() => {
        if (this.levelSource?.entry?.id) {
          return `${this.levelSource.entry.id}.json`;
        }
        if (typeof filename === 'string') {
          const parts = filename.split('/');
          const last = parts[parts.length - 1];
          if (last) return last;
        }
        return 'world.json';
      })();

      // Save to server using PUT request
      const response = await fetch(requestTarget, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.world, null, 2)
      });
      
      if (response.ok) {
        console.log(`World saved successfully to server (${requestTarget})`);
        this.levelSource = this.levelSource || {};
        if (typeof filename === 'string') {
          this.levelSource.url = filename;
        }
        if (typeof requestTarget === 'string') {
          this.levelSource.requestPath = requestTarget;
        }
        this.levelSource.downloadName = downloadName;
        return true;
      } else {
        console.error('Failed to save world to server:', response.status);
        // Fallback to download if server save fails
        this.downloadWorld(downloadName);
        return false;
      }
    } catch (error) {
      console.error('Error saving world to server:', error);
      // Fallback to download if server save fails
      const downloadName = this.levelSource?.downloadName
        || (this.levelSource?.entry?.id ? `${this.levelSource.entry.id}.json` : 'world.json');
      this.downloadWorld(downloadName);
      return false;
    }
  }

  downloadWorld(filename = 'world.json') {
    // Original download method as fallback
    const blob = new Blob([JSON.stringify(this.world, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  // #DEV_ONLY_END
}

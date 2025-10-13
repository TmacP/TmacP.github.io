import { ROOM_TILE_COLS, ROOM_TILE_ROWS } from './config.js';

const MAX_NPCS_PER_ROOM = 16;

const WORLD_FILE_URL = new URL('../../assets/world.json', import.meta.url);

export class MapManager {
  constructor(worldData) {
    this.world = worldData;
    this.currentRoomX = worldData.startRoomX || 0;
    this.currentRoomY = worldData.startRoomY || 0;
    this.ensureNpcGrid();
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
    return row[safeCol];
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
    return {
      width,
      height,
      tileData: this.world.rooms[this.currentRoomY][this.currentRoomX]
    };
  }

  getCurrentNpcs() {
    return [...this.ensureNpcList(this.currentRoomX, this.currentRoomY)];
  }

  getNpcCount(roomX = this.currentRoomX, roomY = this.currentRoomY) {
    const list = this.ensureNpcList(roomX, roomY);
    return list.length;
  }

  removeNpcByIndex(roomX, roomY, index) {
    const list = this.ensureNpcList(roomX, roomY);
    if (index < 0 || index >= list.length) {
      return false;
    }
    list.splice(index, 1);
    return true;
  }

  toggleNpc(roomX, roomY, row, col) {
    if (row < 0 || col < 0 || row >= ROOM_TILE_ROWS || col >= ROOM_TILE_COLS) {
      return 'ignored';
    }

    const list = this.ensureNpcList(roomX, roomY);
    const index = list.findIndex((npc) => npc.row === row && npc.col === col);
    if (index === -1) {
      if (list.length >= MAX_NPCS_PER_ROOM) {
        return 'limit';
      }
      list.push({ row, col });
      return 'added';
    }

    list.splice(index, 1);
    return 'removed';
  }

  toggleNpcInCurrentRoom(row, col) {
    return this.toggleNpc(this.currentRoomX, this.currentRoomY, row, col);
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
  async saveWorld(filename = WORLD_FILE_URL.href) {
    this.ensureNpcGrid();
    try {
      // Save to server using PUT request
      const response = await fetch(filename, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.world, null, 2)
      });
      
      if (response.ok) {
        console.log('World saved successfully to server');
        return true;
      } else {
        console.error('Failed to save world to server:', response.status);
        // Fallback to download if server save fails
        this.downloadWorld();
        return false;
      }
    } catch (error) {
      console.error('Error saving world to server:', error);
      // Fallback to download if server save fails
      this.downloadWorld();
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

import { TILE_PIXEL_WIDTH } from './config.js';

export class LevelEditor {
  constructor(canvas, mapManager, updateCallback, options = {}) {
    this.canvas = canvas;
    this.mapManager = mapManager;
    this.updateCallback = updateCallback;
    this.tileSize = options.tileSize ?? TILE_PIXEL_WIDTH;
    this.isEditorMode = false;
    this.selectedTileId = 1;
    this.isMouseDown = false;
    this.statusUpdateCallback = options.statusUpdateCallback || null;
    this.editMode = 'tiles';
    this.onNpcClick = options.onNpcClick || null;

    this.setupEventListeners();
  }

  setupEventListeners() {
    document.addEventListener('keydown', (e) => {
      if (!this.isEditorMode) return;
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        this.saveCurrentMap();
        return;
      }

      if (e.code === 'KeyN') {
        e.preventDefault();
        this.toggleEditMode();
        return;
      }

      if (this.editMode === 'tiles') {
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 0 && num <= 9) {
          this.selectedTileId = num;
          this.updateStatus();
        }
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.isEditorMode) return;
      this.isMouseDown = true;
      this.handleTileEdit(e);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.isEditorMode || !this.isMouseDown) return;
      this.handleTileEdit(e);
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });
  }

  toggleEditorMode() {
    this.isEditorMode = !this.isEditorMode;
    this.updateCursor();
    this.updateStatus();
  }

  toggleEditMode() {
    if (!this.isEditorMode) return;
    this.editMode = this.editMode === 'tiles' ? 'npcs' : 'tiles';
    this.updateCursor();
    this.updateStatus();
  }

  updateCursor() {
    if (!this.isEditorMode) {
      this.canvas.style.cursor = 'default';
      return;
    }
    this.canvas.style.cursor = this.editMode === 'tiles' ? 'crosshair' : 'pointer';
  }

  updateStatus() {
    if (this.statusUpdateCallback) {
      this.statusUpdateCallback();
    }
  }

  handleTileEdit(event) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    const col = Math.floor(x / this.tileSize);
    const row = Math.floor(y / this.tileSize);
    const map = this.mapManager.getCurrentMap();
    if (row < 0 || row >= map.height || col < 0 || col >= map.width) return;
    if (this.editMode === 'tiles') {
      if (this.mapManager.setTile(row, col, this.selectedTileId)) {
        this.updateCallback();
      }
    } else if (this.editMode === 'npcs') {
      if (event.type !== 'mousedown') {
        return;
      }
      if (this.onNpcClick && this.onNpcClick({ worldX: x, worldY: y, row, col })) {
        return;
      }
      const result = this.mapManager.toggleNpcInCurrentRoom(row, col);
      if (result === 'added' || result === 'removed') {
        this.updateCallback();
        this.updateStatus();
      } else if (result === 'limit') {
        console.warn('Maximum NPC spawns reached for this room.');
      }
    }
  }

  async saveCurrentMap() {
    console.log('Saving world to server...');
    const success = await this.mapManager.saveWorld();
    if (success) {
      console.log('✅ World saved successfully!');
    } else {
      console.log('⚠️ Failed to save to server, downloaded as fallback');
    }
  }
}

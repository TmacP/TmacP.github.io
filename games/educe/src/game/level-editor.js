import { TILE_PIXEL_WIDTH } from './config.js';

const TOOL_PAINT = 'paint';
const TOOL_SELECT = 'select';

export class LevelEditor {
  constructor(canvas, mapManager, updateCallback, options = {}) {
    this.canvas = canvas;
    this.mapManager = mapManager;
    this.updateCallback = updateCallback;
    this.tileSize = options.tileSize ?? TILE_PIXEL_WIDTH;
    this.statusUpdateCallback = options.statusUpdateCallback || null;
    this.onNpcClick = options.onNpcClick || null;
    this.tileDefinitions = Array.isArray(options.tileDefinitions) ? options.tileDefinitions : [];
    this.tileLookup = new Map(this.tileDefinitions.map((tile) => [tile.id, tile]));

    this.isEditorMode = false;
    this.editMode = 'tiles';
    this.tool = TOOL_PAINT;
    this.selectedTileId = 1;
    this.selectedTileInfo = this.tileLookup.get(this.selectedTileId) || null;
    this.selectedNpcId = 'default';
    this.selectedNpcLabel = 'NPC Spawn';

    this.isMouseDown = false;
    this.isSelecting = false;
    this.isMovingSelection = false;
    this.selectionStart = null;
    this.selection = null;
    this.selectionPreview = null;
    this.moveStart = null;
    this.movePreviewTarget = null;
    this.selectionAction = 'move';

    this.selectionOverlay = document.getElementById('editor-selection-overlay');
    this.previewOverlay = document.getElementById('editor-preview-overlay');
    this.palette = null;

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleWindowResize = this.refreshOverlayPositions.bind(this);

    this.setupEventListeners();
  }

  setupEventListeners() {
    document.addEventListener('keydown', this.handleKeyDown);
    this.canvas.addEventListener('mousedown', this.handlePointerDown);
    this.canvas.addEventListener('mousemove', this.handlePointerMove);
    window.addEventListener('mouseup', this.handlePointerUp);
    window.addEventListener('resize', this.handleWindowResize);
  }

  handleKeyDown(e) {
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

    if (e.code === 'Escape') {
      if (this.tool === TOOL_SELECT && this.selection) {
        this.clearSelection();
        this.updateStatus();
      }
      return;
    }

    if (this.editMode === 'tiles') {
      const num = parseInt(e.key, 10);
      if (!Number.isNaN(num) && num >= 0 && num <= 9) {
        this.setSelectedTile(num);
        return;
      }

      if (e.code === 'KeyM') {
        e.preventDefault();
        this.setTool(this.tool === TOOL_PAINT ? TOOL_SELECT : TOOL_PAINT);
      }
    }
  }

  attachPalette = (palette) => {
    this.palette = palette;
    this.palette.setMode(this.editMode, { silent: true });
    this.palette.setTool(this.tool, { silent: true });
    this.palette.setSelectedTile(this.selectedTileId, { silent: true });
    this.palette.setSelectedNpc(this.selectedNpcId, { silent: true });
    this.palette.setSelectionState(!!this.selection);
  };

  setMapManager(mapManager) {
    if (!mapManager) {
      return;
    }
    this.mapManager = mapManager;
    if (typeof this.updateCallback === 'function') {
      this.updateCallback();
    }
  }

  toggleEditorMode() {
    this.isEditorMode = !this.isEditorMode;
    if (!this.isEditorMode) {
      this.clearSelection();
    }
    this.updateCursor();
    this.updateStatus();
  }

  setEditMode(mode, options = {}) {
    if (!this.isEditorMode && !options.force) {
      return;
    }
    if (mode !== 'tiles' && mode !== 'npcs') {
      return;
    }
    if (this.editMode === mode) {
      return;
    }
    this.editMode = mode;

    if (mode !== 'tiles') {
      this.setTool(TOOL_PAINT, { silent: true });
      this.clearSelection();
    }

    if (this.palette && !options.silent) {
      this.palette.setMode(mode, { silent: true });
    }
    this.updateCursor();
    this.updateStatus();
  }

  toggleEditMode() {
    const next = this.editMode === 'tiles' ? 'npcs' : 'tiles';
    this.setEditMode(next);
  }

  setTool(tool, options = {}) {
    if (this.editMode !== 'tiles') {
      return;
    }
    if (tool !== TOOL_PAINT && tool !== TOOL_SELECT) {
      return;
    }
    if (this.tool === tool) {
      return;
    }
    this.tool = tool;
    if (tool !== TOOL_SELECT) {
      this.clearSelection();
    }
    if (this.palette && !options.silent) {
      this.palette.setTool(tool, { silent: true });
    }
    this.updateCursor();
    this.updateStatus();
  }

  setSelectedTile(tileId, options = {}) {
    if (typeof tileId !== 'number') {
      return;
    }

    const info = options.info || this.tileLookup.get(tileId) || null;
    if (this.selectedTileId === tileId && this.selectedTileInfo === info) {
      return;
    }

    this.selectedTileId = tileId;
    this.selectedTileInfo = info;

    if (this.palette && !options.silent) {
      this.palette.setSelectedTile(tileId, { silent: true });
    }

    this.updateStatus();
  }

  setSelectedNpc(npcId, options = {}) {
    if (!npcId) {
      return;
    }

    this.selectedNpcId = npcId;
    if (options.label) {
      this.selectedNpcLabel = options.label;
    }
    if (this.palette && !options.silent) {
      this.palette.setSelectedNpc(npcId, { silent: true });
    }
    this.updateStatus();
  }

  updateCursor() {
    if (!this.isEditorMode) {
      this.canvas.style.cursor = 'default';
      return;
    }

    if (this.editMode === 'npcs') {
      this.canvas.style.cursor = 'pointer';
      return;
    }

    this.canvas.style.cursor = this.tool === TOOL_SELECT ? 'cell' : 'crosshair';
  }

  updateStatus() {
    if (typeof this.statusUpdateCallback === 'function') {
      this.statusUpdateCallback();
    }
  }

  getStatus() {
    return {
      mode: this.editMode,
      tileId: this.selectedTileId,
      tileName: this.selectedTileInfo?.name ?? null,
      tileLabel: this.selectedTileInfo?.name ?? `Tile ${this.selectedTileId}`,
      tool: this.tool,
      selection: this.selection ? {
        rows: this.selection.height,
        cols: this.selection.width,
      } : null,
      npcId: this.selectedNpcId,
      npcLabel: this.selectedNpcLabel,
    };
  }

  getPointerCell(event) {
    const map = this.mapManager.getCurrentMap();
    if (!map) return null;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    const col = Math.floor(x / this.tileSize);
    const row = Math.floor(y / this.tileSize);

    if (row < 0 || row >= map.height || col < 0 || col >= map.width) {
      return null;
    }

    return {
      row,
      col,
      worldX: x,
      worldY: y,
    };
  }

  handlePointerDown(event) {
    if (!this.isEditorMode) return;

    const cell = this.getPointerCell(event);
    if (!cell) {
      return;
    }

    event.preventDefault();

    this.isMouseDown = true;

    if (this.editMode === 'tiles') {
      if (this.tool === TOOL_SELECT) {
        if (this.selection && this.isCellWithinSelection(cell.row, cell.col)) {
          this.beginSelectionMove(cell, event);
        } else {
          this.beginSelection(cell);
        }
      } else {
        this.paintTile(cell);
      }
    } else if (this.editMode === 'npcs') {
      this.handleNpcPlacement(event, cell);
    }
  }

  handlePointerMove(event) {
    if (!this.isEditorMode || !this.isMouseDown) return;

    const cell = this.getPointerCell(event);
    if (!cell) {
      if (this.isSelecting) {
        this.clearPreviewOverlay();
      }
      return;
    }

    event.preventDefault();

    if (this.editMode === 'tiles') {
      if (this.tool === TOOL_SELECT) {
        if (this.isSelecting) {
          this.updateSelectionPreview(cell);
        } else if (this.isMovingSelection) {
          this.updateSelectionMove(cell);
        }
      } else {
        this.paintTile(cell);
      }
    }
  }

  handlePointerUp(event) {
    if (!this.isMouseDown) return;
    this.isMouseDown = false;

    if (event) {
      event.preventDefault();
    }

    if (!this.isEditorMode) return;

    if (this.editMode === 'tiles' && this.tool === TOOL_SELECT) {
      if (this.isSelecting) {
        this.finalizeSelection();
      } else if (this.isMovingSelection) {
        this.finalizeSelectionMove();
      }
    }
  }

  paintTile(cell) {
    const map = this.mapManager.getCurrentMap();
    if (!map || !Array.isArray(map.tileData)) {
      return;
    }

    const currentValue = map.tileData[cell.row]?.[cell.col];
    if (currentValue === this.selectedTileId) {
      return;
    }

    if (this.mapManager.setTile(cell.row, cell.col, this.selectedTileId)) {
      this.updateCallback();
      this.updateStatus();
    }
  }

  handleNpcPlacement(event, cell) {
    if (event.type !== 'mousedown') {
      return;
    }

    if (this.onNpcClick && this.onNpcClick({
      worldX: cell.worldX,
      worldY: cell.worldY,
      row: cell.row,
      col: cell.col,
    })) {
      return;
    }

    const result = this.mapManager.toggleNpcInCurrentRoom(cell.row, cell.col);
    if (result === 'added' || result === 'removed') {
      this.updateCallback();
      this.updateStatus();
    } else if (result === 'limit') {
      console.warn('Maximum NPC spawns reached for this room.');
    }
  }

  beginSelection(cell) {
    this.isSelecting = true;
    this.selectionStart = { row: cell.row, col: cell.col };
    this.selectionPreview = {
      row: cell.row,
      col: cell.col,
      rows: 1,
      cols: 1,
    };
    this.showOverlay(this.previewOverlay, this.selectionPreview);
  }

  updateSelectionPreview(cell) {
    if (!this.selectionStart) {
      return;
    }

    const startRow = this.selectionStart.row;
    const startCol = this.selectionStart.col;
    const endRow = cell.row;
    const endCol = cell.col;

    const rect = {
      row: Math.min(startRow, endRow),
      col: Math.min(startCol, endCol),
      rows: Math.abs(endRow - startRow) + 1,
      cols: Math.abs(endCol - startCol) + 1,
    };

    this.selectionPreview = rect;
    this.showOverlay(this.previewOverlay, rect);
  }

  finalizeSelection() {
    this.isSelecting = false;

    if (!this.selectionPreview) {
      this.clearPreviewOverlay();
      return;
    }

    const rect = this.selectionPreview;
    this.selectionPreview = null;
    this.clearPreviewOverlay();

    const map = this.mapManager.getCurrentMap();
    if (!map || !Array.isArray(map.tileData)) {
      return;
    }

    const tiles = [];
    for (let r = 0; r < rect.rows; r++) {
      const rowIndex = rect.row + r;
      const tileRow = [];
      for (let c = 0; c < rect.cols; c++) {
        const colIndex = rect.col + c;
        tileRow.push(map.tileData[rowIndex]?.[colIndex] ?? 0);
      }
      tiles.push(tileRow);
    }

    this.selection = {
      originRow: rect.row,
      originCol: rect.col,
      width: rect.cols,
      height: rect.rows,
      tiles,
    };

    this.showOverlay(this.selectionOverlay, {
      row: this.selection.originRow,
      col: this.selection.originCol,
      rows: this.selection.height,
      cols: this.selection.width,
    });

    if (this.palette) {
      this.palette.setSelectionState(true);
    }

    this.updateStatus();
  }

  beginSelectionMove(cell, event) {
    this.isMovingSelection = true;
    this.moveStart = { row: cell.row, col: cell.col };
    this.movePreviewTarget = {
      row: this.selection.originRow,
      col: this.selection.originCol,
    };
  // Holding a modifier key (Alt/Cmd/Ctrl) duplicates instead of moving.
  this.selectionAction = (event?.altKey || event?.metaKey || event?.ctrlKey) ? 'duplicate' : 'move';
    this.showOverlay(this.previewOverlay, {
      row: this.selection.originRow,
      col: this.selection.originCol,
      rows: this.selection.height,
      cols: this.selection.width,
    });
  }

  updateSelectionMove(cell) {
    if (!this.selection || !this.moveStart) {
      return;
    }

    const deltaRow = cell.row - this.moveStart.row;
    const deltaCol = cell.col - this.moveStart.col;

    const map = this.mapManager.getCurrentMap();
    if (!map) {
      return;
    }

    const maxRow = map.height - this.selection.height;
    const maxCol = map.width - this.selection.width;

    const targetRow = Math.max(0, Math.min(maxRow, this.selection.originRow + deltaRow));
    const targetCol = Math.max(0, Math.min(maxCol, this.selection.originCol + deltaCol));

    this.movePreviewTarget = { row: targetRow, col: targetCol };
    this.showOverlay(this.previewOverlay, {
      row: targetRow,
      col: targetCol,
      rows: this.selection.height,
      cols: this.selection.width,
    });
  }

  finalizeSelectionMove() {
    this.isMovingSelection = false;
    this.moveStart = null;

    if (!this.movePreviewTarget || !this.selection) {
      this.clearPreviewOverlay();
      this.selectionAction = 'move';
      return;
    }

    const { row, col } = this.movePreviewTarget;
    this.movePreviewTarget = null;
    this.clearPreviewOverlay();

    const action = this.selectionAction;
    this.selectionAction = 'move';

    if (action === 'duplicate') {
      if (row === this.selection.originRow && col === this.selection.originCol) {
        return;
      }
      this.applySelectionDuplicate(row, col);
      return;
    }

    if (row === this.selection.originRow && col === this.selection.originCol) {
      return;
    }

    this.applySelectionMove(row, col);
  }

  applySelectionMove(targetRow, targetCol) {
    const map = this.mapManager.getCurrentMap();
    if (!map || !Array.isArray(map.tileData)) {
      return;
    }

    const { originRow, originCol, width, height, tiles } = this.selection;

    for (let r = 0; r < height; r++) {
      const rowIndex = originRow + r;
      if (!Array.isArray(map.tileData[rowIndex])) continue;
      for (let c = 0; c < width; c++) {
        const colIndex = originCol + c;
        if (typeof map.tileData[rowIndex][colIndex] !== 'undefined') {
          map.tileData[rowIndex][colIndex] = 0;
        }
      }
    }

    for (let r = 0; r < height; r++) {
      const rowIndex = targetRow + r;
      if (!Array.isArray(map.tileData[rowIndex])) continue;
      for (let c = 0; c < width; c++) {
        const colIndex = targetCol + c;
        if (typeof map.tileData[rowIndex][colIndex] !== 'undefined') {
          map.tileData[rowIndex][colIndex] = tiles[r][c];
        }
      }
    }

    this.selection.originRow = targetRow;
    this.selection.originCol = targetCol;

    this.showOverlay(this.selectionOverlay, {
      row: targetRow,
      col: targetCol,
      rows: height,
      cols: width,
    });

    if (this.palette) {
      this.palette.setSelectionState(true);
    }

    this.updateCallback();
    this.updateStatus();
  }

  applySelectionDuplicate(targetRow, targetCol) {
    const map = this.mapManager.getCurrentMap();
    if (!map || !Array.isArray(map.tileData)) {
      return;
    }

    const { width, height, tiles } = this.selection;

    for (let r = 0; r < height; r++) {
      const rowIndex = targetRow + r;
      if (!Array.isArray(map.tileData[rowIndex])) continue;
      for (let c = 0; c < width; c++) {
        const colIndex = targetCol + c;
        if (typeof map.tileData[rowIndex][colIndex] !== 'undefined') {
          map.tileData[rowIndex][colIndex] = tiles[r][c];
        }
      }
    }

    this.selection.originRow = targetRow;
    this.selection.originCol = targetCol;

    this.showOverlay(this.selectionOverlay, {
      row: targetRow,
      col: targetCol,
      rows: height,
      cols: width,
    });

    if (this.palette) {
      this.palette.setSelectionState(true);
    }

    this.updateCallback();
    this.updateStatus();
  }

  clearSelection() {
    this.selection = null;
    this.selectionStart = null;
    this.isSelecting = false;
    this.isMovingSelection = false;
    this.hideOverlay(this.selectionOverlay);
    this.clearPreviewOverlay();
    this.selectionAction = 'move';
    if (this.palette) {
      this.palette.setSelectionState(false);
    }
  }

  clearPreviewOverlay() {
    this.hideOverlay(this.previewOverlay);
    this.selectionPreview = null;
    this.movePreviewTarget = null;
  }

  refreshOverlayPositions() {
    if (!this.isEditorMode) {
      this.hideOverlay(this.selectionOverlay);
      this.hideOverlay(this.previewOverlay);
      return;
    }

    if (this.selection && this.selectionOverlay) {
      this.showOverlay(this.selectionOverlay, {
        row: this.selection.originRow,
        col: this.selection.originCol,
        rows: this.selection.height,
        cols: this.selection.width,
      });
    }

    if (this.isSelecting && this.selectionPreview) {
      this.showOverlay(this.previewOverlay, this.selectionPreview);
    } else if (this.isMovingSelection && this.movePreviewTarget && this.selection) {
      this.showOverlay(this.previewOverlay, {
        row: this.movePreviewTarget.row,
        col: this.movePreviewTarget.col,
        rows: this.selection.height,
        cols: this.selection.width,
      });
    } else if (!this.selectionPreview && !this.movePreviewTarget) {
      this.hideOverlay(this.previewOverlay);
    }
  }

  showOverlay(element, rect) {
    if (!element || !rect) {
      return;
    }

    const map = this.mapManager.getCurrentMap();
    if (!map) {
      return;
    }

    const container = this.canvas.parentElement;
    if (!container) {
      return;
    }

    const canvasRect = this.canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const offsetLeft = canvasRect.left - containerRect.left;
    const offsetTop = canvasRect.top - containerRect.top;
    const scaleX = canvasRect.width / this.canvas.width;
    const scaleY = canvasRect.height / this.canvas.height;

    const left = offsetLeft + rect.col * this.tileSize * scaleX;
    const top = offsetTop + rect.row * this.tileSize * scaleY;
    const width = rect.cols * this.tileSize * scaleX;
    const height = rect.rows * this.tileSize * scaleY;

    element.style.display = 'block';
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }

  hideOverlay(element) {
    if (element) {
      element.style.display = 'none';
    }
  }

  isCellWithinSelection(row, col) {
    if (!this.selection) return false;
    return (
      row >= this.selection.originRow &&
      row < this.selection.originRow + this.selection.height &&
      col >= this.selection.originCol &&
      col < this.selection.originCol + this.selection.width
    );
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

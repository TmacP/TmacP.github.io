const DEFAULT_TILE_SCALE = 4;
const DEFAULT_NPC_SCALE = 2;

export class EditorPalette {
  constructor(rootElement, options = {}) {
    this.root = rootElement;
    this.options = options;
    this.mode = 'tiles';
    this.tool = 'paint';
    this.selectedTileId = null;
    this.selectedNpcId = null;

    this.tiles = Array.isArray(options.tiles) ? options.tiles : [];
    this.npcs = Array.isArray(options.npcs) && options.npcs.length > 0
      ? options.npcs
      : [{ id: 'default', label: 'NPC Spawn', frame: options.npcFrame || null }];
    this.npcs = this.npcs.map((npc, index) => {
      const id = npc.id ?? `npc_${index}`;
      const label = npc.label || String(id);
      return { ...npc, id, label };
    });

    this.tileScale = options.tileScale ?? DEFAULT_TILE_SCALE;
    this.npcScale = options.npcScale ?? DEFAULT_NPC_SCALE;

    this.onModeChange = typeof options.onModeChange === 'function' ? options.onModeChange : () => {};
    this.onTileSelect = typeof options.onTileSelect === 'function' ? options.onTileSelect : () => {};
    this.onNpcSelect = typeof options.onNpcSelect === 'function' ? options.onNpcSelect : () => {};

    this.atlasImageUrl = options.atlasImageUrl || null;
    this.atlasReady = false;

    this.tileItems = new Map();
    this.npcItems = new Map();

    this.tileGrid = null;
    this.npcGrid = null;

    this.initialize();
  }

  initialize() {
    if (!this.root) {
      throw new Error('Palette root element not found');
    }

    this.root.innerHTML = '';

    this.tileGrid = this.createGrid();
    this.tileGrid.dataset.type = 'tiles';
    this.root.appendChild(this.tileGrid);

    this.npcGrid = this.createGrid();
    this.npcGrid.dataset.type = 'npcs';
    this.root.appendChild(this.npcGrid);

    this.populateTiles();
    this.populateNpcs();
    this.syncVisibility();

    if (this.atlasImageUrl) {
      this.loadAtlasImage(this.atlasImageUrl);
    }
  }

  createGrid() {
    const grid = document.createElement('div');
    grid.className = 'palette-grid';
    return grid;
  }

  loadAtlasImage(url) {
    const image = new Image();
    image.onload = () => {
      this.atlasImage = image;
      this.atlasReady = true;
      this.redrawTilePreviews();
      this.redrawNpcPreviews();
    };
    image.onerror = (err) => {
      console.error('Failed to load atlas image for palette', err);
    };
    image.src = url;
  }

  populateTiles() {
    if (!this.tileGrid) return;
    this.tileGrid.innerHTML = '';
    this.tileItems.clear();

    const sortedTiles = [...this.tiles].sort((a, b) => a.id - b.id);
    sortedTiles.forEach((tile) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-item';
      button.dataset.tileId = String(tile.id);
      button.title = tile.name ? `${tile.name} (#${tile.id})` : `Tile #${tile.id}`;
      button.addEventListener('click', () => this.selectTile(tile));

      const canvas = document.createElement('canvas');
      const scale = Math.max(1, this.tileScale);
      canvas.width = (tile.width ?? 8) * scale;
      canvas.height = (tile.height ?? 8) * scale;
      button.appendChild(canvas);

      const label = document.createElement('span');
      label.className = 'palette-item-label';
      label.textContent = String(tile.id);
      button.appendChild(label);

      this.tileGrid.appendChild(button);
      this.tileItems.set(tile.id, { button, canvas, tile });
    });

    if (this.atlasReady) {
      this.redrawTilePreviews();
    }
  }

  redrawTilePreviews() {
    if (!this.atlasReady) return;

    this.tileItems.forEach(({ canvas, tile }) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      const sx = tile.x ?? 0;
      const sy = tile.y ?? 0;
      const sw = tile.width ?? canvas.width;
      const sh = tile.height ?? canvas.height;
      ctx.drawImage(
        this.atlasImage,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        canvas.width,
        canvas.height
      );
    });
  }

  populateNpcs() {
    if (!this.npcGrid) return;
    this.npcGrid.innerHTML = '';
    this.npcItems.clear();

    this.npcs.forEach((npc) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-item';
      button.dataset.npcId = npc.id;
      button.title = npc.label || 'NPC';
      button.addEventListener('click', () => this.selectNpc(npc));

      if (npc.frame) {
        const canvas = this.createNpcCanvas(npc.frame);
        button.appendChild(canvas);
      } else {
        const fallback = document.createElement('span');
        fallback.textContent = npc.label || npc.id || 'NPC';
        button.appendChild(fallback);
      }

      const label = document.createElement('span');
      label.className = 'palette-item-label';
      label.textContent = npc.label || npc.id || '';
      if (label.textContent) {
        button.appendChild(label);
      }

      this.npcGrid.appendChild(button);
      this.npcItems.set(npc.id, { button, npc });
    });

    if (this.atlasReady) {
      this.redrawNpcPreviews();
    }
  }

  createNpcCanvas(frame) {
    const scale = Math.max(1, this.npcScale);
    const canvas = document.createElement('canvas');
    canvas.width = (frame.width ?? 16) * scale;
    canvas.height = (frame.height ?? 16) * scale;
    canvas.dataset.frameX = String(frame.x ?? 0);
    canvas.dataset.frameY = String(frame.y ?? 0);
    canvas.dataset.frameW = String(frame.width ?? canvas.width);
    canvas.dataset.frameH = String(frame.height ?? canvas.height);
    return canvas;
  }

  redrawNpcPreviews() {
    if (!this.atlasReady) return;

    this.npcItems.forEach(({ button }) => {
      const canvas = button.querySelector('canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      const sx = Number(canvas.dataset.frameX) || 0;
      const sy = Number(canvas.dataset.frameY) || 0;
      const sw = Number(canvas.dataset.frameW) || canvas.width;
      const sh = Number(canvas.dataset.frameH) || canvas.height;
      ctx.drawImage(
        this.atlasImage,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        canvas.width,
        canvas.height
      );
    });
  }

  selectTile(tile) {
    this.selectedTileId = tile.id;
    this.highlightSelection(this.tileItems, tile.id);
    this.onTileSelect?.(tile);
    if (this.mode !== 'tiles') {
      this.setMode('tiles');
    }
  }

  selectNpc(npc) {
    this.selectedNpcId = npc.id;
    this.highlightSelection(this.npcItems, npc.id);
    this.onNpcSelect?.(npc);
    if (this.mode !== 'npcs') {
      this.setMode('npcs');
    }
  }

  highlightSelection(collection, id) {
    collection.forEach(({ button }, key) => {
      if (String(key) === String(id)) {
        button.classList.add('is-selected');
      } else {
        button.classList.remove('is-selected');
      }
    });
  }

  setMode(mode, options = {}) {
    if (mode !== 'tiles' && mode !== 'npcs') {
      return;
    }
    const changed = this.mode !== mode;
    this.mode = mode;

    this.syncVisibility();

    if (changed && !options.silent) {
      this.onModeChange(mode);
    }
  }

  setTool(tool, options = {}) {
    this.tool = tool;
  }

  setSelectedTile(tileId, options = {}) {
    this.selectedTileId = tileId;
    this.highlightSelection(this.tileItems, tileId);
    if (!options.silent) {
      const tile = this.tileItems.get(tileId)?.tile
        || this.tiles.find((t) => t.id === tileId)
        || null;
      if (tile) {
        this.onTileSelect?.(tile);
      }
    }
  }

  setSelectedNpc(npcId, options = {}) {
    this.selectedNpcId = npcId;
    this.highlightSelection(this.npcItems, npcId);
    if (!options.silent) {
      const npc = this.npcItems.get(npcId)?.npc
        || this.npcs.find((n) => n.id === npcId)
        || null;
      if (npc) {
        this.onNpcSelect?.(npc);
      }
    }
  }

  setSelectionState(hasSelection) {
  }

  syncVisibility() {
    if (this.root) {
      this.root.dataset.mode = this.mode;
    }
    if (this.tileGrid) {
      this.tileGrid.dataset.active = this.mode === 'tiles' ? 'true' : 'false';
    }
    if (this.npcGrid) {
      this.npcGrid.dataset.active = this.mode === 'npcs' ? 'true' : 'false';
    }
  }
}

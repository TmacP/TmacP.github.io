/*
  EDUCE WEB PLATFORM - JAVASCRIPT LAYER WITH WEBGPU + TILE EDITOR
*/

import { MapManager } from './map-manager.js';
import {
  playMidiSong,
  stopMidiSong,
  setMasterVolume,
  setBgmVolume,
  setSfxVolume,
  getBgmVolume,
  getSfxVolume,
} from './audio.js';
import {
  WIDTH as CONFIG_WIDTH,
  HEIGHT as CONFIG_HEIGHT,
  ROOM_TILE_COLS as CONFIG_ROOM_TILE_COLS,
  ROOM_TILE_ROWS as CONFIG_ROOM_TILE_ROWS,
  TILE_PIXEL_WIDTH as CONFIG_TILE_PIXEL_WIDTH,
  TILE_PIXEL_HEIGHT as CONFIG_TILE_PIXEL_HEIGHT
} from './config.js';

const RUNTIME_CONFIG = globalThis.RUNTIME_CONFIG || {};
const DEV_TOOLS_ENABLED = RUNTIME_CONFIG.devTools !== undefined ? !!RUNTIME_CONFIG.devTools : true;

// Game dimensions
const GAME_WIDTH = CONFIG_WIDTH;
const GAME_HEIGHT = CONFIG_HEIGHT;
const TILE_WIDTH = CONFIG_TILE_PIXEL_WIDTH;
const TILE_HEIGHT = CONFIG_TILE_PIXEL_HEIGHT;
const ROOM_TILE_COLS = CONFIG_ROOM_TILE_COLS;
const ROOM_TILE_ROWS = CONFIG_ROOM_TILE_ROWS;

function buildDoorTiles(rowStart, rowEnd, colStart, colEnd) {
  const tiles = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      tiles.push({ row, col });
    }
  }
  return tiles;
}

const tileRowFromBottom = (offset) => ROOM_TILE_ROWS - offset;

const HUB_ROOM = { x: 1, y: 1 };
const LEVELS = [
  {
    id: 'forest',
    name: 'Verdant Approach',
    description: 'A gentle stretch of mossy platforms – perfect for warming up.',
    entryRoom: { x: 0, y: 1 },
    hubDoor: {
      room: HUB_ROOM,
      tiles: buildDoorTiles(ROOM_TILE_ROWS - 5, ROOM_TILE_ROWS - 2, 0, 1),
      closedTile: 24,
    },
    secrets: [
      { room: { x: 0, y: 1 }, row: tileRowFromBottom(10), col: 12, radius: 1 },
      { room: { x: 0, y: 1 }, row: tileRowFromBottom(14), col: 20, radius: 1 },
      { room: { x: 0, y: 1 }, row: tileRowFromBottom(6), col: 30, radius: 1 },
    ],
    initiallyUnlocked: true,
    unlocks: ['cavern'],
  },
  {
    id: 'cavern',
    name: 'Shimmering Hollow',
    description: 'Crystal caverns with vertical climbs and hidden alcoves.',
    entryRoom: { x: 1, y: 0 },
    hubDoor: {
      room: HUB_ROOM,
      tiles: buildDoorTiles(0, 1, 18, 21),
      closedTile: 24,
    },
    secrets: [
      { room: { x: 1, y: 0 }, row: tileRowFromBottom(18), col: 14, radius: 1 },
      { room: { x: 1, y: 0 }, row: tileRowFromBottom(10), col: 30, radius: 1 },
      { room: { x: 1, y: 0 }, row: tileRowFromBottom(6), col: 20, radius: 1 },
    ],
    initiallyUnlocked: false,
    unlocks: ['ruins'],
  },
  {
    id: 'ruins',
    name: 'Sunken Ruins',
    description: 'Ancient stonework sunk beneath the waves, riddled with secrets.',
    entryRoom: { x: 2, y: 1 },
    hubDoor: {
      room: HUB_ROOM,
      tiles: buildDoorTiles(ROOM_TILE_ROWS - 5, ROOM_TILE_ROWS - 2, ROOM_TILE_COLS - 2, ROOM_TILE_COLS - 1),
      closedTile: 24,
    },
    secrets: [
      { room: { x: 2, y: 1 }, row: tileRowFromBottom(18), col: 10, radius: 1 },
      { room: { x: 2, y: 1 }, row: tileRowFromBottom(14), col: 28, radius: 1 },
      { room: { x: 2, y: 1 }, row: tileRowFromBottom(6), col: 12, radius: 1 },
    ],
    initiallyUnlocked: false,
    unlocks: [],
  },
];

const LEVEL_LOOKUP = new Map(LEVELS.map((level) => [level.id, level]));
const LEVEL_BY_ROOM = new Map(LEVELS.map((level) => [`${level.entryRoom.x},${level.entryRoom.y}`, level]));

const GAME_STATE_HUB = 'hub';
const GAME_STATE_LEVEL = 'level';

const horizontalAligned = (GAME_WIDTH % TILE_WIDTH) === 0;
const verticalRemainder = GAME_HEIGHT % TILE_HEIGHT;
if (!horizontalAligned || verticalRemainder !== 0) {
  console.warn(`Game resolution leaves ${verticalRemainder}px extra vertically; rendering will anchor tiles to the top and leave the remainder at the bottom.`);
}

const SHADER_URL = new URL('./shaders/shader.wgsl', import.meta.url);
const ATLAS_IMAGE_URL = new URL('../../assets/assets.png', import.meta.url);
const ATLAS_DATA_URL = new URL('../../assets/atlas.json', import.meta.url);
const WORLD_EDITOR_URL = new URL('../../assets/world.json', import.meta.url);
const WASM_URL = new URL('../../dist/main.wasm', import.meta.url);
const MAX_NPCS_PER_ROOM = 16;
const MAX_CHARACTERS = MAX_NPCS_PER_ROOM + 1;
const NPC_MEMORY_OFFSET = 600 * 1024;
const PLAYER_ANIMATION = 'blob';
const NPC_ANIMATION = 'player_walk_left';
const characterUniformData = new Float32Array(12);
let playerFrameWidth = 32;
let playerFrameHeight = 32;
let npcFrameWidth = 32;
let npcFrameHeight = 32;

const levelProgress = new Map();
let currentLevelId = null;
let hudMessageTimer = 0;
let gameState = GAME_STATE_HUB;
let gameActive = false;
let baseWorldData = null;
let platformReady = false;
let platformInitPromise = null;

// Setup canvas
const canvas = document.getElementById('screen');
const gameContainer = document.getElementById('game-container');
const hubScreen = document.getElementById('hub-screen');
const hubLevelList = document.getElementById('hub-level-list');
const editorContainer = document.getElementById('editor-container');
let levelHud = document.getElementById('level-hud');
let levelHudName = document.getElementById('level-hud-name');
let levelHudProgress = document.getElementById('level-hud-progress');
let levelHudStatus = document.getElementById('level-hud-status');
let levelMenuList = document.getElementById('level-menu-list');
if (levelHudStatus) {
  levelHudStatus.dataset.visible = 'false';
}

// WASM instance and exports
let wasm = null;
let memory = null;

// WebGPU state
let device = null;
let gpuContext = null;
let pipeline = null;
let tilePipeline = null;
let tileBindGroup = null;
let characterUniformBuffers = [];
let characterBindGroups = [];
let tileGlobalsBuffer = null;
let tileInstanceBuffer = null;
let atlasWidth = 0;
let atlasHeight = 0;
let spriteSampler = null;
let spriteTextureView = null;

// Sprite/Atlas system
let atlasData = null;
let atlasLoaded = false;

// Map/Editor system
let mapManager = null;
let levelEditor = null;
let editorPalette = null;
let devToolsInitialized = false;
let currentRoomX = 0;
let currentRoomY = 0;
let tileInstanceCount = 0;
let initialNpcSyncPending = true;
let lastNpcCount = 0;
let lastRoomSent = `${currentRoomX},${currentRoomY}`;

// Input state
const inputState = {
  moveUp: false,
  moveDown: false,
  moveLeft: false,
  moveRight: false,
  actionUp: false,
  actionDown: false,
  actionLeft: false,
  actionRight: false,
  leftShoulder: false,
  rightShoulder: false,
  start: false,
  back: false,
  stickX: 0.0,
  stickY: 0.0,
  isAnalog: false
};

// Gamepad state
let gamepadIndex = -1;

// Timing
let lastTime = performance.now();

//
// Canvas sizing
//

function resizeCanvas() {
  const scaleX = Math.floor(window.innerWidth / GAME_WIDTH);
  const scaleY = Math.floor(window.innerHeight / GAME_HEIGHT);
  const scale = Math.max(1, Math.min(scaleX, scaleY));
  
  canvas.width = GAME_WIDTH;
  canvas.height = GAME_HEIGHT;
  
  canvas.style.width = `${GAME_WIDTH * scale}px`;
  canvas.style.height = `${GAME_HEIGHT * scale}px`;
  
  console.log(`Canvas: ${GAME_WIDTH}x${GAME_HEIGHT}, Display scale: ${scale}x`);

  if (levelEditor && typeof levelEditor.refreshOverlayPositions === 'function') {
    levelEditor.refreshOverlayPositions();
  }
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

//
// Input handling
//

const keyMap = {
  'KeyW': 'moveUp', 'ArrowUp': 'moveUp',
  'KeyS': 'moveDown', 'ArrowDown': 'moveDown',
  'KeyA': 'moveLeft', 'ArrowLeft': 'moveLeft',
  'KeyD': 'moveRight', 'ArrowRight': 'moveRight',
  'Space': 'actionDown',  // Jump with Space
  'KeyI': 'actionUp',
  'KeyK': 'actionDown',
  'KeyJ': 'actionLeft',
  'KeyL': 'actionRight',
  'KeyQ': 'leftShoulder', 'ShiftLeft': 'leftShoulder',
  'KeyE': 'rightShoulder',
  'Enter': 'start',
  'Escape': 'back'
};

document.addEventListener('keydown', (e) => {
  // Handle Ctrl+S for saving in editor mode
  if(e.ctrlKey && e.key === 's') {
    if(DEV_TOOLS_ENABLED && levelEditor && levelEditor.isEditorMode) {
      e.preventDefault();
      console.log('Ctrl+S pressed - saving map...');
      levelEditor.saveCurrentMap();
    }
    return;
  }
  
  // Toggle editor mode with 'E' key
  if(e.code === 'KeyE' && DEV_TOOLS_ENABLED) {
    if(levelEditor) {
      if (gameState !== GAME_STATE_LEVEL) {
        console.warn('Editor unavailable in hub. Enter an expedition to edit.');
        return;
      }
      levelEditor.toggleEditorMode();
      updateEditorStatus();
      e.preventDefault();
    }
    return;
  }

  // Don't send game input while in editor mode
  if(levelEditor && levelEditor.isEditorMode) {
    return;
  }
  
  const action = keyMap[e.code];
  if(action && gamepadIndex === -1) {
    inputState[action] = true;
    inputState.isAnalog = false;
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  // Don't send game input while in editor mode
  if(levelEditor && levelEditor.isEditorMode) {
    return;
  }
  
  const action = keyMap[e.code];
  if(action && gamepadIndex === -1) {
    inputState[action] = false;
    e.preventDefault();
  }
});

// Gamepad handling
function updateGamepadInput() {
  const gamepads = navigator.getGamepads();
  
  if(gamepadIndex === -1) {
    for(let i = 0; i < gamepads.length; i++) {
      if(gamepads[i]) {
        gamepadIndex = i;
        console.log(`Gamepad connected: ${gamepads[i].id}`);
        break;
      }
    }
  }
  
  if(gamepadIndex !== -1 && gamepads[gamepadIndex]) {
    const gamepad = gamepads[gamepadIndex];
    
    const leftStickX = gamepad.axes[0] || 0;
    const leftStickY = gamepad.axes[1] || 0;
    
    const deadzone = 0.15;
    inputState.stickX = Math.abs(leftStickX) > deadzone ? leftStickX : 0.0;
    inputState.stickY = Math.abs(leftStickY) > deadzone ? leftStickY : 0.0;
    inputState.isAnalog = (inputState.stickX !== 0.0 || inputState.stickY !== 0.0);
    
    inputState.moveUp = gamepad.buttons[12]?.pressed || false;
    inputState.moveDown = gamepad.buttons[13]?.pressed || false;
    inputState.moveLeft = gamepad.buttons[14]?.pressed || false;
    inputState.moveRight = gamepad.buttons[15]?.pressed || false;
    
    inputState.actionDown = gamepad.buttons[0]?.pressed || false;
    inputState.actionRight = gamepad.buttons[1]?.pressed || false;
    inputState.actionLeft = gamepad.buttons[2]?.pressed || false;
    inputState.actionUp = gamepad.buttons[3]?.pressed || false;
    
    inputState.leftShoulder = gamepad.buttons[4]?.pressed || false;
    inputState.rightShoulder = gamepad.buttons[5]?.pressed || false;
    
    inputState.start = gamepad.buttons[9]?.pressed || false;
    inputState.back = gamepad.buttons[8]?.pressed || false;
  }
}

window.addEventListener('gamepadconnected', (e) => {
  console.log(`Gamepad connected: ${e.gamepad.id}`);
  gamepadIndex = e.gamepad.index;
});

window.addEventListener('gamepaddisconnected', (e) => {
  console.log(`Gamepad disconnected: ${e.gamepad.id}`);
  if(e.gamepad.index === gamepadIndex) {
    gamepadIndex = -1;
  }
});

//
// Main game loop
//

function gameLoop(currentTime) {
  requestAnimationFrame(gameLoop);
  
  const dt = Math.min((currentTime - lastTime) / 1000.0, 0.1);
  lastTime = currentTime;
  
  if (hudMessageTimer > 0 && !Number.isNaN(hudMessageTimer)) {
    hudMessageTimer -= dt;
    if (hudMessageTimer <= 0) {
      clearHudMessage();
    }
  }

  const isActive = gameActive && wasm;

  if (isActive) {
    updateGamepadInput();

    if (!levelEditor || !levelEditor.isEditorMode) {
      wasm.SetControllerInput(
        0,
        inputState.isAnalog,
        inputState.stickX,
        inputState.stickY,
        inputState.moveUp,
        inputState.moveDown,
        inputState.moveLeft,
        inputState.moveRight,
        inputState.actionUp,
        inputState.actionDown,
        inputState.actionLeft,
        inputState.actionRight,
        inputState.leftShoulder,
        inputState.rightShoulder,
        inputState.start,
        inputState.back
      );

      wasm.WebUpdateAndRender(dt);
      checkRoomChange();
      checkSecretCollection();
    }
  }

  if (device && platformReady) {
    renderScene();
  }
}

//
// WebGPU Rendering
//

async function initWebGPU() {
  try {
    // Request WebGPU adapter and device
    const adapter = await navigator.gpu?.requestAdapter();
    device = await adapter?.requestDevice();
    if (!device) {
      console.error('WebGPU not supported');
      return false;
    }

    // Configure canvas context for WebGPU
    gpuContext = canvas.getContext('webgpu');
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    gpuContext.configure({
      device,
      format: presentationFormat,
    });

  // Load shader code
  const shaderCode = await fetch(SHADER_URL).then(res => res.text());
    
    const module = device.createShaderModule({
      label: 'sprite shader',
      code: shaderCode,
    });

    // Create sprite rendering pipeline
    pipeline = device.createRenderPipeline({
      label: 'sprite pipeline',
      layout: 'auto',
      vertex: { entryPoint: 'vs', module },
      fragment: {
        entryPoint: 'fs',
        module,
        targets: [{
          format: presentationFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }],
      },
    });

  // Load sprite atlas
  const imgBitmap = await createImageBitmap(await fetch(ATLAS_IMAGE_URL).then(r => r.blob()));
  atlasData = await fetch(ATLAS_DATA_URL).then(r => r.json());
  const playerFrames = atlasData?.[PLAYER_ANIMATION];
  if (Array.isArray(playerFrames) && playerFrames.length > 0) {
    playerFrameWidth = playerFrames[0].width ?? playerFrameWidth;
    playerFrameHeight = playerFrames[0].height ?? playerFrameHeight;
  }

  const npcFrames = atlasData?.[NPC_ANIMATION];
  if (Array.isArray(npcFrames) && npcFrames.length > 0) {
    npcFrameWidth = npcFrames[0].width ?? npcFrameWidth;
    npcFrameHeight = npcFrames[0].height ?? npcFrameHeight;
  }
    
    atlasWidth = imgBitmap.width;
    atlasHeight = imgBitmap.height;
    console.log('Atlas loaded:', atlasWidth, 'x', atlasHeight);

    // Create texture from atlas
    const texture = device.createTexture({
      size: [imgBitmap.width, imgBitmap.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
      { source: imgBitmap },
      { texture: texture },
      [imgBitmap.width, imgBitmap.height]
    );

    // Create sampler
    spriteSampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
    });

    spriteTextureView = texture.createView();

    const uniformBufferSize = 12 * 4;
    characterUniformBuffers = Array.from({ length: MAX_CHARACTERS }, () =>
      device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    );

    characterBindGroups = characterUniformBuffers.map((buffer) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: spriteSampler },
          { binding: 1, resource: spriteTextureView },
          { binding: 2, resource: { buffer } },
        ],
      })
    );

    // Create tile rendering pipeline
    tilePipeline = device.createRenderPipeline({
      label: 'tile pipeline',
      layout: 'auto',
      vertex: {
        entryPoint: 'tile_vs',
        module,
        buffers: [
          {
            arrayStride: 24, // 6 floats: tilePos(2) + frameRect(4)
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, // tile position
              { shaderLocation: 1, offset: 8, format: 'float32x4' }, // frame rect
            ],
          },
        ],
      },
      fragment: {
        entryPoint: 'tile_fs',
        module,
        targets: [{
          format: presentationFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }],
      },
    });

    // Create tile globals uniform buffer
    tileGlobalsBuffer = device.createBuffer({
      size: 48, // 12 floats minimum for WebGPU
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    const tileGlobals = new Float32Array(12);
    tileGlobals[0] = atlasWidth;
    tileGlobals[1] = atlasHeight;
    tileGlobals[2] = GAME_WIDTH;
    tileGlobals[3] = GAME_HEIGHT;
    for (let i = 4; i < 12; i++) {
      tileGlobals[i] = 0.0;
    }
    device.queue.writeBuffer(tileGlobalsBuffer, 0, tileGlobals);

    // Create tile bind group
    tileBindGroup = device.createBindGroup({
      layout: tilePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: spriteSampler },
        { binding: 1, resource: spriteTextureView },
        { binding: 2, resource: { buffer: tileGlobalsBuffer } },
      ],
    });

    atlasLoaded = true;
    console.log('WebGPU initialized');
    return true;
  } catch(error) {
    console.error('WebGPU initialization failed:', error);
    return false;
  }
}

async function initializeDevTools() {
  if (!DEV_TOOLS_ENABLED) {
    const editorUI = document.getElementById('editor-ui');
    if (editorUI) {
      editorUI.remove();
    }
    devToolsInitialized = true;
    return;
  }

  if (!mapManager) {
    return;
  }

  if (devToolsInitialized) {
    if (levelEditor && typeof levelEditor.setMapManager === 'function') {
      levelEditor.setMapManager(mapManager);
      updateEditorStatus();
    }
    return;
  }

  const [editorModule, paletteModule] = await Promise.all([
    import('./level-editor.js'),
    import('./palette.js'),
  ]);
  const { LevelEditor } = editorModule;
  const { EditorPalette } = paletteModule;

  levelEditor = new LevelEditor(canvas, mapManager, rebuildCurrentRoomTiles, {
    tileSize: TILE_WIDTH,
    statusUpdateCallback: updateEditorStatus,
    onNpcClick: handleNpcEditorClick,
    tileDefinitions: Array.isArray(atlasData?.tiles) ? atlasData.tiles : [],
  });

  const paletteRoot = document.getElementById('palette-root');
  if (paletteRoot) {
  const npcFrame = Array.isArray(atlasData?.[NPC_ANIMATION]) ? atlasData[NPC_ANIMATION][0] : null;
    editorPalette = new EditorPalette(paletteRoot, {
      atlasImageUrl: ATLAS_IMAGE_URL.href,
      tiles: Array.isArray(atlasData?.tiles) ? atlasData.tiles : [],
      npcFrame,
      onModeChange: (mode) => {
        if (levelEditor) {
          levelEditor.setEditMode(mode, { silent: true, force: true });
          updateEditorStatus();
        }
      },
      onTileSelect: (tile) => {
        if (levelEditor) {
          levelEditor.setSelectedTile(tile.id, { info: tile, silent: true });
          updateEditorStatus();
        }
      },
      onNpcSelect: (npc) => {
        if (levelEditor) {
          levelEditor.setSelectedNpc(npc.id, { label: npc.label, silent: true });
          levelEditor.setEditMode('npcs', { silent: true, force: true });
          updateEditorStatus();
        }
      }
    });

    levelEditor.attachPalette(editorPalette);
  }

  devToolsInitialized = true;
  updateEditorStatus();
  console.log('Level editor initialized (dev tools enabled)');
}

// Build tile instance buffer for current room
function rebuildCurrentRoomTiles() {
  if (!mapManager || !device || !atlasData) return;

  const map = mapManager.getCurrentMap();
  if (!map || !Array.isArray(map.tileData)) {
    console.warn(`No tile data for room (${currentRoomX}, ${currentRoomY})`);
    return;
  }
  const tileData = map.tileData;
  const tiles = atlasData.tiles;
  const tileLookup = new Map(tiles.map((t) => [t.id, t]));

  // Send tile data to WASM for collision detection
  if (wasm && wasm.SetTileData) {
    // Flatten the 2D array into a 1D array
    const flatTiles = new Int32Array(ROOM_TILE_COLS * ROOM_TILE_ROWS);
    for (let row = 0; row < tileData.length && row < ROOM_TILE_ROWS; row++) {
      for (let col = 0; col < tileData[row].length && col < ROOM_TILE_COLS; col++) {
        flatTiles[row * ROOM_TILE_COLS + col] = tileData[row][col];
      }
    }

    // Allocate memory in WASM, copy data, call function
    // Use a safe memory offset that won't conflict with game memory
    const memOffset = 512 * 1024; // 512KB offset
    const tilePtr = memOffset;
    const memory = new Int32Array(wasm.memory.buffer);
    for (let i = 0; i < flatTiles.length; i++) {
      memory[(tilePtr / 4) + i] = flatTiles[i];
    }

    wasm.SetTileData(tilePtr, ROOM_TILE_COLS, ROOM_TILE_ROWS);

    // Debug: Verify tiles were received correctly in WASM
  }

  sendCurrentRoomNpcData();
  
  // Build instance data: each tile is 6 floats (x, y, frameX, frameY, frameW, frameH)
  const instances = [];
  
  const maxRows = Math.min(tileData.length, ROOM_TILE_ROWS);
  for (let row = 0; row < maxRows; row++) {
    const maxCols = Math.min(tileData[row].length, ROOM_TILE_COLS);
    for (let col = 0; col < maxCols; col++) {
      const tileId = tileData[row][col];
      if (tileId === 0) continue; // Skip empty tiles
      
      const tileInfo = tileLookup.get(tileId);
      if (!tileInfo) continue;
      
      const x = col * TILE_WIDTH;
      const y = row * TILE_HEIGHT;
      
      instances.push(
        x, y,  // tile position
        tileInfo.x, tileInfo.y, tileInfo.width, tileInfo.height  // frame rect
      );
    }
  }

  // Render a visual seam using the next room's top row while keeping collisions unchanged
  if (verticalRemainder > 0) {
    const partialHeight = verticalRemainder;
    const nextRoom = mapManager.getRoom(currentRoomX, currentRoomY + 1);
    if (nextRoom && nextRoom.length > 0) {
      const nextRow = nextRoom[0] || [];
      const partialY = ROOM_TILE_ROWS * TILE_HEIGHT;
      const maxCols = Math.min(nextRow.length, ROOM_TILE_COLS);
      for (let col = 0; col < maxCols; col++) {
        const tileId = nextRow[col] ?? 0;
        if (tileId === 0) continue;
        const tileInfo = tileLookup.get(tileId);
        if (!tileInfo) continue;
        const x = col * TILE_WIDTH;
        instances.push(
          x, partialY,
          tileInfo.x, tileInfo.y, tileInfo.width, partialHeight
        );
      }
    }
  }
  
  tileInstanceCount = instances.length / 6;
  
  if (tileInstanceCount > 0) {
    const instanceData = new Float32Array(instances);
    
    if (tileInstanceBuffer) {
      tileInstanceBuffer.destroy();
    }
    
    tileInstanceBuffer = device.createBuffer({
      size: instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    
    device.queue.writeBuffer(tileInstanceBuffer, 0, instanceData);
  }
  
  updateEditorStatus();
}

function sendCurrentRoomNpcData() {
  if (!mapManager || !wasm || !wasm.SetNpcData) {
    return;
  }

  if (!wasm.memory || !wasm.memory.buffer) {
    return;
  }

  const npcList = mapManager.getCurrentNpcs ? mapManager.getCurrentNpcs() : [];
  const count = Math.min(npcList.length, MAX_NPCS_PER_ROOM);
  if (npcList.length > MAX_NPCS_PER_ROOM) {
    console.warn(`NPC list truncated to ${MAX_NPCS_PER_ROOM} entries for room (${currentRoomX}, ${currentRoomY}).`);
  }
  const npcBuffer = new Int32Array(wasm.memory.buffer, NPC_MEMORY_OFFSET, MAX_NPCS_PER_ROOM * 2);
  npcBuffer.fill(0);

  for (let i = 0; i < count; i++) {
    const spawn = npcList[i] || { col: 0, row: 0 };
    npcBuffer[i * 2] = spawn.col ?? 0;
    npcBuffer[i * 2 + 1] = spawn.row ?? 0;
  }

  wasm.SetNpcData(currentRoomX, currentRoomY, NPC_MEMORY_OFFSET, count);
  lastRoomSent = `${currentRoomX},${currentRoomY}`;
  lastNpcCount = count;
  if (DEV_TOOLS_ENABLED) {
    let wasmCount = -1;
    if (typeof __educeWasm !== 'undefined' && __educeWasm.GetNpcCount) {
      wasmCount = __educeWasm.GetNpcCount();
    }
    console.log(`Sent ${count} NPC spawns to WASM for room (${currentRoomX}, ${currentRoomY}) -> wasm reports ${wasmCount}`);
  }
}

function getLevelProgress(levelId) {
  let progress = levelProgress.get(levelId);
  if (!progress) {
    progress = {
      unlocked: false,
      secretsFound: new Set(),
    };
    levelProgress.set(levelId, progress);
  }
  return progress;
}

function initializeLevelProgress() {
  LEVELS.forEach((level) => {
    const progress = getLevelProgress(level.id);
    progress.unlocked = !!level.initiallyUnlocked;
    if (!(progress.secretsFound instanceof Set)) {
      progress.secretsFound = new Set(progress.secretsFound || []);
    }
  });
  applyLevelDoorStates();
  updateLevelHud();
  updateLevelMenu();
  renderHubLevels();
}

function applyLevelDoorStates() {
  const targetWorld = mapManager?.world ?? baseWorldData;
  if (!targetWorld || !Array.isArray(targetWorld.rooms)) {
    return;
  }

  let needsRefresh = false;

  LEVELS.forEach((level) => {
    if (!level.hubDoor) {
      return;
    }
    const progress = getLevelProgress(level.id);
    const { room, tiles, closedTile = 24 } = level.hubDoor;
    const roomData = targetWorld.rooms?.[room.y]?.[room.x];
    if (!Array.isArray(roomData)) {
      return;
    }

    const replacement = progress.unlocked ? 0 : closedTile;
    tiles.forEach(({ row, col }) => {
      if (row >= 0 && row < roomData.length) {
        const rowData = roomData[row];
        if (Array.isArray(rowData) && col >= 0 && col < rowData.length) {
          if (rowData[col] !== replacement) {
            rowData[col] = replacement;
            if (room.x === mapManager?.currentRoomX && room.y === mapManager?.currentRoomY) {
              needsRefresh = true;
            }
          }
        }
      }
    });
  });

  if (needsRefresh && platformReady) {
    rebuildCurrentRoomTiles();
  }
}

function updateLevelHud() {
  if (!levelHud) {
    return;
  }

  if (currentLevelId) {
    const level = LEVEL_LOOKUP.get(currentLevelId);
    const progress = getLevelProgress(currentLevelId);
    levelHud.hidden = false;
    if (levelHudName) {
      levelHudName.textContent = level?.name ?? 'Unknown Expedition';
    }
    if (levelHudProgress && level) {
      levelHudProgress.textContent = `Secrets: ${progress.secretsFound.size}/${level.secrets.length}`;
    }
  } else {
    levelHud.hidden = false;
    if (levelHudName) {
      levelHudName.textContent = 'Sanctuary Hub';
    }
    if (levelHudProgress) {
      const unlockedCount = LEVELS.reduce((count, lvl) => count + (getLevelProgress(lvl.id).unlocked ? 1 : 0), 0);
      levelHudProgress.textContent = `Unlocked Expeditions: ${unlockedCount}/${LEVELS.length}`;
    }
  }
}

function updateLevelMenu() {
  if (!levelMenuList) return;

  levelMenuList.innerHTML = '';
  LEVELS.forEach((level) => {
    const progress = getLevelProgress(level.id);
    const item = document.createElement('div');
    item.className = 'menu-level';
    if (!progress.unlocked) {
      item.dataset.state = 'locked';
    } else if (progress.secretsFound.size >= level.secrets.length) {
      item.dataset.state = 'cleared';
    } else {
      item.dataset.state = 'pending';
    }

    const title = document.createElement('div');
    title.className = 'menu-level__title';
    title.textContent = level.name;

    const status = document.createElement('div');
    status.className = 'menu-level__status';
    if (!progress.unlocked) {
      status.textContent = 'Locked';
    } else {
      status.textContent = `Secrets ${progress.secretsFound.size}/${level.secrets.length}`;
    }

    item.appendChild(title);
    item.appendChild(status);
    levelMenuList.appendChild(item);
  });
}

function renderHubLevels() {
  if (!hubLevelList) return;

  hubLevelList.innerHTML = '';

  LEVELS.forEach((level) => {
    const progress = getLevelProgress(level.id);
    const secretsTotal = level.secrets?.length ?? 0;
    const secretsFound = progress.secretsFound.size;

    const card = document.createElement('div');
    card.className = 'hub-level-card';

    if (!progress.unlocked) {
      card.dataset.state = 'locked';
    } else if (secretsFound >= secretsTotal && secretsTotal > 0) {
      card.dataset.state = 'cleared';
    } else {
      card.dataset.state = 'pending';
    }

    const title = document.createElement('div');
    title.className = 'hub-level-card__name';
    title.textContent = level.name;

    const status = document.createElement('div');
    status.className = 'hub-level-card__status';
    status.textContent = progress.unlocked
      ? `Secrets ${secretsFound}/${secretsTotal}`
      : 'Locked - uncover more secrets';

    const desc = document.createElement('p');
    desc.className = 'hub-level-card__desc';
    desc.textContent = level.description ?? 'An unexplored region awaiting discovery.';

    const button = document.createElement('button');
    button.type = 'button';
    if (!progress.unlocked) {
      button.textContent = 'Locked';
      button.disabled = true;
    } else if (secretsFound >= secretsTotal && secretsTotal > 0) {
      button.textContent = 'Replay Expedition';
    } else {
      button.textContent = 'Enter Expedition';
    }

    if (progress.unlocked) {
      button.addEventListener('click', () => {
        void enterLevel(level.id);
      });
    }

    card.appendChild(title);
    card.appendChild(status);
    card.appendChild(desc);
    card.appendChild(button);
    hubLevelList.appendChild(card);
  });
}

function setHudMessage(message, duration = 3) {
  if (!levelHudStatus) return;
  levelHudStatus.textContent = message;
  levelHudStatus.dataset.visible = 'true';
  hudMessageTimer = duration;
}

function clearHudMessage() {
  if (levelHudStatus) {
    levelHudStatus.textContent = '';
    levelHudStatus.dataset.visible = 'false';
  }
  hudMessageTimer = 0;
}

function showHubScreen() {
  gameState = GAME_STATE_HUB;
  gameActive = false;
  currentLevelId = null;
  if (gameContainer) {
    gameContainer.classList.add('is-hidden');
  }
  if (canvas) {
    canvas.classList.add('is-hidden');
  }
  if (hubScreen) {
    hubScreen.classList.remove('is-hidden');
  }
  if (editorContainer) {
    editorContainer.classList.add('is-hidden');
  }
  const gameMenu = document.getElementById('game-menu');
  if (gameMenu) {
    gameMenu.style.display = 'none';
  }
  if (levelEditor && levelEditor.isEditorMode) {
    levelEditor.toggleEditorMode();
  }
  clearHudMessage();
  updateLevelHud();
  renderHubLevels();
  updateLevelMenu();
  updateEditorStatus();
}

async function enterLevel(levelId) {
  const level = LEVEL_LOOKUP.get(levelId);
  if (!level) {
    console.warn(`Unknown level id: ${levelId}`);
    return;
  }

  const progress = getLevelProgress(level.id);
  progress.unlocked = true;

  try {
    await ensurePlatformReady();
  } catch (error) {
    console.error('Unable to initialize platform:', error);
    setHudMessage('Failed to load expedition. See console for details.', 4);
    showHubScreen();
    return;
  }

  if (!mapManager) {
    mapManager = new MapManager(baseWorldData);
  }

  currentLevelId = level.id;
  currentRoomX = level.entryRoom.x;
  currentRoomY = level.entryRoom.y;
  mapManager.currentRoomX = currentRoomX;
  mapManager.currentRoomY = currentRoomY;
  mapManager.ensureNpcGrid();
  initialNpcSyncPending = true;
  lastRoomSent = '0,0';
  lastNpcCount = 0;

  if (wasm && typeof wasm.ResetGameState === 'function') {
    wasm.ResetGameState(currentRoomX, currentRoomY);
  }

  rebuildCurrentRoomTiles();
  sendCurrentRoomNpcData();

  if (!devToolsInitialized || !levelEditor) {
    await initializeDevTools();
  } else if (levelEditor && typeof levelEditor.setMapManager === 'function') {
    levelEditor.setMapManager(mapManager);
  }

  if (DEV_TOOLS_ENABLED && editorContainer) {
    editorContainer.classList.remove('is-hidden');
  }

  if (hubScreen) {
    hubScreen.classList.add('is-hidden');
  }
  if (gameContainer) {
    gameContainer.classList.remove('is-hidden');
  }
  if (canvas) {
    canvas.classList.remove('is-hidden');
  }

  gameState = GAME_STATE_LEVEL;
  gameActive = true;
  updateLevelHud();
  updateLevelMenu();
  updateEditorStatus();
  setHudMessage(`${level.name} - Expedition Start`, 2.5);
}

function returnToHub(options = {}) {
  if (gameState !== GAME_STATE_LEVEL) {
    showHubScreen();
    return;
  }

  gameActive = false;
  gameState = GAME_STATE_HUB;
  currentLevelId = null;

  if (mapManager && baseWorldData) {
    mapManager.currentRoomX = baseWorldData.startRoomX ?? 0;
    mapManager.currentRoomY = baseWorldData.startRoomY ?? 0;
    currentRoomX = mapManager.currentRoomX;
    currentRoomY = mapManager.currentRoomY;
    mapManager.ensureNpcGrid();
    applyLevelDoorStates();
    if (platformReady) {
      rebuildCurrentRoomTiles();
    }
  }

  showHubScreen();
  if (options.message) {
    setHudMessage(options.message, options.duration ?? 3);
  }
}

function createFallbackWorld() {
  const roomWidth = ROOM_TILE_COLS;
  const roomHeight = ROOM_TILE_ROWS;
  const room = Array.from({ length: roomHeight }, () => Array(roomWidth).fill(0));
  return {
    worldWidth: 1,
    worldHeight: 1,
    roomWidth,
    roomHeight,
    startRoomX: 0,
    startRoomY: 0,
    rooms: [[room]],
    npcs: [[[]]],
  };
}

function handleRoomChanged() {
  if (gameState === GAME_STATE_LEVEL) {
    updateLevelHud();
    return;
  }

  const level = LEVEL_BY_ROOM.get(`${currentRoomX},${currentRoomY}`) || null;
  const previousLevel = currentLevelId;
  currentLevelId = level ? level.id : null;
  if (level && !getLevelProgress(level.id).unlocked) {
    const progress = getLevelProgress(level.id);
    progress.unlocked = true;
    updateLevelMenu();
    renderHubLevels();
    setHudMessage(`${level.name} discovered!`);
  }

  if (previousLevel !== currentLevelId) {
    updateLevelHud();
  }
}

function unlockLevel(levelId, announce = true) {
  const progress = getLevelProgress(levelId);
  if (progress.unlocked) {
    return;
  }
  progress.unlocked = true;
  if (announce) {
    const level = LEVEL_LOOKUP.get(levelId);
    if (level) {
      setHudMessage(`Hub access opened: ${level.name}`);
    }
  }
  applyLevelDoorStates();
  updateLevelHud();
  updateLevelMenu();
  renderHubLevels();
}

function collectSecret(levelId, secretIndex) {
  const level = LEVEL_LOOKUP.get(levelId);
  if (!level) return;
  const progress = getLevelProgress(levelId);
  if (progress.secretsFound.has(secretIndex)) return;
  progress.secretsFound.add(secretIndex);

  const secret = level.secrets?.[secretIndex];
  if (secret && mapManager?.world?.rooms) {
    const roomData = mapManager.world.rooms?.[currentRoomY]?.[currentRoomX];
    if (Array.isArray(roomData)) {
      const rowData = roomData[secret.row];
      if (Array.isArray(rowData) && secret.col >= 0 && secret.col < rowData.length) {
        rowData[secret.col] = 0;
        if (secret.room.x === currentRoomX && secret.room.y === currentRoomY) {
          rebuildCurrentRoomTiles();
        }
      }
    }
  }

  setHudMessage(`Secret found! ${progress.secretsFound.size}/${level.secrets.length}`);
  updateLevelHud();
  updateLevelMenu();
  renderHubLevels();

  if (progress.secretsFound.size >= level.secrets.length) {
    level.unlocks?.forEach((nextId) => unlockLevel(nextId));
  }
}

function checkSecretCollection() {
  if (!wasm || !currentLevelId) return;
  if (typeof wasm.GetPlayerX !== 'function' || typeof wasm.GetPlayerY !== 'function') return;

  const level = LEVEL_LOOKUP.get(currentLevelId);
  if (!level) return;

  const progress = getLevelProgress(currentLevelId);
  if (!level.secrets || progress.secretsFound.size >= level.secrets.length) {
    return;
  }

  const playerX = wasm.GetPlayerX();
  const playerY = wasm.GetPlayerY();
  const playerCol = Math.floor((playerX + TILE_WIDTH * 0.5) / TILE_WIDTH);
  const playerRow = Math.floor((playerY + TILE_HEIGHT * 0.5) / TILE_HEIGHT);

  level.secrets.forEach((secret, index) => {
    if (progress.secretsFound.has(index)) {
      return;
    }
    const radius = secret.radius ?? 0;
    if (Math.abs(playerCol - secret.col) <= radius && Math.abs(playerRow - secret.row) <= radius) {
      collectSecret(level.id, index);
    }
  });
}

function loadWorldFromWasm() {
  if (!wasm || !memory) {
    throw new Error('WASM module not initialized before loading world data.');
  }
  if (typeof wasm.GetWorldDataHeaderPointer !== 'function' ||
      typeof wasm.GetWorldTileDataPointer !== 'function') {
    throw new Error('Current WASM build does not expose world data accessors.');
  }

  const headerPtr = wasm.GetWorldDataHeaderPointer();
  const headerView = new Uint16Array(memory.buffer, headerPtr, 6);
  const [
    worldWidth,
    worldHeight,
    roomWidth,
    roomHeight,
    startRoomX,
    startRoomY
  ] = headerView;

  const expectedTiles = worldWidth * worldHeight * roomWidth * roomHeight;
  const tilePtr = wasm.GetWorldTileDataPointer();
  const reportedCount = (typeof wasm.GetWorldTileCount === 'function')
    ? wasm.GetWorldTileCount()
    : expectedTiles;
  const actualCount = Math.min(reportedCount, expectedTiles);
  const tileView = new Uint16Array(memory.buffer, tilePtr, actualCount);

  const rooms = [];
  let cursor = 0;
  for (let roomY = 0; roomY < worldHeight; roomY++) {
    const roomRow = [];
    for (let roomX = 0; roomX < worldWidth; roomX++) {
      const room = [];
      for (let tileRow = 0; tileRow < roomHeight; tileRow++) {
        const rowData = new Array(roomWidth);
        for (let tileCol = 0; tileCol < roomWidth; tileCol++, cursor++) {
          rowData[tileCol] = cursor < actualCount ? tileView[cursor] : 0;
        }
        room.push(rowData);
      }
      roomRow.push(room);
    }
    rooms.push(roomRow);
  }

  if (cursor < expectedTiles && DEV_TOOLS_ENABLED) {
    console.warn(`World tile data truncated: expected ${expectedTiles}, got ${actualCount}`);
  }

  return {
    worldWidth,
    worldHeight,
    roomWidth,
    roomHeight,
    startRoomX,
    startRoomY,
    rooms
  };
}

function reconcileWithEmbeddedWorld(editorWorld) {
  let embedded;
  try {
    embedded = loadWorldFromWasm();
  } catch (err) {
    console.warn('Unable to load embedded world metadata; using editor JSON as-is.', err);
    return sanitizeEditorWorld(editorWorld);
  }

  return sanitizeEditorWorld(editorWorld, embedded);
}

function sanitizeEditorWorld(editorWorld, embeddedFallback = null) {
  const fallback = embeddedFallback ?? createFallbackWorld();
  const source = editorWorld ?? {};

  const worldWidth = Math.max(1, Number(source.worldWidth ?? fallback.worldWidth) || fallback.worldWidth || 1);
  const worldHeight = Math.max(1, Number(source.worldHeight ?? fallback.worldHeight) || fallback.worldHeight || 1);
  const roomWidth = Math.max(1, Number(source.roomWidth ?? fallback.roomWidth) || fallback.roomWidth || ROOM_TILE_COLS);
  const roomHeight = Math.max(1, Number(source.roomHeight ?? fallback.roomHeight) || fallback.roomHeight || ROOM_TILE_ROWS);

  function getBaseline(roomY, roomX, tileRow, tileCol) {
    const rows = fallback.rooms;
    const roomRow = rows?.[roomY];
    const room = roomRow?.[roomX];
    const row = room?.[tileRow];
    const value = row?.[tileCol];
    return Number.isInteger(value) ? value : 0;
  }

  const normalizedRooms = Array.from({ length: worldHeight }, (_, roomY) => {
    const sourceRow = Array.isArray(source.rooms?.[roomY]) ? source.rooms[roomY] : [];
    return Array.from({ length: worldWidth }, (_, roomX) => {
      const sourceRoom = Array.isArray(sourceRow?.[roomX]) ? sourceRow[roomX] : [];
      return Array.from({ length: roomHeight }, (_, tileRow) => {
        const sourceTileRow = Array.isArray(sourceRoom?.[tileRow]) ? sourceRoom[tileRow] : [];
        const rowData = new Array(roomWidth);
        for (let tileCol = 0; tileCol < roomWidth; tileCol++) {
          const value = sourceTileRow[tileCol];
          rowData[tileCol] = Number.isInteger(value)
            ? value
            : getBaseline(roomY, roomX, tileRow, tileCol);
        }
        return rowData;
      });
    });
  });

  const startRoomX = clampToRange(
    Number.isInteger(source.startRoomX) ? source.startRoomX : fallback.startRoomX ?? 0,
    0,
    worldWidth - 1
  );
  const startRoomY = clampToRange(
    Number.isInteger(source.startRoomY) ? source.startRoomY : fallback.startRoomY ?? 0,
    0,
    worldHeight - 1
  );

  const normalizedNpcs = Array.from({ length: worldHeight }, (_, roomY) => {
    const sourceRow = Array.isArray(source.npcs?.[roomY]) ? source.npcs[roomY] : [];
    return Array.from({ length: worldWidth }, (_, roomX) => {
      const list = Array.isArray(sourceRow?.[roomX]) ? sourceRow[roomX] : [];
      return list
        .filter((npc) => npc && Number.isInteger(npc.row) && Number.isInteger(npc.col))
        .map((npc) => ({ ...npc }));
    });
  });

  return {
    worldWidth,
    worldHeight,
    roomWidth,
    roomHeight,
    startRoomX,
    startRoomY,
    rooms: normalizedRooms,
    npcs: normalizedNpcs,
  };
}

function clampToRange(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function handleNpcEditorClick({ worldX, worldY }) {
  if (!mapManager || !wasm) {
    return false;
  }

  const { GetNpcCount, GetNpcX, GetNpcY, GetNpcFrame } = wasm;
  if (typeof GetNpcCount !== 'function' || typeof GetNpcX !== 'function' || typeof GetNpcY !== 'function') {
    return false;
  }

  const npcCount = GetNpcCount();
  if (!npcCount || npcCount <= 0) {
    return false;
  }

  const npcFrames = Array.isArray(atlasData?.[NPC_ANIMATION]) ? atlasData[NPC_ANIMATION] : [];
  const defaultWidth = npcFrames[0]?.width ?? npcFrameWidth;
  const defaultHeight = npcFrames[0]?.height ?? npcFrameHeight;

  for (let index = npcCount - 1; index >= 0; index--) {
    const npcX = GetNpcX(index);
    const npcY = GetNpcY(index);
    let width = defaultWidth;
    let height = defaultHeight;

    if (npcFrames.length > 0 && typeof GetNpcFrame === 'function') {
      const frame = npcFrames[GetNpcFrame(index) % npcFrames.length];
      if (frame) {
        width = frame.width ?? width;
        height = frame.height ?? height;
      }
    }

    if (worldX >= npcX && worldX <= npcX + width &&
        worldY >= npcY && worldY <= npcY + height) {
      const removed = mapManager.removeNpcByIndex(mapManager.currentRoomX, mapManager.currentRoomY, index);
      if (removed) {
        rebuildCurrentRoomTiles();
        return true;
      }
      return false;
    }
  }

  return false;
}

// Update editor status UI
function updateEditorStatus() {
  const editorContainer = document.getElementById('editor-container');
  if (!DEV_TOOLS_ENABLED) {
    if (editorContainer) {
      editorContainer.style.display = 'none';
    }
    if (hubScreen && gameState === GAME_STATE_HUB) {
      hubScreen.classList.remove('is-hidden');
    }
    return;
  }

  if (levelEditor && levelEditor.isEditorMode) {
    if (editorContainer) {
      editorContainer.style.display = 'block';
    }
    if (hubScreen) {
      hubScreen.classList.add('is-hidden');
    }
    if (gameContainer) {
      gameContainer.classList.remove('is-hidden');
    }
    if (canvas) {
      canvas.classList.remove('is-hidden');
    }
    return;
  }

  if (editorContainer) {
    editorContainer.style.display = 'none';
  }
  if (gameState === GAME_STATE_HUB) {
    if (hubScreen) {
      hubScreen.classList.remove('is-hidden');
    }
    if (gameContainer) {
      gameContainer.classList.add('is-hidden');
    }
    if (canvas) {
      canvas.classList.add('is-hidden');
    }
  }
}

// Check for room changes
function checkRoomChange() {
  if (!wasm) return;
  
  const newRoomX = wasm.GetPlayerRoomX();
  const newRoomY = wasm.GetPlayerRoomY();

  if (initialNpcSyncPending) {
    if (mapManager) {
      mapManager.currentRoomX = currentRoomX;
      mapManager.currentRoomY = currentRoomY;
      rebuildCurrentRoomTiles();
    }
    initialNpcSyncPending = false;
  }
  
  if (newRoomX !== currentRoomX || newRoomY !== currentRoomY) {
    currentRoomX = newRoomX;
    currentRoomY = newRoomY;
    
    if (mapManager) {
      mapManager.currentRoomX = currentRoomX;
      mapManager.currentRoomY = currentRoomY;
      rebuildCurrentRoomTiles();
    }
    
    console.log(`Room changed to (${currentRoomX}, ${currentRoomY})`);
    handleRoomChanged();
  }
}

function renderScene() {
  if (!atlasLoaded || !wasm || !device) return;

  const playerFrames = atlasData[PLAYER_ANIMATION];
  if (!Array.isArray(playerFrames) || playerFrames.length === 0) return;

  const npcFrames = Array.isArray(atlasData[NPC_ANIMATION]) && atlasData[NPC_ANIMATION].length > 0
    ? atlasData[NPC_ANIMATION]
    : playerFrames;

  const characters = [];

  const getNpcCount = wasm.GetNpcCount;
  const getNpcX = wasm.GetNpcX;
  const getNpcY = wasm.GetNpcY;
  const getNpcFrame = wasm.GetNpcFrame;
  const getNpcFacing = wasm.GetNpcFacing;

  if (typeof getNpcCount === 'function' && typeof getNpcX === 'function' && typeof getNpcY === 'function') {
    const npcCount = getNpcCount();
    for (let i = 0; i < npcCount; i++) {
      const frameIndex = typeof getNpcFrame === 'function' ? getNpcFrame(i) : 0;
      const frameSet = npcFrames.length > 0 ? npcFrames : playerFrames;
      const frame = frameSet[frameIndex % frameSet.length];
      characters.push({
        x: getNpcX(i),
        y: getNpcY(i),
        facing: typeof getNpcFacing === 'function' ? getNpcFacing(i) : 1,
        frame
      });
    }
  }

  const playerFrameIndex = wasm.GetCurrentFrame();
  const playerFrame = playerFrames[playerFrameIndex % playerFrames.length];
  characters.push({
    x: wasm.GetPlayerX(),
    y: wasm.GetPlayerY(),
    facing: wasm.GetPlayerFacing(),
    frame: playerFrame
  });

  const encoder = device.createCommandEncoder({ label: 'render-encoder' });
  const pass = encoder.beginRenderPass({
    label: 'render-pass',
    colorAttachments: [
      {
        view: gpuContext.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: [0.39, 0.58, 0.93, 1],
        storeOp: 'store',
      },
    ],
  });

  if (tileInstanceCount > 0 && tileInstanceBuffer) {
    pass.setPipeline(tilePipeline);
    pass.setBindGroup(0, tileBindGroup);
    pass.setVertexBuffer(0, tileInstanceBuffer);
    pass.draw(6, tileInstanceCount);
  }

  if (characters.length > 0) {
    pass.setPipeline(pipeline);
    const maxRenderable = Math.min(characters.length, characterBindGroups.length);
    if (characters.length > maxRenderable && DEV_TOOLS_ENABLED) {
      console.warn(`Character render capped at ${maxRenderable} instances (have ${characters.length})`);
    }

    for (let i = 0; i < maxRenderable; i++) {
      const character = characters[i];
      const frame = character.frame;
      if (!frame) continue;

      characterUniformData[0] = frame.x;
      characterUniformData[1] = frame.y;
      characterUniformData[2] = frame.width;
      characterUniformData[3] = frame.height;
      characterUniformData[4] = atlasWidth;
      characterUniformData[5] = atlasHeight;
      characterUniformData[6] = character.x;
      characterUniformData[7] = character.y;
      characterUniformData[8] = GAME_WIDTH;
      characterUniformData[9] = GAME_HEIGHT;
      characterUniformData[10] = character.facing;
      characterUniformData[11] = 0.0;

      device.queue.writeBuffer(characterUniformBuffers[i], 0, characterUniformData);
      pass.setBindGroup(0, characterBindGroups[i]);
      pass.draw(6);
    }
  }

  pass.end();
  device.queue.submit([encoder.finish()]);
}

//
// WASM initialization
//

async function initializePlatform() {
  if (platformReady) {
    return;
  }

  console.log('Loading WASM...');
  const response = await fetch(WASM_URL);
  const { instance } = await WebAssembly.instantiateStreaming(response);

  wasm = instance.exports;
  globalThis.__educeWasm = wasm;
  memory = wasm.memory;

  console.log('WASM loaded');

  wasm.WebInit(GAME_WIDTH, GAME_HEIGHT, 4);
  console.log('Game initialized');

  const gpuOk = await initWebGPU();
  if (!gpuOk) {
    throw new Error('WebGPU required but not available');
  }

  lastTime = performance.now();
  gameLoop(lastTime);

  document.addEventListener('click', () => {
    playMidiSong(true);
    setMasterVolume(0.3);
  }, { once: true });

  platformReady = true;
  console.log('Platform initialized and game loop started');
}

async function ensurePlatformReady() {
  if (platformReady) {
    return;
  }
  if (!platformInitPromise) {
    platformInitPromise = initializePlatform().catch((error) => {
      platformInitPromise = null;
      throw error;
    });
  }
  await platformInitPromise;
}

// Menu System Event Handlers
function setupMenuHandlers() {
  const gameMenu = document.getElementById('game-menu');
  const resumeBtn = document.getElementById('resume-btn');
  const exitLevelBtn = document.getElementById('exit-level-btn');
  const playMidiBtn = document.getElementById('play-midi');
  const stopMidiBtn = document.getElementById('stop-midi');
  const bgmVolumeSlider = document.getElementById('bgm-volume');
  const bgmVolumeDisplay = document.getElementById('bgm-volume-display');
  const bgmVolUpBtn = document.getElementById('bgm-vol-up');
  const bgmVolDownBtn = document.getElementById('bgm-vol-down');
  const sfxVolumeSlider = document.getElementById('sfx-volume');
  const sfxVolumeDisplay = document.getElementById('sfx-volume-display');
  const sfxVolUpBtn = document.getElementById('sfx-vol-up');
  const sfxVolDownBtn = document.getElementById('sfx-vol-down');
  
  let isMenuOpen = false;

  // Apply initial slider values to audio system
  const initialBgmVolume = parseInt(bgmVolumeSlider.value, 10);
  const initialSfxVolume = parseInt(sfxVolumeSlider.value, 10);
  setBgmVolume(initialBgmVolume / 100);
  setSfxVolume(initialSfxVolume / 100);
  bgmVolumeDisplay.textContent = `BGM: ${initialBgmVolume}%`;
  sfxVolumeDisplay.textContent = `SFX: ${initialSfxVolume}%`;
  
  // Toggle menu with ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (gameState !== GAME_STATE_LEVEL) {
        return;
      }
      // Don't toggle menu if in editor mode
      if (levelEditor && levelEditor.isEditorMode) {
        return;
      }
      
      isMenuOpen = !isMenuOpen;
      gameMenu.style.display = isMenuOpen ? 'block' : 'none';
      if (isMenuOpen) {
        const currentBgm = Math.round(getBgmVolume() * 100);
        const currentSfx = Math.round(getSfxVolume() * 100);
        bgmVolumeSlider.value = currentBgm;
        sfxVolumeSlider.value = currentSfx;
        bgmVolumeDisplay.textContent = `BGM: ${currentBgm}%`;
        sfxVolumeDisplay.textContent = `SFX: ${currentSfx}%`;
        updateLevelMenu();
        if (exitLevelBtn) {
          exitLevelBtn.classList.remove('is-hidden');
        }
      }
      e.preventDefault();
    }
  });
  
  // Resume button
  resumeBtn.addEventListener('click', () => {
    isMenuOpen = false;
    gameMenu.style.display = 'none';
  });

  if (exitLevelBtn) {
    exitLevelBtn.addEventListener('click', () => {
      isMenuOpen = false;
      gameMenu.style.display = 'none';
      returnToHub();
    });
  }
  
  // Play music button
  playMidiBtn.addEventListener('click', () => {
    playMidiSong(true);
  });
  
  // Stop music button
  stopMidiBtn.addEventListener('click', () => {
    stopMidiSong();
  });
  
  // BGM Volume slider
  bgmVolumeSlider.addEventListener('input', (e) => {
    const volume = parseInt(e.target.value, 10);
    bgmVolumeDisplay.textContent = `BGM: ${volume}%`;
    setBgmVolume(volume / 100);
  });
  
  // BGM Volume + button
  bgmVolUpBtn.addEventListener('click', () => {
    let volume = parseInt(bgmVolumeSlider.value, 10);
    volume = Math.min(100, volume + 10);
    bgmVolumeSlider.value = volume;
    bgmVolumeDisplay.textContent = `BGM: ${volume}%`;
    setBgmVolume(volume / 100);
  });
  
  // BGM Volume - button
  bgmVolDownBtn.addEventListener('click', () => {
    let volume = parseInt(bgmVolumeSlider.value, 10);
    volume = Math.max(0, volume - 10);
    bgmVolumeSlider.value = volume;
    bgmVolumeDisplay.textContent = `BGM: ${volume}%`;
    setBgmVolume(volume / 100);
  });
  
  // SFX Volume slider
  sfxVolumeSlider.addEventListener('input', (e) => {
    const volume = parseInt(e.target.value, 10);
    sfxVolumeDisplay.textContent = `SFX: ${volume}%`;
    setSfxVolume(volume / 100);
  });
  
  // SFX Volume + button
  sfxVolUpBtn.addEventListener('click', () => {
    let volume = parseInt(sfxVolumeSlider.value, 10);
    volume = Math.min(100, volume + 10);
    sfxVolumeSlider.value = volume;
    sfxVolumeDisplay.textContent = `SFX: ${volume}%`;
    setSfxVolume(volume / 100);
  });
  
  // SFX Volume - button
  sfxVolDownBtn.addEventListener('click', () => {
    let volume = parseInt(sfxVolumeSlider.value, 10);
    volume = Math.max(0, volume - 10);
    sfxVolumeSlider.value = volume;
    sfxVolumeDisplay.textContent = `SFX: ${volume}%`;
    setSfxVolume(volume / 100);
  });
  
  console.log('Menu handlers initialized');
}

async function loadEditorWorldData() {
  try {
    const response = await fetch(WORLD_EDITOR_URL, { cache: 'no-store' });
    if (response.ok) {
      return await response.json();
    }
    console.warn(`Editor world JSON not available (${response.status}). Using fallback layout.`);
  } catch (error) {
    console.warn('Failed to fetch editor world JSON:', error);
  }
  return null;
}

async function bootstrap() {
  setupMenuHandlers();

  const editorWorld = await loadEditorWorldData();
  baseWorldData = sanitizeEditorWorld(editorWorld || {}, createFallbackWorld());

  mapManager = new MapManager(baseWorldData);
  mapManager.currentRoomX = baseWorldData.startRoomX ?? 0;
  mapManager.currentRoomY = baseWorldData.startRoomY ?? 0;
  mapManager.ensureNpcGrid();
  currentRoomX = mapManager.currentRoomX;
  currentRoomY = mapManager.currentRoomY;

  initializeLevelProgress();

  if (DEV_TOOLS_ENABLED) {
    try {
      await ensurePlatformReady();
      await initializeDevTools();
      rebuildCurrentRoomTiles();
    } catch (error) {
      console.error('Dev tools initialization failed:', error);
    }
  }

  showHubScreen();

  if (platformReady) {
    rebuildCurrentRoomTiles();
  }
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap game:', error);
  setHudMessage('Unable to load required resources.', 5);
});

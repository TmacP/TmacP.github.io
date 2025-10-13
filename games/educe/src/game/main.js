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

const horizontalAligned = (GAME_WIDTH % TILE_WIDTH) === 0;
const verticalRemainder = GAME_HEIGHT % TILE_HEIGHT;
if (!horizontalAligned || verticalRemainder !== 0) {
  console.warn(`Game resolution leaves ${verticalRemainder}px extra vertically; rendering will anchor tiles to the top and leave the remainder at the bottom.`);
}

const SHADER_URL = new URL('./shaders/shader.wgsl', import.meta.url);
const ATLAS_IMAGE_URL = new URL('../../assets/assets.png', import.meta.url);
const ATLAS_DATA_URL = new URL('../../assets/atlas.json', import.meta.url);
const WORLD_DATA_URL = new URL('../../assets/world.json', import.meta.url);
const WASM_URL = new URL('../../dist/main.wasm', import.meta.url);
const MAX_NPCS_PER_ROOM = 16;
const MAX_CHARACTERS = MAX_NPCS_PER_ROOM + 1;
const NPC_MEMORY_OFFSET = 600 * 1024;
const CHARACTER_ANIMATION = 'player_walk_left';
const characterUniformData = new Float32Array(12);
let characterFrameWidth = 32;
let characterFrameHeight = 32;

// Setup canvas
const canvas = document.getElementById('screen');

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
  
  updateGamepadInput();
  
  // Don't update game if in editor mode
  if (!levelEditor || !levelEditor.isEditorMode) {
    // Send input to WASM
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
    
    // Update game logic (C++ updates game state)
    wasm.WebUpdateAndRender(dt);
    
    // Check if player changed rooms
    checkRoomChange();
  }
  
  // Render with WebGPU
  if (device) {
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
  const characterFrames = atlasData?.[CHARACTER_ANIMATION];
  if (Array.isArray(characterFrames) && characterFrames.length > 0) {
    characterFrameWidth = characterFrames[0].width ?? characterFrameWidth;
    characterFrameHeight = characterFrames[0].height ?? characterFrameHeight;
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

    // Load world data
    const worldData = await fetch(WORLD_DATA_URL).then(r => r.json());
    mapManager = new MapManager(worldData);
    currentRoomX = worldData.startRoomX || 1;
    currentRoomY = worldData.startRoomY || 1;
    mapManager.currentRoomX = currentRoomX;
    mapManager.currentRoomY = currentRoomY;

    await initializeDevTools();

    // Build initial tile buffer
    rebuildCurrentRoomTiles();

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

  if (devToolsInitialized) {
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
    const npcFrame = Array.isArray(atlasData?.player_walk_left) ? atlasData.player_walk_left[0] : null;
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

function handleNpcEditorClick({ worldX, worldY }) {
  if (!mapManager || !wasm) {
    return false;
  }

  const { GetNpcCount, GetNpcX, GetNpcY } = wasm;
  if (typeof GetNpcCount !== 'function' || typeof GetNpcX !== 'function' || typeof GetNpcY !== 'function') {
    return false;
  }

  const npcCount = GetNpcCount();
  if (!npcCount || npcCount <= 0) {
    return false;
  }

  const width = characterFrameWidth;
  const height = characterFrameHeight;

  for (let index = npcCount - 1; index >= 0; index--) {
    const npcX = GetNpcX(index);
    const npcY = GetNpcY(index);
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
    return;
  }

  if (levelEditor && levelEditor.isEditorMode) {
    if (editorContainer) {
      editorContainer.style.display = 'block';
    }
    return;
  }

  if (editorContainer) {
    editorContainer.style.display = 'none';
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
  }
}

function renderScene() {
  if (!atlasLoaded || !wasm || !device) return;

  const frames = atlasData[CHARACTER_ANIMATION];
  if (!frames || frames.length === 0) return;

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
      const frame = frames[frameIndex % frames.length];
      characters.push({
        x: getNpcX(i),
        y: getNpcY(i),
        facing: typeof getNpcFacing === 'function' ? getNpcFacing(i) : 1,
        frame
      });
    }
  }

  const playerFrameIndex = wasm.GetCurrentFrame();
  const playerFrame = frames[playerFrameIndex % frames.length];
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

async function init() {
  try {
    console.log('Loading WASM...');
    
  const response = await fetch(WASM_URL);
    const { instance } = await WebAssembly.instantiateStreaming(response);
    
  wasm = instance.exports;
  globalThis.__educeWasm = wasm;
    memory = wasm.memory;
    
    console.log('WASM loaded');
    
    wasm.WebInit(GAME_WIDTH, GAME_HEIGHT, 4);
    console.log('Game initialized');
    
    // Initialize WebGPU
    const gpuOk = await initWebGPU();
    if (!gpuOk) {
      throw new Error('WebGPU required but not available');
    }
    
    lastTime = performance.now();
    gameLoop(lastTime);
    
    console.log('Game loop started');
    
    // Start background music on first user interaction
    document.addEventListener('click', () => {
      playMidiSong(true); // Loop enabled
      setMasterVolume(0.3); // Set volume to 30%
    }, { once: true });
    
    console.log('Click anywhere to start music');
  } catch(error) {
    console.error('Failed to initialize:', error);
    document.body.innerHTML = `<div style="color: white; padding: 20px;">
      <h1>Error loading game</h1>
      <pre>${error.message}</pre>
    </div>`;
  }
}

// Menu System Event Handlers
function setupMenuHandlers() {
  const gameMenu = document.getElementById('game-menu');
  const resumeBtn = document.getElementById('resume-btn');
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
      }
      e.preventDefault();
    }
  });
  
  // Resume button
  resumeBtn.addEventListener('click', () => {
    isMenuOpen = false;
    gameMenu.style.display = 'none';
  });
  
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

init();
setupMenuHandlers();

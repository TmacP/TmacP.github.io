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
  TILE_PIXEL_HEIGHT as CONFIG_TILE_PIXEL_HEIGHT,
  WORLD_WIDTH as CONFIG_WORLD_WIDTH,
  WORLD_HEIGHT as CONFIG_WORLD_HEIGHT
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
const MAX_LEVEL_SCREENS_WIDE = Math.max(1, Number(CONFIG_WORLD_WIDTH) || 1);
const MAX_LEVEL_SCREENS_TALL = Math.max(1, Number(CONFIG_WORLD_HEIGHT) || 1);

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
const EXIT_TILE_ID = 250;
const LEVEL_MANIFEST_URL = new URL('../../assets/levels/manifest.json', import.meta.url);
const PLAYER_TYPE = {
  BLOB: 0,
  WALKER: 1,
  MOUSE: 2,
};
const PLAYER_TYPE_TO_ANIMATION = [
  'blob',
  'player_walk_left',
  'mouse',
];
const ANIMATION_TO_PLAYER_TYPE = {
  blob: PLAYER_TYPE.BLOB,
  player_walk_left: PLAYER_TYPE.WALKER,
  mouse: PLAYER_TYPE.MOUSE,
};
const PLAYER_EVOLUTION_ORDER = [
  PLAYER_TYPE.BLOB,
  PLAYER_TYPE.WALKER,
  PLAYER_TYPE.MOUSE,
];
const characterUniformData = new Float32Array(12);
let playerFrameWidth = 32;
let playerFrameHeight = 32;
let npcFrameWidth = 32;
let npcFrameHeight = 32;

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
let normalizedTileDefinitions = [];
let npcPaletteDefinitions = [];
let npcFrameLookup = new Map();

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
let currentWorldData = null;
let levelManifest = null;
let levelManifestDirty = false;
let levelCreationDialog = null;
let levelCreationBackdrop = null;
let currentLevelSpawn = null;
const levelDataCache = new Map();
let currentLevelIndex = 0;
let levelTransitionInProgress = false;
let currentLevelDescriptor = null;
const mergeHistory = [];
let unsplitRequested = false;

// Poki SDK state
let isAdPlaying = false;
let audioWasMutedBeforeAd = false;
let inputDisabledForAd = false;

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

const keyboardState = {
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
};

// Gamepad state
let gamepadIndex = -1;
let previousGamepadState = {
  cross: false,
  square: false,
  dpadUp: false,
  dpadDown: false,
};
let lastGamepadDebugSignature = '';

const touchState = {
  enabled: false,
  moveLeft: false,
  moveRight: false,
  jump: false,
  unmerge: false,
};
const touchButtonElements = {};
let touchControlsEnabled = false;

let victoryScreenVisible = false;
let victoryScreenRoot = null;
let victoryScreenTitle = null;
let victoryScreenSummary = null;
let victoryScreenNextButton = null;
let victoryScreenRestartButton = null;

// Timing
let lastTime = performance.now();

function toTitleCase(value) {
  return String(value ?? '')
    .replace(/[_\-]+/g, ' ')
    .split(' ')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractTileDefinitions(atlas) {
  if (!atlas || typeof atlas !== 'object') {
    return [];
  }

  const tiles = Array.isArray(atlas.tiles) ? atlas.tiles : [];
  return tiles
    .map((tile) => {
      const id = typeof tile.id === 'number' ? tile.id : Number(tile.id);
      if (!Number.isFinite(id)) {
        return null;
      }
      const x = Number(tile.x);
      const y = Number(tile.y);
      const width = Number(tile.width);
      const height = Number(tile.height);
      return {
        ...tile,
        id,
        name: typeof tile.name === 'string' && tile.name.length > 0 ? tile.name : `tile_${id}`,
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        width: Number.isFinite(width) ? width : TILE_WIDTH,
        height: Number.isFinite(height) ? height : TILE_HEIGHT,
      };
    })
    .filter((tile) => tile !== null)
    .sort((a, b) => a.id - b.id);
}

function extractNpcDefinitions(atlas) {
  if (!atlas || typeof atlas !== 'object') {
    return [];
  }

  return Object.entries(atlas)
    .filter(([key, frames]) => key !== 'tiles' && Array.isArray(frames) && frames.length > 0)
    .filter(([key]) => key === NPC_ANIMATION || key === PLAYER_ANIMATION || !key.startsWith('player_'))
    .map(([key, frames]) => {
      const frame = frames[0] ?? {};
      const x = Number(frame.x);
      const y = Number(frame.y);
      const width = Number(frame.width);
      const height = Number(frame.height);
      return {
        id: key,
        label: toTitleCase(key),
        frame: {
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          width: Number.isFinite(width) ? width : TILE_WIDTH,
          height: Number.isFinite(height) ? height : TILE_HEIGHT,
        },
        frames,
      };
    });
}

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
  'KeyA': 'moveLeft',
  'KeyD': 'moveRight',
  // Jump (keyboard): W and Space both map to ActionDown
  'KeyW': 'actionDown',
  'Space': 'actionDown',
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

  if(e.code === 'KeyS') {
    if (e.repeat) {
      return;
    }
    if(!levelEditor || !levelEditor.isEditorMode) {
      unsplitRequested = true;
      e.preventDefault();
    }
    return;
  }
  
  // Don't send game input while in editor mode
  if(levelEditor && levelEditor.isEditorMode) {
    return;
  }
  
  const action = keyMap[e.code];
  if(action) {
    keyboardState[action] = true;
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  // Don't send game input while in editor mode
  if(levelEditor && levelEditor.isEditorMode) {
    return;
  }
  
  const action = keyMap[e.code];
  if(action) {
    keyboardState[action] = false;
    e.preventDefault();
  }
});

// Touch controls
function setTouchButtonVisual(action, active) {
  const element = touchButtonElements[action];
  if (element) {
    element.classList.toggle('is-active', !!active);
  }
}

function activateTouchAction(action, pressed) {
  switch (action) {
    case 'moveLeft':
      touchState.moveLeft = pressed;
      setTouchButtonVisual(action, pressed);
      return;
    case 'moveRight':
      touchState.moveRight = pressed;
      setTouchButtonVisual(action, pressed);
      return;
    case 'jump':
      touchState.jump = pressed;
      setTouchButtonVisual(action, pressed);
      return;
    case 'unmerge':
      touchState.unmerge = pressed;
      setTouchButtonVisual(action, pressed);
      if (pressed && (!levelEditor || !levelEditor.isEditorMode)) {
        unsplitRequested = true;
      }
      if (!pressed) {
        touchState.unmerge = false;
      }
      return;
    default:
      return;
  }
}

function resetTouchState() {
  touchState.moveLeft = false;
  touchState.moveRight = false;
  touchState.jump = false;
  touchState.unmerge = false;
  Object.keys(touchButtonElements).forEach((action) => {
    setTouchButtonVisual(action, false);
  });
}

function bindTouchButton(element, action) {
  if (!element || typeof action !== 'string') {
    return;
  }

  const activePointers = new Set();

  element.addEventListener('contextmenu', (event) => event.preventDefault());

  element.addEventListener('pointerdown', (event) => {
    if (!touchControlsEnabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    activePointers.add(event.pointerId);
    if (element.setPointerCapture) {
      try {
        element.setPointerCapture(event.pointerId);
      } catch (err) {
        if (DEV_TOOLS_ENABLED) {
          console.warn('Touch button capture failed', err);
        }
      }
    }
    activateTouchAction(action, true);
  });

  const releasePointer = (event) => {
    if (!activePointers.has(event.pointerId)) {
      return;
    }
    activePointers.delete(event.pointerId);
    if (element.hasPointerCapture && element.hasPointerCapture(event.pointerId)) {
      try {
        element.releasePointerCapture(event.pointerId);
      } catch (err) {
        if (DEV_TOOLS_ENABLED) {
          console.warn('Touch button release failed', err);
        }
      }
    }
    if (activePointers.size === 0) {
      activateTouchAction(action, false);
    }
    event.preventDefault();
    event.stopPropagation();
  };

  element.addEventListener('pointerup', releasePointer);
  element.addEventListener('pointercancel', releasePointer);
  element.addEventListener('pointerleave', releasePointer);
  element.addEventListener('pointerout', releasePointer);
}

function setupTouchControls() {
  const controlsRoot = document.getElementById('touch-controls');
  if (!controlsRoot) {
    return;
  }

  const hasWindow = typeof window !== 'undefined';
  const hasNavigator = typeof navigator !== 'undefined';
  const touchPoints = hasNavigator
    ? Number(navigator.maxTouchPoints || navigator.msMaxTouchPoints || 0)
    : 0;
  const supportsTouchEvents = hasWindow && ('ontouchstart' in window || 'ontouchend' in window);
  let coarsePointerDetected = false;
  if (hasWindow && typeof window.matchMedia === 'function') {
    try {
      const coarseQuery = window.matchMedia('(pointer: coarse)');
      const anyCoarseQuery = window.matchMedia('(any-pointer: coarse)');
      coarsePointerDetected = Boolean(coarseQuery?.matches || anyCoarseQuery?.matches);
    } catch (err) {
      if (DEV_TOOLS_ENABLED) {
        console.warn('Touch media query evaluation failed', err);
      }
    }
  }

  const forcedViaRuntime = Boolean(RUNTIME_CONFIG?.forceTouchControls);
  const touchCapable = forcedViaRuntime || supportsTouchEvents || touchPoints > 0 || coarsePointerDetected;

  if (!touchCapable) {
    controlsRoot.style.display = 'none';
    return;
  }

  touchControlsEnabled = true;
  touchState.enabled = true;
  controlsRoot.style.display = 'flex';

  const buttons = controlsRoot.querySelectorAll('[data-action]');
  buttons.forEach((button) => {
    const action = button.dataset.action;
    if (!action) {
      return;
    }
    touchButtonElements[action] = button;
    bindTouchButton(button, action);
  });

  console.log('Touch controls enabled');
}

function getLevelLabel(index = currentLevelIndex) {
  const entry = getLevelEntry(index);
  if (entry?.name) {
    return entry.name;
  }
  if (entry?.id) {
    return toTitleCase(entry.id);
  }
  if (Number.isFinite(index)) {
    return `Level ${index + 1}`;
  }
  return 'Level';
}

function hasNextLevelAvailable() {
  if (!Array.isArray(levelManifest) || levelManifest.length === 0) {
    return false;
  }
  return currentLevelIndex < (levelManifest.length - 1);
}

function getNextLevelLabel() {
  if (!hasNextLevelAvailable()) {
    return null;
  }
  return getLevelLabel(currentLevelIndex + 1);
}

function notifyPokiGameplayStop(reason) {
  if (typeof PokiSDK !== 'undefined' && typeof PokiSDK.gameplayStop === 'function') {
    try {
      PokiSDK.gameplayStop();
      if (DEV_TOOLS_ENABLED) {
        console.log(`Poki: Gameplay stopped (${reason})`);
      }
    } catch (err) {
      console.warn('Poki gameplayStop failed', err);
    }
  }
}

function notifyPokiGameplayStart(reason) {
  if (typeof PokiSDK !== 'undefined' && typeof PokiSDK.gameplayStart === 'function') {
    try {
      PokiSDK.gameplayStart();
      if (DEV_TOOLS_ENABLED) {
        console.log(`Poki: Gameplay started (${reason})`);
      }
    } catch (err) {
      console.warn('Poki gameplayStart failed', err);
    }
  }
}

function prepareVictoryScreenContent() {
  if (!victoryScreenRoot) {
    return;
  }

  const levelLabel = getLevelLabel();
  const nextLabel = getNextLevelLabel();
  const hasNext = typeof nextLabel === 'string' && nextLabel.length > 0;

  if (victoryScreenTitle) {
    victoryScreenTitle.textContent = 'Level Complete';
  }

  if (victoryScreenSummary) {
    victoryScreenSummary.textContent = hasNext
      ? `You cleared ${levelLabel}. Next up: ${nextLabel}.`
      : `You cleared ${levelLabel}. That was the final level available in this build.`;
  }

  if (victoryScreenNextButton) {
    victoryScreenNextButton.disabled = !hasNext;
    victoryScreenNextButton.textContent = hasNext ? 'Next Level' : 'All Levels Complete';
    victoryScreenNextButton.setAttribute('aria-disabled', hasNext ? 'false' : 'true');
  }
}

function showVictoryScreenOverlay() {
  if (!victoryScreenRoot) {
    return;
  }

  victoryScreenVisible = true;
  victoryScreenRoot.classList.add('is-visible');
  victoryScreenRoot.setAttribute('aria-hidden', 'false');
  notifyPokiGameplayStop('victory screen');

  if (victoryScreenNextButton && !victoryScreenNextButton.disabled) {
    setTimeout(() => {
      victoryScreenNextButton.focus({ preventScroll: true });
    }, 0);
  } else if (victoryScreenRestartButton) {
    setTimeout(() => {
      victoryScreenRestartButton.focus({ preventScroll: true });
    }, 0);
  }
}

function hideVictoryScreenOverlay({ resumeGameplay = true } = {}) {
  if (!victoryScreenRoot) {
    victoryScreenVisible = false;
    return;
  }

  victoryScreenVisible = false;
  victoryScreenRoot.classList.remove('is-visible');
  victoryScreenRoot.setAttribute('aria-hidden', 'true');

  if (resumeGameplay) {
    notifyPokiGameplayStart('victory dismissed');
  }
}

function handleLevelVictory() {
  if (victoryScreenVisible) {
    return;
  }

  if (!victoryScreenRoot) {
    console.warn('Victory screen root missing; advancing automatically.');
    advanceToNextLevelFromVictory();
    return;
  }

  resetTouchState();
  prepareVictoryScreenContent();
  showVictoryScreenOverlay();
}

async function advanceToNextLevelFromVictory() {
  if (!hasNextLevelAvailable()) {
    return;
  }

  levelTransitionInProgress = true;
  hideVictoryScreenOverlay({ resumeGameplay: false });

  try {
    const advanced = await loadNextLevel();
    if (!advanced) {
      console.warn('Unable to load the next level after victory.');
    }
  } finally {
    levelTransitionInProgress = false;
    notifyPokiGameplayStart('next level from victory');
  }
}

async function restartLevelFromVictory() {
  levelTransitionInProgress = true;
  hideVictoryScreenOverlay({ resumeGameplay: false });

  try {
    const index = Math.max(0, currentLevelIndex);
    const reloaded = await loadLevelByIndex(index);
    if (!reloaded) {
      console.warn('Failed to reload current level after victory restart.');
    }
  } finally {
    levelTransitionInProgress = false;
    notifyPokiGameplayStart('restart level from victory');
  }
}

function setupVictoryScreen() {
  victoryScreenRoot = document.getElementById('victory-overlay');
  if (!victoryScreenRoot) {
    if (DEV_TOOLS_ENABLED) {
      console.warn('Victory overlay root not found; skipping setup.');
    }
    return;
  }

  victoryScreenTitle = document.getElementById('victory-title');
  victoryScreenSummary = document.getElementById('victory-summary');
  victoryScreenNextButton = document.getElementById('victory-next-btn');
  victoryScreenRestartButton = document.getElementById('victory-restart-btn');

  if (victoryScreenNextButton) {
    victoryScreenNextButton.addEventListener('click', () => {
      if (victoryScreenNextButton.disabled) {
        return;
      }
      advanceToNextLevelFromVictory();
    });
  }

  if (victoryScreenRestartButton) {
    victoryScreenRestartButton.addEventListener('click', () => {
      restartLevelFromVictory();
    });
  }

  window.addEventListener('keydown', (event) => {
    if (!victoryScreenVisible) {
      return;
    }
    if (event.key === 'Enter') {
      if (!hasNextLevelAvailable()) {
        return;
      }
      event.preventDefault();
      advanceToNextLevelFromVictory();
    } else if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      restartLevelFromVictory();
    }
  });
}

// Gamepad handling
const GAMEPAD_BUTTONS = {
  cross: 0,
  circle: 1,
  square: 2,
  triangle: 3,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
};

const HAT_DPAD_MAPPING = [
  { value: -1.0, up: true },
  { value: -0.714, up: true, right: true },
  { value: -0.428, right: true },
  { value: -0.142, right: true, down: true },
  { value: 0.142, down: true },
  { value: 0.428, down: true, left: true },
  { value: 0.714, left: true },
  { value: 1.0, left: true, up: true },
];
const HAT_VALUE_TOLERANCE = 0.15;
const HORIZONTAL_AXIS_FALLBACKS = [5, 10, 9];
const VERTICAL_AXIS_FALLBACKS = [4, 10, 9];

function readHatDirections(axisValue) {
  if (typeof axisValue !== 'number' || !Number.isFinite(axisValue)) {
    return null;
  }
  for (const entry of HAT_DPAD_MAPPING) {
    if (Math.abs(axisValue - entry.value) <= HAT_VALUE_TOLERANCE) {
      return {
        up: !!entry.up,
        down: !!entry.down,
        left: !!entry.left,
        right: !!entry.right,
      };
    }
  }
  return null;
}

function readBinaryAxisDirection(axisValue) {
  if (typeof axisValue !== 'number' || !Number.isFinite(axisValue)) {
    return 0;
  }
  const value = normalizeAxisValue(axisValue);
  if (value <= -0.5) {
    return -1;
  }
  if (value >= 0.5) {
    return 1;
  }
  return 0;
}

function pickAxisDirection(axes, indices) {
  if (!Array.isArray(axes) || !Array.isArray(indices)) {
    return 0;
  }
  for (const index of indices) {
    if (typeof index !== 'number') {
      continue;
    }
    const direction = readBinaryAxisDirection(axes[index]);
    if (direction !== 0) {
      return direction;
    }
  }
  return 0;
}

function normalizeAxisValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

function isButtonPressed(button) {
  if (!button) {
    return false;
  }
  if (typeof button.pressed === 'boolean') {
    return button.pressed;
  }
  if (typeof button.value === 'number') {
    return button.value > 0.5;
  }
  return false;
}

function detectDpad(gamepad, buttons, axes) {
  const state = { left: false, right: false, up: false, down: false };
  if (!gamepad) {
    return state;
  }

  const buttonList = Array.isArray(buttons) ? buttons : [];
  const axesList = Array.isArray(axes) ? axes : [];

  const hasStandardDpad = buttonList.length > GAMEPAD_BUTTONS.dpadRight
    && buttonList[GAMEPAD_BUTTONS.dpadLeft] !== undefined
    && (typeof buttonList[GAMEPAD_BUTTONS.dpadLeft]?.pressed === 'boolean'
      || typeof buttonList[GAMEPAD_BUTTONS.dpadLeft]?.value === 'number');

  if (hasStandardDpad) {
    state.left = isButtonPressed(buttonList[GAMEPAD_BUTTONS.dpadLeft]);
    state.right = isButtonPressed(buttonList[GAMEPAD_BUTTONS.dpadRight]);
    state.up = isButtonPressed(buttonList[GAMEPAD_BUTTONS.dpadUp]);
    state.down = isButtonPressed(buttonList[GAMEPAD_BUTTONS.dpadDown]);
    return state;
  }

  const hatDirections = readHatDirections(axesList[9]);
  if (hatDirections) {
    return {
      left: !!hatDirections.left,
      right: !!hatDirections.right,
      up: !!hatDirections.up,
      down: !!hatDirections.down,
    };
  }

  const horizontalDirection = pickAxisDirection(axesList, HORIZONTAL_AXIS_FALLBACKS);
  if (horizontalDirection < 0) {
    state.left = true;
  } else if (horizontalDirection > 0) {
    state.right = true;
  }

  const verticalDirection = pickAxisDirection(axesList, VERTICAL_AXIS_FALLBACKS);
  if (verticalDirection < 0) {
    state.up = true;
  } else if (verticalDirection > 0) {
    state.down = true;
  }

  if (!state.left && !state.right && !state.up && !state.down) {
    const id = (gamepad.id || '').toLowerCase();
    if (id.includes('dualsense') || id.includes('dualshock') || id.includes('wireless controller') || id.includes('sony')) {
      const verticalAxis = normalizeAxisValue(axesList[4]);
      const horizontalAxis = normalizeAxisValue(axesList[5]);
      if (verticalAxis >= 0.5) {
        state.up = true;
      } else if (verticalAxis <= -0.5) {
        state.down = true;
      }
      if (horizontalAxis <= -0.5) {
        state.left = true;
      } else if (horizontalAxis >= 0.5) {
        state.right = true;
      }
    }
  }

  return state;
}

function updateGamepadInput() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

  if (gamepadIndex === -1) {
    for (let i = 0; i < gamepads.length; i++) {
      const pad = gamepads[i];
      if (pad && (typeof pad.connected !== 'boolean' || pad.connected)) {
        gamepadIndex = i;
        console.log(`Gamepad connected: ${gamepads[i].id}`);
        break;
      }
    }
  }

  const candidateGamepad = gamepadIndex !== -1 ? gamepads[gamepadIndex] : null;
  const gamepad = candidateGamepad && (typeof candidateGamepad.connected !== 'boolean' || candidateGamepad.connected)
    ? candidateGamepad
    : null;

  let gpMoveLeft = false;
  let gpMoveRight = false;
  let gpMoveUp = false;
  let gpMoveDown = false;
  let gpActionDown = false;
  let gpActionUp = false;
  let gpActionLeft = false;
  let gpActionRight = false;
  let gpLeftShoulder = false;
  let gpRightShoulder = false;
  let gpStart = false;
  let gpBack = false;
  let gpStickX = 0.0;
  let gpStickY = 0.0;
  let gpIsAnalog = false;

  if (!gamepad) {
    if (gamepadIndex !== -1 && (!candidateGamepad || candidateGamepad.connected === false)) {
      gamepadIndex = -1;
    }
    previousGamepadState.cross = false;
    previousGamepadState.square = false;
    previousGamepadState.dpadUp = false;
    previousGamepadState.dpadDown = false;
  } else {
    const axes = Array.isArray(gamepad.axes) ? gamepad.axes : [];
    const buttons = Array.isArray(gamepad.buttons) ? Array.from(gamepad.buttons) : [];

    const leftStickX = normalizeAxisValue(axes[0]);
    const leftStickY = normalizeAxisValue(axes[1]);
    const analogDeadzone = 0.2;

    const effectiveStickX = Math.abs(leftStickX) > analogDeadzone ? leftStickX : 0.0;
    const effectiveStickY = Math.abs(leftStickY) > analogDeadzone ? leftStickY : 0.0;

    gpStickX = effectiveStickX;
    gpStickY = effectiveStickY;
    gpIsAnalog = effectiveStickX !== 0.0 || effectiveStickY !== 0.0;

    const dpadState = detectDpad(gamepad, buttons, axes);

    const crossPressed = isButtonPressed(buttons[GAMEPAD_BUTTONS.cross]);
    const circlePressed = isButtonPressed(buttons[GAMEPAD_BUTTONS.circle]);
    const squarePressed = isButtonPressed(buttons[GAMEPAD_BUTTONS.square]);
    const trianglePressed = isButtonPressed(buttons[GAMEPAD_BUTTONS.triangle]);
    const leftShoulderPressed = isButtonPressed(buttons[4]);
    const rightShoulderPressed = isButtonPressed(buttons[5]);
    const startPressed = isButtonPressed(buttons[9]);
    const backPressed = isButtonPressed(buttons[8]);

    const analogLeft = effectiveStickX < 0;
    const analogRight = effectiveStickX > 0;

    gpMoveLeft = dpadState.left || analogLeft;
    gpMoveRight = dpadState.right || analogRight;
    gpMoveUp = dpadState.up;
    gpMoveDown = dpadState.down;

    gpActionDown = crossPressed || dpadState.up;
    gpActionRight = circlePressed;
    gpActionLeft = squarePressed;
    gpActionUp = trianglePressed;
    gpLeftShoulder = leftShoulderPressed;
    gpRightShoulder = rightShoulderPressed;
    gpStart = startPressed;
    gpBack = backPressed;

    const justPressedSquare = squarePressed && !previousGamepadState.square;
    const justPressedDpadDown = dpadState.down && !previousGamepadState.dpadDown;

    if ((justPressedSquare || justPressedDpadDown) && (!levelEditor || !levelEditor.isEditorMode)) {
      unsplitRequested = true;
    }

    previousGamepadState.cross = crossPressed;
    previousGamepadState.square = squarePressed;
    previousGamepadState.dpadUp = dpadState.up;
    previousGamepadState.dpadDown = dpadState.down;

  }

  inputState.moveLeft = keyboardState.moveLeft || gpMoveLeft || touchState.moveLeft;
  inputState.moveRight = keyboardState.moveRight || gpMoveRight || touchState.moveRight;
  inputState.moveUp = keyboardState.moveUp || gpMoveUp;
  inputState.moveDown = keyboardState.moveDown || gpMoveDown;
  inputState.actionDown = keyboardState.actionDown || gpActionDown || touchState.jump;
  inputState.actionUp = keyboardState.actionUp || gpActionUp;
  inputState.actionLeft = keyboardState.actionLeft || gpActionLeft;
  inputState.actionRight = keyboardState.actionRight || gpActionRight;
  inputState.leftShoulder = keyboardState.leftShoulder || gpLeftShoulder;
  inputState.rightShoulder = keyboardState.rightShoulder || gpRightShoulder;
  inputState.start = keyboardState.start || gpStart;
  inputState.back = keyboardState.back || gpBack;
  inputState.stickX = gpStickX;
  inputState.stickY = gpStickY;
  inputState.isAnalog = gpIsAnalog;
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
  
  // Don't update game if in editor mode or if ad is playing
  if ((!levelEditor || !levelEditor.isEditorMode) && !isAdPlaying && !victoryScreenVisible) {
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

    // Check for exit tile completion
    checkExitTileTrigger();
    handleUnsplitting();
    checkNpcMergeTrigger();
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
  normalizedTileDefinitions = extractTileDefinitions(atlasData);
  npcPaletteDefinitions = extractNpcDefinitions(atlasData);
  npcFrameLookup = new Map(npcPaletteDefinitions.map((def) => [def.id, def.frames]));
  if (Array.isArray(atlasData?.[NPC_ANIMATION])) {
    npcFrameLookup.set(NPC_ANIMATION, atlasData[NPC_ANIMATION]);
  }
  if (Array.isArray(atlasData?.[PLAYER_ANIMATION])) {
    npcFrameLookup.set(PLAYER_ANIMATION, atlasData[PLAYER_ANIMATION]);
  }
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

    let usedManifest = false;
    await ensureLevelManifestLoaded();
    if (Array.isArray(levelManifest) && levelManifest.length > 0) {
      currentLevelIndex = 0;
      const loaded = await loadLevelByIndex(currentLevelIndex);
      if (loaded) {
        usedManifest = true;
      }
    }

    if (!usedManifest) {
      let worldData = null;
      if (DEV_TOOLS_ENABLED) {
        try {
          const response = await fetch(WORLD_EDITOR_URL);
          if (response.ok) {
            worldData = await response.json();
          } else {
            console.warn(`Failed to load editor world JSON (${response.status}); falling back to embedded data.`);
          }
        } catch (err) {
          console.warn('Error fetching editor world JSON, falling back to embedded data.', err);
        }
      }

      if (!worldData) {
        worldData = loadWorldFromWasm();
      } else {
        worldData = reconcileWithEmbeddedWorld(worldData);
      }

      if (!Array.isArray(worldData.npcs)) {
        worldData.npcs = [];
      }

      applyWorldData(worldData, { source: null });
    }

    await initializeDevTools();

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

  const tileDefinitions = normalizedTileDefinitions.length > 0
    ? normalizedTileDefinitions
    : extractTileDefinitions(atlasData);
  const npcDefinitions = npcPaletteDefinitions.length > 0
    ? npcPaletteDefinitions
    : extractNpcDefinitions(atlasData);

  levelEditor = new LevelEditor(canvas, mapManager, rebuildCurrentRoomTiles, {
    tileSize: TILE_WIDTH,
    statusUpdateCallback: updateEditorStatus,
    onNpcClick: handleNpcEditorClick,
    tileDefinitions,
  });

  const defaultNpc = npcDefinitions[0] ?? null;
  if (defaultNpc) {
    levelEditor.setSelectedNpc(defaultNpc.id, { label: defaultNpc.label, silent: true });
  }

  const paletteRoot = document.getElementById('palette-root');
  if (paletteRoot) {
    editorPalette = new EditorPalette(paletteRoot, {
      atlasImageUrl: ATLAS_IMAGE_URL.href,
      tiles: tileDefinitions,
      npcs: npcDefinitions,
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

  const editorContainer = document.getElementById('editor-container');
  await setupLevelSelector(editorContainer);

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
  const tiles = normalizedTileDefinitions.length > 0
    ? normalizedTileDefinitions
    : (Array.isArray(atlasData?.tiles) ? atlasData.tiles : []);
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

  const NPC_DATA_STRIDE = 5;
  const npcBuffer = new Int32Array(wasm.memory.buffer, NPC_MEMORY_OFFSET, MAX_NPCS_PER_ROOM * NPC_DATA_STRIDE);
  npcBuffer.fill(0);

  const fallbackNpcFrames = npcFrameLookup.get(NPC_ANIMATION);
  const fallbackFrameSet = Array.isArray(fallbackNpcFrames) && fallbackNpcFrames.length > 0
    ? fallbackNpcFrames
    : (Array.isArray(atlasData?.[PLAYER_ANIMATION]) ? atlasData[PLAYER_ANIMATION] : []);

  for (let i = 0; i < count; i++) {
    const spawn = npcList[i] || { col: 0, row: 0 };
    const animationKey = (spawn && typeof spawn.id === 'string' && spawn.id.length > 0)
      ? spawn.id
      : NPC_ANIMATION;

    const frameSet = (() => {
      const frames = npcFrameLookup.get(animationKey);
      if (Array.isArray(frames) && frames.length > 0) {
        return frames;
      }
      return fallbackFrameSet;
    })();

    const typeIndex = ANIMATION_TO_PLAYER_TYPE[animationKey] ?? PLAYER_TYPE.WALKER;

    const referenceFrame = frameSet && frameSet.length > 0 ? frameSet[0] : null;
    const width = Math.max(1, Math.round(referenceFrame?.width ?? npcFrameWidth));
    const height = Math.max(1, Math.round(referenceFrame?.height ?? npcFrameHeight));

    const baseIndex = i * NPC_DATA_STRIDE;
    npcBuffer[baseIndex] = spawn.col ?? 0;
    npcBuffer[baseIndex + 1] = spawn.row ?? 0;
    npcBuffer[baseIndex + 2] = width;
    npcBuffer[baseIndex + 3] = height;
    npcBuffer[baseIndex + 4] = typeIndex;
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

async function ensureLevelManifestLoaded() {
  if (levelManifest !== null) {
    return;
  }

  try {
    const response = await fetch(LEVEL_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load level manifest (${response.status})`);
    }
    const data = await response.json();
    if (Array.isArray(data?.levels)) {
      levelManifest = data.levels;
    } else {
      console.warn('Level manifest missing "levels" array; falling back to embedded world data.');
      levelManifest = [];
    }
  } catch (err) {
    console.warn('Could not load level manifest; using embedded world data.', err);
    levelManifest = [];
  }
  setLevelManifestDirty(false);
}

function getLevelEntry(index) {
  if (!Array.isArray(levelManifest) || levelManifest.length === 0) {
    return null;
  }
  if (index < 0 || index >= levelManifest.length) {
    return null;
  }
  return levelManifest[index] || null;
}

async function loadLevelEntry(entry) {
  if (!entry || typeof entry.id !== 'string') {
    return null;
  }

  const cached = levelDataCache.get(entry.id);
  if (cached) {
    return cached;
  }

  try {
    const levelUrl = new URL(entry.path, LEVEL_MANIFEST_URL);
    const response = await fetch(levelUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load level ${entry.id} (${response.status})`);
    }
    const data = await response.json();
    const record = { data, url: levelUrl.href };
    levelDataCache.set(entry.id, record);
    return record;
  } catch (err) {
    console.error(`Error loading level ${entry.id}`, err);
    return null;
  }
}

function applyWorldData(worldData, options = {}) {
  if (!worldData) {
    throw new Error('Cannot apply empty world data');
  }

  const source = options.source ?? null;
  currentWorldData = worldData;
  currentLevelDescriptor = source;
  mergeHistory.length = 0;
  unsplitRequested = false;

  if (source?.entry?.id) {
    const cached = levelDataCache.get(source.entry.id);
    if (cached) {
      cached.data = worldData;
      if (source.url) {
        cached.url = source.url;
      }
    } else {
      levelDataCache.set(source.entry.id, { data: worldData, url: source?.url ?? null });
    }
  }

  const spawnPoint = getLevelSpawnPoint(worldData);
  currentLevelSpawn = spawnPoint;

  const existingSpawn = (currentWorldData && typeof currentWorldData.playerSpawn === 'object')
    ? currentWorldData.playerSpawn
    : {};
  const defaultSpawnCol = Math.floor((worldData.roomWidth ?? ROOM_TILE_COLS) / 2);
  const defaultSpawnRow = Math.max(0, (worldData.roomHeight ?? ROOM_TILE_ROWS) - 3);
  const existingCol = Number(existingSpawn.col);
  const existingRow = Number(existingSpawn.row);
  currentWorldData.playerSpawn = {
    ...existingSpawn,
    roomX: spawnPoint.roomX,
    roomY: spawnPoint.roomY,
    x: spawnPoint.x,
    y: spawnPoint.y,
    col: Number.isFinite(existingCol) ? existingCol : defaultSpawnCol,
    row: Number.isFinite(existingRow) ? existingRow : defaultSpawnRow,
  };

  mapManager = new MapManager(worldData, { source, spawn: spawnPoint });
  currentRoomX = spawnPoint.roomX;
  currentRoomY = spawnPoint.roomY;
  currentWorldData.startRoomX = currentRoomX;
  currentWorldData.startRoomY = currentRoomY;
  mapManager.currentRoomX = currentRoomX;
  mapManager.currentRoomY = currentRoomY;
  mapManager.ensureNpcGrid();

  initialNpcSyncPending = true;
  lastRoomSent = `${currentRoomX},${currentRoomY}`;

  if (levelEditor && typeof levelEditor.setMapManager === 'function') {
    levelEditor.setMapManager(mapManager);
  }

  rebuildCurrentRoomTiles();
  if (wasm && typeof wasm.SetTileData === 'function') {
    sendCurrentRoomNpcData();
  } else {
    lastNpcCount = 0;
  }

  setPlayerType(PLAYER_TYPE.BLOB);
}

async function loadLevelByIndex(index, { resetPlayer = true } = {}) {
  await ensureLevelManifestLoaded();
  const entry = getLevelEntry(index);
  if (!entry) {
    return false;
  }

  const record = await loadLevelEntry(entry);
  if (!record || !record.data) {
    console.warn('Falling back to embedded world data; level load failed.');
    const embedded = loadWorldFromWasm();
    currentLevelDescriptor = null;
    applyWorldData(embedded, { source: null });
    return false;
  }

  const descriptor = { entry, url: record.url ?? null, index };
  try {
    if (descriptor.url) {
      const parsed = new URL(descriptor.url, window.location.origin);
      descriptor.requestPath = parsed.origin === window.location.origin
        ? parsed.pathname
        : parsed.href;
    } else if (entry.path) {
      const parsed = new URL(entry.path, LEVEL_MANIFEST_URL);
      descriptor.requestPath = parsed.origin === window.location.origin
        ? parsed.pathname
        : parsed.href;
    }
  } catch (err) {
    console.warn('Could not derive request path for level; using manifest path.', err);
    descriptor.requestPath = entry.path || null;
  }
  applyWorldData(record.data, { source: descriptor });

  if (resetPlayer) {
    const spawn = currentLevelSpawn || getLevelSpawnPoint(currentWorldData);
    currentRoomX = spawn.roomX;
    currentRoomY = spawn.roomY;
    if (mapManager) {
      mapManager.currentRoomX = currentRoomX;
      mapManager.currentRoomY = currentRoomY;
    }
    if (wasm && typeof wasm.ResetPlayerState === 'function') {
      wasm.ResetPlayerState(spawn.roomX, spawn.roomY, spawn.x, spawn.y);
    } else if (typeof wasm?.SetPlayerPosition === 'function') {
      wasm.SetPlayerPosition(spawn.x, spawn.y);
    }
  }

  initialNpcSyncPending = true;

  lastRoomSent = `${currentRoomX},${currentRoomY}`;
  lastNpcCount = 0;
  const editorContainer = document.getElementById('editor-container');
  if (editorContainer) {
    setupLevelSelector(editorContainer);
  }
  currentLevelIndex = index;
  return true;
}

async function loadNextLevel() {
  await ensureLevelManifestLoaded();
  if (!Array.isArray(levelManifest) || levelManifest.length === 0) {
    console.log('No level manifest found; cannot advance levels.');
    return false;
  }

  const nextIndex = currentLevelIndex + 1;
  if (nextIndex >= levelManifest.length) {
    console.log('All levels complete!');
    return false;
  }

  const loaded = await loadLevelByIndex(nextIndex);
  if (loaded) {
    currentLevelIndex = nextIndex;
    const nextEntry = levelManifest[nextIndex];
    const label = nextEntry?.name ?? nextEntry?.id ?? `Level ${nextIndex + 1}`;
    console.log(`Loaded level ${label}`);
    return true;
  }

  return false;
}

function checkExitTileTrigger() {
  if (levelTransitionInProgress || !wasm) {
    return;
  }
  if (typeof wasm.GetTileAt !== 'function' || typeof wasm.GetPlayerX !== 'function' || typeof wasm.GetPlayerY !== 'function') {
    return;
  }

  const playerBounds = getPlayerBounds();
  const colStart = Math.floor(playerBounds.x / TILE_WIDTH);
  const rowStart = Math.floor(playerBounds.y / TILE_HEIGHT);
  const colEnd = Math.floor((playerBounds.x + Math.max(playerBounds.width, 1)) / TILE_WIDTH);
  const rowEnd = Math.floor((playerBounds.y + Math.max(playerBounds.height, 1)) / TILE_HEIGHT);

  const minCol = Math.max(0, colStart);
  const maxCol = Math.min(ROOM_TILE_COLS - 1, colEnd);
  const minRow = Math.max(0, rowStart);
  const maxRow = Math.min(ROOM_TILE_ROWS - 1, rowEnd);

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const tileId = wasm.GetTileAt(col, row);
      if (tileId === EXIT_TILE_ID) {
        levelTransitionInProgress = true;
        console.log(`Exit reached! Victory triggered at tile ${col},${row}`);
        handleLevelVictory();
        return;
      }
    }
  }
}

function getFrameForPlayerType(type) {
  const key = PLAYER_TYPE_TO_ANIMATION[type] ?? PLAYER_ANIMATION;
  const frames = atlasData?.[key];
  if (Array.isArray(frames) && frames.length > 0) {
    return frames[0];
  }
  return null;
}

function getSizeForPlayerType(type) {
  const frame = getFrameForPlayerType(type);
  const width = Number.isFinite(frame?.width) ? frame.width : playerFrameWidth;
  const height = Number.isFinite(frame?.height) ? frame.height : playerFrameHeight;
  return { width, height };
}

function getPlayerBounds() {
  const playerX = typeof wasm.GetPlayerX === 'function' ? wasm.GetPlayerX() : 0;
  const playerY = typeof wasm.GetPlayerY === 'function' ? wasm.GetPlayerY() : 0;
  const typeIndex = typeof wasm.GetPlayerType === 'function' ? wasm.GetPlayerType() : PLAYER_TYPE.BLOB;
  const { width, height } = getSizeForPlayerType(typeIndex);
  return {
    x: playerX,
    y: playerY,
    width,
    height,
    type: typeIndex,
  };
}

function rectanglesOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function getNextPlayerType(type) {
  const idx = PLAYER_EVOLUTION_ORDER.indexOf(type);
  if (idx === -1 || idx >= PLAYER_EVOLUTION_ORDER.length - 1) {
    return type;
  }
  return PLAYER_EVOLUTION_ORDER[idx + 1];
}

function getPreviousPlayerType(type) {
  const idx = PLAYER_EVOLUTION_ORDER.indexOf(type);
  if (idx <= 0) {
    return PLAYER_EVOLUTION_ORDER[0];
  }
  return PLAYER_EVOLUTION_ORDER[idx - 1];
}

function setPlayerType(type) {
  if (typeof wasm.SetPlayerType === 'function') {
    wasm.SetPlayerType(type);
  }
}

function checkNpcMergeTrigger() {
  if (levelTransitionInProgress) return;
  if (!mapManager || !wasm) return;
  if (typeof wasm.GetNpcCount !== 'function' || typeof wasm.GetNpcX !== 'function' || typeof wasm.GetNpcY !== 'function' || typeof wasm.GetNpcType !== 'function') {
    return;
  }

  const playerBounds = getPlayerBounds();
  const currentType = playerBounds.type;
  const nextType = getNextPlayerType(currentType);
  if (nextType === currentType) {
    return;
  }

  const npcSnapshot = typeof mapManager.getCurrentNpcs === 'function'
    ? mapManager.getCurrentNpcs()
    : null;
  const npcCount = wasm.GetNpcCount();
  for (let index = 0; index < npcCount; index++) {
    const npcType = wasm.GetNpcType(index);
    if (npcType !== currentType) {
      continue;
    }

    const npcX = wasm.GetNpcX(index);
    const npcY = wasm.GetNpcY(index);
    const { width: npcWidth, height: npcHeight } = getSizeForPlayerType(npcType);

    if (!rectanglesOverlap(playerBounds.x, playerBounds.y, playerBounds.width, playerBounds.height, npcX, npcY, npcWidth, npcHeight)) {
      continue;
    }

    let row = Math.round(npcY / TILE_HEIGHT);
    let col = Math.round(npcX / TILE_WIDTH);

    let removedNpc = mapManager.removeNpcByIndex(mapManager.currentRoomX, mapManager.currentRoomY, index);
    if (!removedNpc && typeof mapManager.getCurrentNpcs === 'function') {
      const list = npcSnapshot || mapManager.getCurrentNpcs();
      const fallbackIndex = list.findIndex((npc) => npc.row === row && npc.col === col);
      if (fallbackIndex >= 0) {
        removedNpc = mapManager.removeNpcByIndex(mapManager.currentRoomX, mapManager.currentRoomY, fallbackIndex);
      }
    }
    if (!removedNpc) {
      continue;
    }

    row = Number.isFinite(removedNpc.row) ? removedNpc.row : row;
    col = Number.isFinite(removedNpc.col) ? removedNpc.col : col;
    const npcId = removedNpc.id || PLAYER_TYPE_TO_ANIMATION[currentType] || NPC_ANIMATION;
    const npcLabel = removedNpc.label || npcId;

    mergeHistory.push({
      previousType: currentType,
      spawnType: nextType,
      row,
      col,
      id: npcId,
      label: npcLabel,
    });

    sendCurrentRoomNpcData();
    setPlayerType(nextType);
    console.log(`Merged with NPC -> evolved to type ${nextType}`);
    return;
  }
}

function handleUnsplitting() {
  if (!unsplitRequested) {
    return;
  }
  unsplitRequested = false;

  if (mergeHistory.length === 0) {
    return;
  }
  if (levelTransitionInProgress) {
    return;
  }
  if (levelEditor && levelEditor.isEditorMode) {
    return;
  }
  if (!mapManager) {
    return;
  }

  const currentType = typeof wasm.GetPlayerType === 'function' ? wasm.GetPlayerType() : PLAYER_TYPE.BLOB;
  if (currentType === PLAYER_TYPE.BLOB) {
    return;
  }

  const record = mergeHistory.pop();
  const spawnType = record?.spawnType ?? currentType;
  const targetType = record?.previousType ?? getPreviousPlayerType(currentType);
  const bounds = getPlayerBounds();
  const spawnCol = record?.col ?? Math.max(0, Math.min(ROOM_TILE_COLS - 1, Math.floor((bounds.x + bounds.width / 2) / TILE_WIDTH)));
  const spawnRow = record?.row ?? Math.max(0, Math.min(ROOM_TILE_ROWS - 1, Math.floor((bounds.y + bounds.height - 1) / TILE_HEIGHT)));

  const npcId = record?.id ?? (PLAYER_TYPE_TO_ANIMATION[spawnType] ?? NPC_ANIMATION);
  const label = record?.label ?? npcId;

  if (mapManager.addNpcInCurrentRoom({ row: spawnRow, col: spawnCol, id: npcId, label })) {
    sendCurrentRoomNpcData();
  }

  setPlayerType(targetType);
  console.log(`Unsplitting -> reverted to type ${targetType}`);
}

function clampValue(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  if (numeric < min) {
    return min;
  }
  if (numeric > max) {
    return max;
  }
  return numeric;
}

function getLevelSpawnPoint(worldData) {
  if (!worldData || typeof worldData !== 'object') {
    return {
      roomX: 0,
      roomY: 0,
      x: clampValue(GAME_WIDTH * 0.5, 0, GAME_WIDTH),
      y: clampValue(GAME_HEIGHT - TILE_HEIGHT * 2, 0, GAME_HEIGHT),
    };
  }

  const worldWidth = Math.max(1, Math.floor(clampValue(worldData.worldWidth ?? 1, 1, 1024)));
  const worldHeight = Math.max(1, Math.floor(clampValue(worldData.worldHeight ?? 1, 1, 1024)));
  const roomWidthTiles = Math.max(1, Math.floor(clampValue(worldData.roomWidth ?? ROOM_TILE_COLS, 1, ROOM_TILE_COLS)));
  const roomHeightTiles = Math.max(1, Math.floor(clampValue(worldData.roomHeight ?? ROOM_TILE_ROWS, 1, ROOM_TILE_ROWS)));

  const clampRoomX = (value) => Math.max(0, Math.min(worldWidth - 1, Math.round(clampValue(value, 0, worldWidth - 1))));
  const clampRoomY = (value) => Math.max(0, Math.min(worldHeight - 1, Math.round(clampValue(value, 0, worldHeight - 1))));

  let spawnRoomX = clampRoomX(worldData.startRoomX ?? 0);
  let spawnRoomY = clampRoomY(worldData.startRoomY ?? 0);
  let spawnX = clampValue(GAME_WIDTH * 0.5, 0, GAME_WIDTH);
  let spawnY = clampValue(GAME_HEIGHT - TILE_HEIGHT * 2, 0, GAME_HEIGHT);

  const spawnConfig = worldData.playerSpawn;
  if (spawnConfig && typeof spawnConfig === 'object') {
    if (spawnConfig.roomX !== undefined) {
      spawnRoomX = clampRoomX(spawnConfig.roomX);
    }
    if (spawnConfig.roomY !== undefined) {
      spawnRoomY = clampRoomY(spawnConfig.roomY);
    }

    if (spawnConfig.x !== undefined) {
      spawnX = Number(spawnConfig.x);
    } else if (spawnConfig.col !== undefined) {
      spawnX = (Number(spawnConfig.col) + 0.5) * TILE_WIDTH;
    }

    if (spawnConfig.y !== undefined) {
      spawnY = Number(spawnConfig.y);
    } else if (spawnConfig.row !== undefined) {
      spawnY = (Number(spawnConfig.row) + 1) * TILE_HEIGHT;
    }
  }

  const maxSpawnX = roomWidthTiles * TILE_WIDTH - TILE_WIDTH;
  const maxSpawnY = roomHeightTiles * TILE_HEIGHT - TILE_HEIGHT;
  const maxPixelX = Math.max(TILE_WIDTH * 0.5, Math.min(maxSpawnX, GAME_WIDTH - TILE_WIDTH * 0.5));
  const maxPixelY = Math.max(TILE_HEIGHT, Math.min(maxSpawnY, GAME_HEIGHT - TILE_HEIGHT));
  spawnX = clampValue(spawnX, TILE_WIDTH * 0.5, maxPixelX);
  spawnY = clampValue(spawnY, TILE_HEIGHT, maxPixelY);

  return {
    roomX: spawnRoomX,
    roomY: spawnRoomY,
    x: spawnX,
    y: spawnY,
  };
}

function suggestNextLevelId() {
  if (!Array.isArray(levelManifest) || levelManifest.length === 0) {
    return 'level-1';
  }
  const existing = new Set(
    levelManifest
      .map((entry) => typeof entry?.id === 'string' ? entry.id.toLowerCase() : null)
      .filter((id) => id)
  );
  let counter = levelManifest.length + 1;
  let candidate = `level-${counter}`;
  while (existing.has(candidate.toLowerCase())) {
    counter += 1;
    candidate = `level-${counter}`;
  }
  return candidate;
}

function setLevelManifestDirty(flag) {
  levelManifestDirty = !!flag;
  const badge = document.getElementById('level-manifest-status');
  if (badge) {
    if (levelManifestDirty) {
      badge.textContent = 'unsaved manifest changes';
      badge.style.display = 'inline';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }
}

function ensureLevelCreationDialog() {
  if (levelCreationDialog && levelCreationBackdrop) {
    return levelCreationDialog;
  }

  levelCreationBackdrop = document.createElement('div');
  levelCreationBackdrop.id = 'level-creation-backdrop';
  levelCreationBackdrop.style.position = 'fixed';
  levelCreationBackdrop.style.inset = '0';
  levelCreationBackdrop.style.background = 'rgba(0, 0, 0, 0.6)';
  levelCreationBackdrop.style.display = 'none';
  levelCreationBackdrop.style.alignItems = 'center';
  levelCreationBackdrop.style.justifyContent = 'center';
  levelCreationBackdrop.style.zIndex = '1000';

  levelCreationDialog = document.createElement('div');
  levelCreationDialog.id = 'level-creation-dialog';
  levelCreationDialog.style.background = '#111';
  levelCreationDialog.style.border = '1px solid #444';
  levelCreationDialog.style.borderRadius = '8px';
  levelCreationDialog.style.padding = '16px';
  levelCreationDialog.style.width = '300px';
  levelCreationDialog.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.5)';
  levelCreationDialog.style.color = '#fff';
  levelCreationDialog.style.fontFamily = 'system-ui, sans-serif';

  const form = document.createElement('form');
  form.autocomplete = 'off';

  const title = document.createElement('h2');
  title.textContent = 'Create Level';
  title.style.margin = '0 0 12px 0';
  title.style.fontSize = '18px';
  form.appendChild(title);

  const description = document.createElement('p');
  description.textContent = `Set how many screens (rooms) wide and tall this level should be. Each screen is ${ROOM_TILE_COLS}×${ROOM_TILE_ROWS} tiles (${GAME_WIDTH}×${GAME_HEIGHT}px).`;
  description.style.margin = '0 0 12px 0';
  description.style.fontSize = '12px';
  description.style.lineHeight = '1.4';
  description.style.color = '#ccc';
  form.appendChild(description);

  const fields = [
    {
      label: 'Level ID',
      name: 'levelId',
      type: 'text',
      placeholder: 'level-name',
      min: null,
      max: null,
      defaultValue: '',
    },
    {
      label: `Screens Wide (max ${MAX_LEVEL_SCREENS_WIDE})`,
      name: 'screensWide',
      type: 'number',
      min: 1,
      max: MAX_LEVEL_SCREENS_WIDE,
      defaultValue: 1,
    },
    {
      label: `Screens Tall (max ${MAX_LEVEL_SCREENS_TALL})`,
      name: 'screensTall',
      type: 'number',
      min: 1,
      max: MAX_LEVEL_SCREENS_TALL,
      defaultValue: 1,
    },
    {
      label: 'Start Screen X',
      name: 'startRoomX',
      type: 'number',
      min: 0,
      max: MAX_LEVEL_SCREENS_WIDE - 1,
      defaultValue: 0,
    },
    {
      label: 'Start Screen Y',
      name: 'startRoomY',
      type: 'number',
      min: 0,
      max: MAX_LEVEL_SCREENS_TALL - 1,
      defaultValue: 0,
    },
  ];

  fields.forEach((field) => {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';
    wrapper.style.marginBottom = '10px';
    wrapper.style.fontSize = '12px';

    const span = document.createElement('span');
    span.textContent = field.label;
    wrapper.appendChild(span);

    const input = document.createElement('input');
    input.name = field.name;
    input.type = field.type;
    if (field.placeholder) {
      input.placeholder = field.placeholder;
    }
    if (field.min !== null && field.min !== undefined) {
      input.min = String(field.min);
    }
    if (field.max !== null && field.max !== undefined) {
      input.max = String(field.max);
    }
    input.value = field.defaultValue;
    input.style.padding = '6px';
    input.style.background = '#1b1b1b';
    input.style.color = '#fff';
    input.style.border = '1px solid #444';
    input.style.borderRadius = '4px';
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });

  const error = document.createElement('div');
  error.dataset.role = 'error';
  error.style.display = 'none';
  error.style.margin = '4px 0';
  error.style.fontSize = '12px';
  error.style.color = '#ff7b7b';
  form.appendChild(error);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';
  actions.style.marginTop = '16px';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.dataset.action = 'cancel';
  cancelButton.textContent = 'Cancel';
  cancelButton.style.padding = '6px 12px';
  cancelButton.style.background = '#222';
  cancelButton.style.color = '#fff';
  cancelButton.style.border = '1px solid #444';
  cancelButton.style.borderRadius = '4px';

  const createButton = document.createElement('button');
  createButton.type = 'submit';
  createButton.textContent = 'Create Level';
  createButton.style.padding = '6px 12px';
  createButton.style.background = '#2d7cff';
  createButton.style.color = '#fff';
  createButton.style.border = 'none';
  createButton.style.borderRadius = '4px';

  actions.appendChild(cancelButton);
  actions.appendChild(createButton);
  form.appendChild(actions);

  form.addEventListener('submit', handleLevelCreationSubmit);
  cancelButton.addEventListener('click', () => {
    closeLevelCreationDialog();
  });

  levelCreationDialog.appendChild(form);
  levelCreationBackdrop.appendChild(levelCreationDialog);
  document.body.appendChild(levelCreationBackdrop);
  return levelCreationDialog;
}

function openLevelCreationDialog() {
  ensureLevelCreationDialog();
  if (!levelCreationDialog || !levelCreationBackdrop) {
    return;
  }

  const form = levelCreationDialog.querySelector('form');
  if (form) {
    form.reset();
    const defaults = {
      levelId: suggestNextLevelId(),
      screensWide: 1,
      screensTall: 1,
      startRoomX: 0,
      startRoomY: 0,
    };
    Object.entries(defaults).forEach(([name, value]) => {
      const input = form.elements.namedItem(name);
      if (input) {
        input.value = value;
      }
    });
    const error = form.querySelector('[data-role="error"]');
    if (error) {
      error.style.display = 'none';
      error.textContent = '';
    }
    const idField = form.elements.namedItem('levelId');
    if (idField && typeof idField.focus === 'function') {
      setTimeout(() => idField.focus(), 0);
    }
  }

  levelCreationBackdrop.style.display = 'flex';
}

function closeLevelCreationDialog() {
  if (levelCreationBackdrop) {
    levelCreationBackdrop.style.display = 'none';
  }
}

function renderLevelCreationError(message) {
  if (!levelCreationDialog) {
    return;
  }
  const error = levelCreationDialog.querySelector('[data-role="error"]');
  if (!error) {
    return;
  }
  if (message) {
    error.textContent = message;
    error.style.display = 'block';
  } else {
    error.textContent = '';
    error.style.display = 'none';
  }
}

async function handleLevelCreationSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form) {
    return;
  }

  const idInput = form.elements.namedItem('levelId');
  const widthInput = form.elements.namedItem('screensWide');
  const heightInput = form.elements.namedItem('screensTall');
  const startXInput = form.elements.namedItem('startRoomX');
  const startYInput = form.elements.namedItem('startRoomY');

  const rawId = typeof idInput?.value === 'string' ? idInput.value.trim() : '';
  if (rawId.length === 0) {
    renderLevelCreationError('Level ID is required.');
    if (idInput && typeof idInput.focus === 'function') {
      idInput.focus();
    }
    return;
  }

  if (!/^[a-z0-9_\-]+$/i.test(rawId)) {
    renderLevelCreationError('Use letters, numbers, dashes, or underscores for the ID.');
    if (idInput && typeof idInput.focus === 'function') {
      idInput.focus();
    }
    return;
  }

  const normalizedId = rawId;
  if (
    Array.isArray(levelManifest) &&
    levelManifest.some((entry) => typeof entry?.id === 'string' && entry.id.toLowerCase() === normalizedId.toLowerCase())
  ) {
    renderLevelCreationError('A level with that ID already exists.');
    if (idInput && typeof idInput.focus === 'function') {
      idInput.focus();
    }
    return;
  }

  const roomsWide = Math.max(1, Math.min(
    MAX_LEVEL_SCREENS_WIDE,
    Math.round(clampValue(widthInput?.value ?? 1, 1, MAX_LEVEL_SCREENS_WIDE))
  ));
  const roomsTall = Math.max(1, Math.min(
    MAX_LEVEL_SCREENS_TALL,
    Math.round(clampValue(heightInput?.value ?? 1, 1, MAX_LEVEL_SCREENS_TALL))
  ));

  const startRoomX = Math.max(0, Math.min(
    roomsWide - 1,
    Math.round(clampValue(startXInput?.value ?? 0, 0, roomsWide - 1))
  ));
  const startRoomY = Math.max(0, Math.min(
    roomsTall - 1,
    Math.round(clampValue(startYInput?.value ?? 0, 0, roomsTall - 1))
  ));

  await createLevelFromEditor({
    id: normalizedId,
    roomsWide,
    roomsTall,
    startRoomX,
    startRoomY,
  });

  closeLevelCreationDialog();
}

async function createLevelFromEditor({ id, roomsWide, roomsTall, startRoomX, startRoomY }) {
  if (!Array.isArray(levelManifest)) {
    levelManifest = [];
  }

  const roomWidth = ROOM_TILE_COLS;
  const roomHeight = ROOM_TILE_ROWS;

  const rooms = Array.from({ length: roomsTall }, () => (
    Array.from({ length: roomsWide }, () => (
      Array.from({ length: roomHeight }, () => Array(roomWidth).fill(0))
    ))
  ));

  const npcGrid = Array.from({ length: roomsTall }, () => (
    Array.from({ length: roomsWide }, () => [])
  ));

  const entry = {
    id,
    path: `./${id}.json`,
    meta: {
      screensWide: roomsWide,
      screensTall: roomsTall,
    },
  };

  levelManifest.push(entry);
  const index = levelManifest.length - 1;
  setLevelManifestDirty(true);

  const world = {
    worldWidth: roomsWide,
    worldHeight: roomsTall,
    roomWidth,
    roomHeight,
    startRoomX,
    startRoomY,
    rooms,
    npcs: npcGrid,
    playerSpawn: {
      roomX: startRoomX,
      roomY: startRoomY,
      col: Math.floor(roomWidth / 2),
      row: Math.max(0, roomHeight - 3),
    },
  };

  let levelUrl = null;
  let levelRequestPath = entry.path;
  try {
    levelUrl = new URL(entry.path, LEVEL_MANIFEST_URL);
    if (levelUrl.origin === window.location.origin) {
      levelRequestPath = levelUrl.pathname;
    } else {
      levelRequestPath = levelUrl.href;
    }
  } catch (err) {
    console.warn(`Could not resolve URL for new level ${id}; using relative path.`, err);
  }

  const record = { data: world, url: levelUrl ? levelUrl.href : entry.path };
  levelDataCache.set(entry.id, record);

  const descriptor = { entry, index, url: record.url, requestPath: levelRequestPath };
  applyWorldData(world, { source: descriptor });
  currentLevelIndex = index;

  const updateSelector = () => {
    const select = document.getElementById('level-selector');
    if (select) {
      select.disabled = false;
      select.value = String(index);
    }
  };

  const editorContainer = document.getElementById('editor-container');
  if (editorContainer) {
    setupLevelSelector(editorContainer).then(updateSelector).catch((err) => {
      console.warn('Failed to refresh level selector after creating level.', err);
      updateSelector();
    });
  } else {
    updateSelector();
  }

  console.log(`Created new level "${id}" (${roomsWide}×${roomsTall} screens).`);

  const spawn = currentLevelSpawn || getLevelSpawnPoint(world);
  if (wasm) {
    if (typeof wasm.ResetPlayerState === 'function') {
      wasm.ResetPlayerState(spawn.roomX, spawn.roomY, spawn.x, spawn.y);
    } else if (typeof wasm.SetPlayerPosition === 'function') {
      wasm.SetPlayerPosition(spawn.x, spawn.y);
    }
  }

  initialNpcSyncPending = true;

  await Promise.all([
    (async () => {
      try {
        if (mapManager && typeof mapManager.saveWorld === 'function') {
          const target = descriptor.requestPath || record.url;
          const saved = await mapManager.saveWorld(target);
          if (saved) {
            console.log(`Initial data for "${id}" saved to server.`);
          } else {
            console.warn(`Automatic save for "${id}" fell back to browser download; upload the file manually if needed.`);
          }
        }
      } catch (err) {
        console.error(`Failed to auto-save level "${id}" to server.`, err);
      }
    })(),
    (async () => {
      const manifestSaved = await saveLevelManifestToServer({ silentFallback: true });
      if (manifestSaved) {
        console.log('Level manifest auto-saved after level creation.');
      } else {
        console.warn('Manifest auto-save failed; use Save Manifest to retry or copy the downloaded file.');
        setLevelManifestDirty(true);
      }
    })()
  ]);
}

async function saveLevelManifestToServer(options = {}) {
  if (!Array.isArray(levelManifest)) {
    console.warn('Level manifest is not available.');
    return false;
  }

  const manifestUrl = LEVEL_MANIFEST_URL?.href ?? String(LEVEL_MANIFEST_URL);
  if (!manifestUrl) {
    console.error('Level manifest URL could not be resolved; falling back to download.');
    downloadCurrentLevelManifest({ markClean: false });
    return false;
  }

  const body = JSON.stringify({ levels: levelManifest }, null, 2);

  try {
    const response = await fetch(manifestUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    console.log(`Level manifest saved to server (${manifestUrl}).`);
    setLevelManifestDirty(false);
    return true;
  } catch (error) {
    console.error('Failed to save level manifest to server.', error);
    if (!options?.silentFallback) {
      console.warn('Falling back to manifest download so you can copy it manually.');
      downloadCurrentLevelManifest({ markClean: false });
    }
    return false;
  }
}

function downloadCurrentLevelManifest({ markClean = false } = {}) {
  if (!Array.isArray(levelManifest)) {
    console.warn('Level manifest is not available.');
    return;
  }

  const payload = JSON.stringify({ levels: levelManifest }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.download = `manifest-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  if (markClean) {
    setLevelManifestDirty(false);
  }
}

async function setupLevelSelector(container) {
  if (!container) return;
  await ensureLevelManifestLoaded();
  if (!Array.isArray(levelManifest)) {
    levelManifest = [];
  }

  let wrapper = document.getElementById('level-selector-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = 'level-selector-wrapper';
    wrapper.style.marginBottom = '8px';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '8px';

    const label = document.createElement('label');
    label.textContent = 'Level:';
    label.htmlFor = 'level-selector';

    const select = document.createElement('select');
    select.id = 'level-selector';
    select.style.padding = '4px';
    select.style.background = '#111';
    select.style.color = '#fff';
    select.style.border = '1px solid #333';

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    container.insertBefore(wrapper, container.firstChild);
  }

  const select = wrapper.querySelector('select');
  if (!select) return;

  let createButton = document.getElementById('level-create-button');
  if (!createButton) {
    createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.id = 'level-create-button';
    createButton.textContent = 'New Level';
    createButton.style.padding = '6px 10px';
    createButton.style.background = '#2d7cff';
    createButton.style.color = '#fff';
    createButton.style.border = 'none';
    createButton.style.borderRadius = '4px';
    createButton.style.cursor = 'pointer';
    createButton.style.fontSize = '12px';
    createButton.addEventListener('click', () => {
      openLevelCreationDialog();
    });
    wrapper.appendChild(createButton);
  }

  let saveManifestButton = document.getElementById('level-manifest-save');
  if (!saveManifestButton) {
    saveManifestButton = document.createElement('button');
    saveManifestButton.type = 'button';
    saveManifestButton.id = 'level-manifest-save';
    saveManifestButton.textContent = 'Save Manifest';
    saveManifestButton.style.padding = '6px 10px';
    saveManifestButton.style.background = '#222';
    saveManifestButton.style.color = '#fff';
    saveManifestButton.style.border = '1px solid #444';
    saveManifestButton.style.borderRadius = '4px';
    saveManifestButton.style.cursor = 'pointer';
    saveManifestButton.style.fontSize = '12px';
    saveManifestButton.addEventListener('click', async () => {
      if (saveManifestButton.dataset.busy === 'true') {
        return;
      }
      saveManifestButton.dataset.busy = 'true';
      const originalText = saveManifestButton.textContent;
      saveManifestButton.textContent = 'Saving...';
      saveManifestButton.disabled = true;
      try {
        const success = await saveLevelManifestToServer({ silentFallback: false });
        if (success) {
          console.log('Level manifest saved.');
        }
      } finally {
        saveManifestButton.disabled = false;
        saveManifestButton.textContent = originalText;
        saveManifestButton.dataset.busy = 'false';
      }
    });
    wrapper.appendChild(saveManifestButton);
  }

  let statusBadge = document.getElementById('level-manifest-status');
  if (!statusBadge) {
    statusBadge = document.createElement('span');
    statusBadge.id = 'level-manifest-status';
    statusBadge.style.fontSize = '12px';
    statusBadge.style.color = '#ff9b5f';
    statusBadge.style.marginLeft = '4px';
    statusBadge.style.fontStyle = 'italic';
    statusBadge.style.display = 'none';
    wrapper.appendChild(statusBadge);
  }

  select.innerHTML = '';
  if (levelManifest.length === 0) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'No levels yet';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    select.disabled = true;
  } else {
    levelManifest.forEach((entry, idx) => {
      const option = document.createElement('option');
      option.value = String(idx);
      option.textContent = entry?.id || `Level ${idx + 1}`;
      select.appendChild(option);
    });
    select.disabled = false;

    const currentIdx = currentLevelDescriptor?.index ?? currentLevelIndex ?? 0;
    select.value = String(Math.min(Math.max(currentIdx, 0), levelManifest.length - 1));
  }

  setLevelManifestDirty(levelManifestDirty);

  if (!select.dataset.bound) {
    select.addEventListener('change', async (event) => {
      const idx = Number(event.target.value);
      if (!Number.isInteger(idx) || idx < 0 || idx >= levelManifest.length) {
        return;
      }
      levelTransitionInProgress = true;
      try {
        const loaded = await loadLevelByIndex(idx);
        if (loaded) {
          currentLevelIndex = idx;
          console.log(`Switched to level ${levelManifest[idx].id} via editor selector.`);
        }
      } finally {
        levelTransitionInProgress = false;
      }
    });
    select.dataset.bound = 'true';
  }
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
    rooms,
    playerSpawn: {
      roomX: startRoomX,
      roomY: startRoomY,
      col: Math.floor(roomWidth / 2),
      row: Math.max(0, roomHeight - 3),
    }
  };
}

function reconcileWithEmbeddedWorld(editorWorld) {
  let embedded;
  try {
    embedded = loadWorldFromWasm();
  } catch (err) {
    console.warn('Unable to load embedded world metadata; using editor JSON as-is.', err);
    return editorWorld;
  }

  const {
    worldWidth,
    worldHeight,
    roomWidth,
    roomHeight,
    startRoomX: embeddedStartX = 0,
    startRoomY: embeddedStartY = 0,
    rooms: baselineRooms
  } = embedded;

  const normalizedRooms = [];
  const sourceRooms = Array.isArray(editorWorld.rooms) ? editorWorld.rooms : [];

  for (let roomY = 0; roomY < worldHeight; roomY++) {
    const sourceRow = Array.isArray(sourceRooms[roomY]) ? sourceRooms[roomY] : [];
    const normalizedRow = [];
    for (let roomX = 0; roomX < worldWidth; roomX++) {
      const sourceRoom = Array.isArray(sourceRow[roomX]) ? sourceRow[roomX] : [];
      const normalizedRoom = [];
      for (let tileRow = 0; tileRow < roomHeight; tileRow++) {
        const sourceTileRow = Array.isArray(sourceRoom[tileRow]) ? sourceRoom[tileRow] : [];
        const rowData = new Array(roomWidth);
        for (let tileCol = 0; tileCol < roomWidth; tileCol++) {
          const value = sourceTileRow[tileCol];
          rowData[tileCol] = Number.isInteger(value) ? value : baselineRooms[roomY][roomX][tileRow][tileCol];
        }
        normalizedRoom.push(rowData);
      }
      normalizedRow.push(normalizedRoom);
    }
    normalizedRooms.push(normalizedRow);
  }

  const normalized = {
    worldWidth,
    worldHeight,
    roomWidth,
    roomHeight,
    startRoomX: Number.isInteger(editorWorld.startRoomX) ? editorWorld.startRoomX : embeddedStartX,
    startRoomY: Number.isInteger(editorWorld.startRoomY) ? editorWorld.startRoomY : embeddedStartY,
    rooms: normalizedRooms
  };

  if (Array.isArray(editorWorld.npcs)) {
    normalized.npcs = editorWorld.npcs;
  }

  if (editorWorld && typeof editorWorld.playerSpawn === 'object') {
    normalized.playerSpawn = editorWorld.playerSpawn;
  }

  return normalized;
}

function handleNpcEditorClick({ worldX, worldY }) {
  if (!mapManager || !wasm) {
    return false;
  }

  const { GetNpcCount, GetNpcX, GetNpcY, GetNpcFrame, GetNpcType } = wasm;
  if (typeof GetNpcCount !== 'function' || typeof GetNpcX !== 'function' || typeof GetNpcY !== 'function') {
    return false;
  }

  const npcCount = GetNpcCount();
  if (!npcCount || npcCount <= 0) {
    return false;
  }

  const fallbackNpcFrames = npcFrameLookup.get(NPC_ANIMATION);
  const defaultFrameSet = Array.isArray(fallbackNpcFrames) && fallbackNpcFrames.length > 0
    ? fallbackNpcFrames
    : (Array.isArray(atlasData?.[PLAYER_ANIMATION]) ? atlasData[PLAYER_ANIMATION] : []);
  const defaultWidth = defaultFrameSet[0]?.width ?? npcFrameWidth;
  const defaultHeight = defaultFrameSet[0]?.height ?? npcFrameHeight;

  for (let index = npcCount - 1; index >= 0; index--) {
    const npcX = GetNpcX(index);
    const npcY = GetNpcY(index);
    let width = defaultWidth;
    let height = defaultHeight;

    const npcTypeIndex = typeof GetNpcType === 'function'
      ? GetNpcType(index)
      : PLAYER_TYPE.WALKER;
    const animationKey = PLAYER_TYPE_TO_ANIMATION[npcTypeIndex] ?? NPC_ANIMATION;
    const frameSetCandidate = atlasData?.[animationKey];
    const frameSet = Array.isArray(frameSetCandidate) && frameSetCandidate.length > 0
      ? frameSetCandidate
      : defaultFrameSet;
    if (frameSet.length > 0) {
      width = frameSet[0]?.width ?? width;
      height = frameSet[0]?.height ?? height;
    }

    if (frameSet.length > 0 && typeof GetNpcFrame === 'function') {
      const frame = frameSet[GetNpcFrame(index) % frameSet.length];
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

  const playerTypeIndex = typeof wasm.GetPlayerType === 'function'
    ? wasm.GetPlayerType()
    : PLAYER_TYPE.BLOB;
  const playerAnimationKey = PLAYER_TYPE_TO_ANIMATION[playerTypeIndex] ?? PLAYER_ANIMATION;
  const playerFrames = atlasData[playerAnimationKey] || atlasData[PLAYER_ANIMATION];
  if (!Array.isArray(playerFrames) || playerFrames.length === 0) return;

  const fallbackNpcFrames = npcFrameLookup.get(NPC_ANIMATION);
  const defaultNpcFrames = Array.isArray(fallbackNpcFrames) && fallbackNpcFrames.length > 0
    ? fallbackNpcFrames
    : playerFrames;

  const characters = [];

  const getNpcCount = wasm.GetNpcCount;
  const getNpcX = wasm.GetNpcX;
  const getNpcY = wasm.GetNpcY;
  const getNpcFrame = wasm.GetNpcFrame;
  const getNpcType = wasm.GetNpcType;
  const getNpcFacing = wasm.GetNpcFacing;

  if (typeof getNpcCount === 'function' && typeof getNpcX === 'function' && typeof getNpcY === 'function') {
    const npcCount = getNpcCount();
    for (let i = 0; i < npcCount; i++) {
      const frameIndex = typeof getNpcFrame === 'function' ? getNpcFrame(i) : 0;
      const npcTypeIndex = typeof getNpcType === 'function' ? getNpcType(i) : PLAYER_TYPE.WALKER;
      const animationKey = PLAYER_TYPE_TO_ANIMATION[npcTypeIndex] ?? NPC_ANIMATION;
      const frameSetCandidate = atlasData?.[animationKey];
      const frameSet = Array.isArray(frameSetCandidate) && frameSetCandidate.length > 0
        ? frameSetCandidate
        : defaultNpcFrames;
      const frame = frameSet.length > 0 ? frameSet[frameIndex % frameSet.length] : null;
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

async function init() {
  try {
    // Initialize Poki SDK first
    try {
      await PokiSDK.init();
      console.log("Poki SDK successfully initialized");
      
      // Load any shared game state from URL
      loadGameStateFromURL();
    } catch (error) {
      console.log("Poki SDK initialization failed, continuing anyway", error);
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
    
    // Initialize WebGPU
    const gpuOk = await initWebGPU();
    if (!gpuOk) {
      throw new Error('WebGPU required but not available');
    }
    
    lastTime = performance.now();
    
    // Signal to Poki that game loading is finished
    if (typeof PokiSDK !== 'undefined') {
      PokiSDK.gameLoadingFinished();
      console.log('Poki: Game loading finished');
    }
    
    gameLoop(lastTime);
    
    console.log('Game loop started');
    
    // Start background music on first user interaction
    document.addEventListener('click', async () => {
      playMidiSong(true); // Loop enabled
      setMasterVolume(0.3); // Set volume to 30%
      
      // Show commercial break before starting gameplay for first time
      await showCommercialBreak();
      
      if (typeof PokiSDK !== 'undefined') {
        PokiSDK.gameplayStart();
        console.log('Poki: Initial gameplay started');
      }
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
  const rewardedAdBtn = document.getElementById('rewarded-ad-btn');
  const shareGameBtn = document.getElementById('share-game-btn');
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
      
      // Poki gameplay events
      if (typeof PokiSDK !== 'undefined') {
        if (isMenuOpen) {
          PokiSDK.gameplayStop();
          console.log('Poki: Gameplay stopped (menu opened)');
        } else {
          // Show commercial break before resuming gameplay
          showCommercialBreak().then(() => {
            if (typeof PokiSDK !== 'undefined') {
              PokiSDK.gameplayStart();
              console.log('Poki: Gameplay started (menu closed)');
            }
          });
        }
      }
      
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
  resumeBtn.addEventListener('click', async () => {
    isMenuOpen = false;
    gameMenu.style.display = 'none';
    
    // Show commercial break before resuming gameplay
    await showCommercialBreak();
    
    // Poki gameplay start
    if (typeof PokiSDK !== 'undefined') {
      PokiSDK.gameplayStart();
      console.log('Poki: Gameplay started (resume button)');
    }
  });
  
  // Rewarded ad button
  rewardedAdBtn.addEventListener('click', async () => {
    const success = await showRewardedBreak();
    
    if (success) {
      // Give player some reward (you can customize this)
      console.log('Poki: Player watched rewarded ad successfully - giving bonus!');
      // Here you could add coins, extra lives, power-ups, etc.
      // For now, just show a message
      alert('Bonus reward received! Thanks for watching!');
    } else {
      console.log('Poki: Player did not watch rewarded ad');
    }
  });
  
  // Share game button
  shareGameBtn.addEventListener('click', async () => {
    if (typeof PokiSDK !== 'undefined' && typeof PokiSDK.shareableURL === 'function') {
      try {
        // You can add custom parameters here for game state
        const params = {
          level: currentRoomX + '_' + currentRoomY,
          score: Math.floor(Math.random() * 1000), // Replace with actual score
          timestamp: Date.now()
        };
        
        const shareableUrl = await PokiSDK.shareableURL(params);
        
        // Copy to clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareableUrl);
          alert('Game URL copied to clipboard!\n\n' + shareableUrl);
        } else {
          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = shareableUrl;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
          alert('Game URL copied to clipboard!\n\n' + shareableUrl);
        }
        
        console.log('Poki: Shareable URL created:', shareableUrl);
      } catch (error) {
        console.error('Poki: Error creating shareable URL:', error);
        alert('Could not create shareable URL');
      }
    } else {
      // Fallback - just copy current URL
      const currentUrl = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(currentUrl);
        alert('Game URL copied to clipboard!\n\n' + currentUrl);
      } else {
        alert('Share this URL: ' + currentUrl);
      }
    }
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

// Poki SDK helper functions
function muteAudioForAd() {
  if (typeof setMasterVolume === 'function') {
    setMasterVolume(0);
    console.log('Poki: Audio muted for ad');
  }
}

function unmuteAudioForAd() {
  if (typeof setMasterVolume === 'function') {
    setMasterVolume(0.3); // Restore default volume
    console.log('Poki: Audio unmuted after ad');
  }
}

function disableInputForAd() {
  inputDisabledForAd = true;
  isAdPlaying = true;
  console.log('Poki: Input disabled for ad');
}

function enableInputForAd() {
  inputDisabledForAd = false;
  isAdPlaying = false;
  console.log('Poki: Input enabled after ad');
}

async function showCommercialBreak() {
  if (typeof PokiSDK === 'undefined') {
    return Promise.resolve();
  }
  
  console.log('Poki: Starting commercial break');
  
  return PokiSDK.commercialBreak(() => {
    muteAudioForAd();
    disableInputForAd();
  }).then(() => {
    console.log('Poki: Commercial break finished');
    unmuteAudioForAd();
    enableInputForAd();
  }).catch((error) => {
    console.log('Poki: Commercial break error, continuing anyway', error);
    unmuteAudioForAd();
    enableInputForAd();
  });
}

async function showRewardedBreak() {
  if (typeof PokiSDK === 'undefined') {
    return Promise.resolve(false);
  }
  
  console.log('Poki: Starting rewarded break');
  
  return PokiSDK.rewardedBreak(() => {
    muteAudioForAd();
    disableInputForAd();
  }).then((success) => {
    console.log('Poki: Rewarded break finished, success:', success);
    unmuteAudioForAd();
    enableInputForAd();
    return success;
  }).catch((error) => {
    console.log('Poki: Rewarded break error', error);
    unmuteAudioForAd();
    enableInputForAd();
    return false;
  });
}

function getURLParam(param) {
  if (typeof PokiSDK !== 'undefined' && typeof PokiSDK.getURLParam === 'function') {
    return PokiSDK.getURLParam(param);
  } else {
    // Fallback implementation
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
  }
}

function loadGameStateFromURL() {
  // Check for shared game parameters
  const level = getURLParam('level');
  const score = getURLParam('score');
  const timestamp = getURLParam('timestamp');
  
  if (level) {
    console.log('Poki: Loading shared game state - level:', level);
    
    // Parse level coordinates
    const coords = level.split('_');
    if (coords.length === 2) {
      const roomX = parseInt(coords[0], 10);
      const roomY = parseInt(coords[1], 10);
      
      if (!isNaN(roomX) && !isNaN(roomY)) {
        currentRoomX = roomX;
        currentRoomY = roomY;
        console.log('Poki: Set starting room to', roomX, roomY);
      }
    }
  }
  
  if (score) {
    console.log('Poki: Shared game score:', score);
    // Here you could restore the player's score
  }
  
  if (timestamp) {
    console.log('Poki: Shared game timestamp:', new Date(parseInt(timestamp, 10)));
  }
}

// Prevent page jump on arrow keys and spacebar
window.addEventListener('keydown', ev => {
    if (['ArrowDown', 'ArrowUp', ' '].includes(ev.key)) {
        ev.preventDefault();
    }
});
window.addEventListener('wheel', ev => ev.preventDefault(), { passive: false });

init();
setupMenuHandlers();
setupTouchControls();
setupVictoryScreen();

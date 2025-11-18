const DEFAULTS = {
  x: 16,
  y: 16,
  vx: 0,
  vy: 0,
  roomX: 0,
  roomY: 0,
  width: 32,
  height: 32,
  colliderWidth: 8,
  colliderHeight: 8,
  colliderOffsetX: 12,
  colliderOffsetY: 0,
  facing: 1,
  type: 0,
  onGround: false,
  frameTime: 0,
  currentFrame: 0,
  colliderRatio: 0.25,
  minColliderSize: 6,
};

export function createPlayerState(overrides = {}) {
  const player = {
    ...DEFAULTS,
    ...overrides,
  };
  if (!Number.isFinite(player.colliderRatio) || player.colliderRatio <= 0) {
    player.colliderRatio = DEFAULTS.colliderRatio;
  }
  if (!Number.isFinite(player.minColliderSize) || player.minColliderSize <= 0) {
    player.minColliderSize = DEFAULTS.minColliderSize;
  }
  syncColliderToSprite(player);
  return player;
}

export function setPlayerType(player, type, { autoResizeCollider = true } = {}) {
  player.type = type;
  if (autoResizeCollider) {
    syncColliderToSprite(player);
  }
}

export function setPlayerSpriteSize(player, width, height, {
  preserveBottom = true,
  colliderRatio,
  minColliderSize,
} = {}) {
  if (Number.isFinite(colliderRatio) && colliderRatio > 0) {
    player.colliderRatio = colliderRatio;
  }
  if (Number.isFinite(minColliderSize) && minColliderSize > 0) {
    player.minColliderSize = minColliderSize;
  }

  const prevBottom = preserveBottom ? (player.y + player.height) : null;
  if (Number.isFinite(width) && width > 0) {
    player.width = width;
  }
  if (Number.isFinite(height) && height > 0) {
    player.height = height;
  }
  syncColliderToSprite(player);
  if (preserveBottom && prevBottom !== null) {
    player.y = prevBottom - player.height;
  }
}

export function syncColliderToSprite(player) {
  const ratio = Number.isFinite(player.colliderRatio) ? player.colliderRatio : DEFAULTS.colliderRatio;
  const minSize = Number.isFinite(player.minColliderSize) ? player.minColliderSize : DEFAULTS.minColliderSize;
  const targetWidth = Math.max(minSize, Math.round(player.width * ratio));
  const targetHeight = Math.max(minSize, Math.round(player.height * ratio));
  player.colliderWidth = targetWidth;
  player.colliderHeight = targetHeight;
  player.colliderOffsetX = Math.round((player.width - targetWidth) * 0.5);
  player.colliderOffsetY = 0;
}

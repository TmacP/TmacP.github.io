export function handleRoomTransition(engine) {
  const { roomCols, roomRows, tileWidth, tileHeight } = engine.config;
  const roomWidth = roomCols * tileWidth;
  const roomHeight = roomRows * tileHeight;
  const player = engine.player;
  let changed = false;

  if (player.x < 0) {
    if (player.roomX > 0) {
      player.x += roomWidth;
      player.roomX -= 1;
      changed = true;
    } else {
      player.x = 0;
      player.vx = 0;
    }
  } else if (player.x + player.width > roomWidth) {
    if (player.roomX < (engine.worldWidthRooms - 1)) {
      player.x -= roomWidth;
      player.roomX += 1;
      changed = true;
    } else {
      player.x = roomWidth - player.width;
      player.vx = 0;
    }
  }

  if (player.y < 0) {
    if (player.roomY > 0) {
      player.y += roomHeight;
      player.roomY -= 1;
      changed = true;
    } else {
      player.y = 0;
      player.vy = 0;
    }
  } else if (player.y + player.height > roomHeight) {
    if (player.roomY < (engine.worldHeightRooms - 1)) {
      player.y -= roomHeight;
      player.roomY += 1;
      changed = true;
    } else {
      player.y = roomHeight - player.height;
      player.vy = 0;
      player.onGround = true;
    }
  }

  return changed;
}

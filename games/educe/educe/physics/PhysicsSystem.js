function getTile(engine, col, row) {
  return engine.getTileAt(col, row);
}

function isSolid(engine, tileId) {
  return engine.isSolidTile(tileId);
}

export function movePlayerWithCollision(engine, dx, dy) {
  const player = engine.player;
  const { tileWidth, tileHeight } = engine.config;
  const { colliderWidth: cW, colliderHeight: cH, colliderOffsetX: offX, colliderOffsetY: offY, height } = player;

  engine._debug.horiz.length = 0;
  engine._debug.vert.length = 0;

  if (dx !== 0) {
    let remaining = dx;
    const maxStep = Math.max(1, Math.floor(tileWidth - 1));
    while (Math.abs(remaining) > 0.0001) {
      const step = Math.abs(remaining) > maxStep ? Math.sign(remaining) * maxStep : remaining;
      const cx = player.x + offX;
      const cy = player.y + height - cH + offY;
      const tryCX = cx + step;
      const topRow = Math.floor((cy + 1) / tileHeight);
      const bottomRow = Math.floor((cy + cH - 2) / tileHeight);

      if (step > 0) {
        const rightCol = Math.floor((tryCX + cW - 1) / tileWidth);
        let hit = false;
        for (let row = topRow; row <= bottomRow; row++) {
          const solid = isSolid(engine, getTile(engine, rightCol, row));
          engine._debug.horiz.push({ col: rightCol, row, hit: !!solid });
          if (solid) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          player.x = tryCX - offX;
          remaining -= step;
        } else if (!attemptStepUp(engine, player, rightCol, cy, tryCX, tileHeight, cH, height, offX, offY)) {
          const snapCX = rightCol * tileWidth - cW;
          player.x = snapCX - offX;
          player.vx = 0;
          break;
        } else {
          remaining -= step;
        }
      } else {
        const leftCol = Math.floor(tryCX / tileWidth);
        let hit = false;
        for (let row = topRow; row <= bottomRow; row++) {
          const solid = isSolid(engine, getTile(engine, leftCol, row));
          engine._debug.horiz.push({ col: leftCol, row, hit: !!solid });
          if (solid) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          player.x = tryCX - offX;
          remaining -= step;
        } else if (!attemptStepUp(engine, player, leftCol, cy, tryCX, tileHeight, cH, height, offX, offY)) {
          const snapCX = (leftCol + 1) * tileWidth;
          player.x = snapCX - offX;
          player.vx = 0;
          break;
        } else {
          remaining -= step;
        }
      }
    }
  }

  if (dy !== 0) {
    let remaining = dy;
    const maxStep = Math.max(1, Math.floor(tileHeight - 1));
    if (dy < 0) {
      player.onGround = false;
    }
    while (Math.abs(remaining) > 0.0001) {
      const step = Math.abs(remaining) > maxStep ? Math.sign(remaining) * maxStep : remaining;
      const cx = player.x + offX;
      const cy = player.y + height - cH + offY;
      const tryCY = cy + step;
      const leftCol = Math.floor((cx + 1) / tileWidth);
      const rightCol = Math.floor((cx + cW - 2) / tileWidth);

      if (step > 0) {
        const bottomRow = Math.floor((tryCY + cH - 1) / tileHeight);
        let hit = false;
        for (let col = leftCol; col <= rightCol; col++) {
          const solid = isSolid(engine, getTile(engine, col, bottomRow));
          engine._debug.vert.push({ col, row: bottomRow, hit: !!solid });
          if (solid) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          player.y = tryCY - (height - cH) - offY;
          remaining -= step;
        } else {
          const snapCY = bottomRow * tileHeight - cH;
          player.y = snapCY - (height - cH) - offY;
          player.vy = 0;
          player.onGround = true;
          break;
        }
      } else {
        const topRow = Math.floor(tryCY / tileHeight);
        let hit = false;
        for (let col = leftCol; col <= rightCol; col++) {
          const solid = isSolid(engine, getTile(engine, col, topRow));
          engine._debug.vert.push({ col, row: topRow, hit: !!solid });
          if (solid) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          player.y = tryCY - (height - cH) - offY;
          remaining -= step;
        } else {
          const snapCY = (topRow + 1) * tileHeight;
          player.y = snapCY - (height - cH) - offY;
          player.vy = 0;
          break;
        }
      }
    }
  }
}

function attemptStepUp(engine, player, col, baseCY, tryCX, tileHeight, cH, height, offX, offY) {
  const maxStepUp = tileHeight;
  for (let s = 1; s <= maxStepUp; s++) {
    const testCY = baseCY - s;
    const tTop = Math.floor((testCY + 1) / tileHeight);
    const tBottom = Math.floor((testCY + cH - 2) / tileHeight);
    let clear = true;
    for (let r = tTop; r <= tBottom; r++) {
      const solid = isSolid(engine, getTile(engine, col, r));
      engine._debug.horiz.push({ col, row: r, hit: !!solid, stepUp: s });
      if (solid) {
        clear = false;
        break;
      }
    }
    if (clear) {
      player.y = testCY - (height - cH) - offY;
      player.x = tryCX - offX;
      return true;
    }
  }
  return false;
}

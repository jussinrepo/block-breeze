/* Block Breeze – Phaser 3 (Silent, Mobile-First, Phaser 3.60+)
 * - Fullscreen dynamic scaling
 * - Grab from anywhere + anchor-compensated snapping (no top-left aiming required)
 * - Strict FAIR racks: all three upcoming pieces are collectively placeable (backtracking)
 * - Row/Column clear FX: highlight + spark bursts (3.60+ emitter API)
 * - Game Over overlay with "Play Again" (no global input disable)
 * - No audio. Haptics are COMMENTED OUT for easy re-enable.
 */

const BOARD_SIZE = 8;
let CELL = 56; // recomputed on create()
const BOARD_PAD = 6;
const DEAL_SIZE = 3;

const COLORS = {
  bg: 0x24347d,
  board: 0x0f1e56,
  grid: 0x1f397f,
  text: '#ffffff',
};

const PIECE_PALETTES = [
  0xf44336, 0xff9800, 0xfdd835, 0x4caf50, 0x00bcd4, 0x3f51b5, 0x9c27b0
];

// <<< NEW: praise words (extend these freely) >>>
const PRAISE = {
  1: ["Good", "Nice", "OK!", "Yes!", "Keep it up!"],
  2: ["Great", "Rippin' it!", "Cool", "YAY!"],
  3: ["WOW!", "UBAH!", "Awesome!", "Peak!", "Rocking it!", "WHOAH!"],
  4: ["Spectacular!", "Excellent!", "Perfect!", "Flawless!", "YO YO YO!", "WOOT!!1!"],
};

const SHAPES = [
  [[1]],
  [[1,1]],
  [[1],[1]],
  [[1,1,1]],
  [[1],[1],[1]],
  [[1,1],[1,1]],
  [[1,0],[1,0],[1,1]],
  [[0,1],[0,1],[1,1]],
  [[1,1,0],[0,1,1]],
  [[0,1,1],[1,1,0]],
  [[1,1,1],[0,1,0]],
  [[1,1,1,1]],
  [[1],[1],[1],[1]],
  [[1,1,1],[1,0,0]],
  [[1,1,1],[0,0,1]],
  [[1,1],[1,1],[1,0]],
  [[1,1],[1,1],[0,1]],
];

const TEX_SIZE = 128;

class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
    this.board = this.emptyBoard();
    this.score = 0;
    this.best = parseInt(localStorage.getItem('blockbreeze_best') ?? '0', 10);
    this.multiplier = 1;
    this.deal = [];
    this.ui = {};
    this.ghostSprites = [];
    this.fxEmitter = null; // Phaser 3.60+ emitter
    this.isGameOver = false;

    // <<< NEW: rack slot geometry holder >>>
    this.rackSlots = null;
  }

  emptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
  }

  preload() {
    // Block texture
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, TEX_SIZE, TEX_SIZE, 22);
    g.lineStyle(10, 0xffffff, 0.22);
    g.strokeRoundedRect(0, 0, TEX_SIZE, TEX_SIZE, 22);
    g.generateTexture('block', TEX_SIZE, TEX_SIZE);

    // Ghost texture
    const gg = this.make.graphics({ x: 0, y: 0, add: false });
    gg.fillStyle(0xffffff, 0.18);
    gg.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    gg.lineStyle(4, 0xffffff, 0.33);
    gg.strokeRect(2, 2, TEX_SIZE - 4, TEX_SIZE - 4);
    gg.generateTexture('ghost', TEX_SIZE, TEX_SIZE);

    // Spark texture for FX
    const sg = this.make.graphics({ x: 0, y: 0, add: false });
    sg.fillStyle(0xffffff, 1);
    sg.beginPath();
    const cx = TEX_SIZE / 2, cy = TEX_SIZE / 2, spikes = 5, outer = TEX_SIZE * 0.36, inner = TEX_SIZE * 0.16;
    let rot = Math.PI / 2 * 3, x = cx, y = cy;
    const step = Math.PI / spikes;
    sg.moveTo(cx, cy - outer);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outer;
      y = cy + Math.sin(rot) * outer;
      sg.lineTo(x, y);
      rot += step;
      x = cx + Math.cos(rot) * inner;
      y = cy + Math.sin(rot) * inner;
      sg.lineTo(x, y);
      rot += step;
    }
    sg.lineTo(cx, cy - outer);
    sg.closePath();
    sg.fillPath();
    sg.generateTexture('spark', TEX_SIZE, TEX_SIZE);
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.isGameOver = false;
    this.computeLayout();

    // Board panel
    const bg = this.add.rectangle(
      this.boardPixel.x - BOARD_PAD,
      this.boardPixel.y - BOARD_PAD,
      this.boardPixel.w + BOARD_PAD * 2,
      this.boardPixel.h + BOARD_PAD * 2,
      COLORS.board, 1
    ).setOrigin(0);
    bg.setStrokeStyle(6, COLORS.grid, 1);

    // Grid
    const grid = this.add.graphics();
    grid.lineStyle(2, COLORS.grid, 0.8);
    for (let i = 0; i <= BOARD_SIZE; i++) {
      const gx = this.boardPixel.x + i * CELL;
      const gy = this.boardPixel.y + i * CELL;
      grid.lineBetween(this.boardPixel.x, gy, this.boardPixel.x + this.boardPixel.w, gy);
      grid.lineBetween(gx, this.boardPixel.y, gx, this.boardPixel.y + this.boardPixel.h);
    }

    // UI
    this.ui.score = this.add.text(this.centerX, this.boardPixel.y - Math.max(28, Math.round(CELL * 0.5)), '0', {
      fontSize: Math.round(Math.max(26, Math.min(42, CELL * 0.9))),
      color: COLORS.text,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.ui.best = this.add.text(this.width - 16, 12, `🏆 ${this.best}`, {
      fontSize: Math.round(Math.max(16, Math.min(24, CELL * 0.6))),
      color: '#ffeb3b',
    }).setOrigin(1, 0);

    // FX emitter (3.60+)
    this.fxEmitter = this.add.particles(0, 0, 'spark', {
      speed: { min: 80, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 450,
      gravityY: 400,
      quantity: 0,
      emitting: false,
      tint: [0xffffff, 0xfff176, 0x90caf9, 0xff8a65],
      blendMode: Phaser.BlendModes.ADD,
    });

    // Board cells layer
    this.cellsContainer = this.add.container(0, 0);
    this.drawBoard();

    // Rack
    this.rack = this.add.container(this.centerX, this.rackY);

    // Initial fair rack (all three collectively placeable)
    this.dealPieces(true);

    // Resize handling
    this.scale.on('resize', () => this.scene.restart());
  }

  // ----- Layout -----
  computeLayout() {
    const W = this.scale.gameSize.width;
    const H = this.scale.gameSize.height;
    this.width = W;
    this.height = H;
    this.centerX = Math.round(W / 2);

    const sidePad = 16;
    const topMargin = Math.max(16, Math.round(H * 0.06));
    const rackGap = Math.max(90, Math.min(160, Math.round(H * 0.18)));

    const maxByWidth = Math.floor((W - sidePad * 2 - BOARD_PAD * 2) / BOARD_SIZE);
    const maxByHeight = Math.floor((H - topMargin - rackGap - BOARD_PAD * 2) / BOARD_SIZE);
    CELL = Math.max(24, Math.min(72, Math.min(maxByWidth, maxByHeight)));

    this.boardPixel = {
      x: Math.round((W - BOARD_SIZE * CELL) / 2),
      y: topMargin,
      w: BOARD_SIZE * CELL,
      h: BOARD_SIZE * CELL,
    };

    this.rackY = Math.min(
      H - Math.max(24, Math.round(CELL * 1.0)),
      this.boardPixel.y + this.boardPixel.h + Math.max(48, Math.round(rackGap * 0.55))
    );

    // <<< NEW: compute slot geometry for left / middle / right >>>
    const availW = W - sidePad * 2;
    const slotW = Math.floor(availW / 3);
    // Slot height: generous but safe (uses available vertical space)
    const bottomMargin = 12;
    const maxSlotH = Math.max(CELL * 3, Math.min(CELL * 5, H - this.rackY - bottomMargin));
    // Keep a small gap so hit areas never overlap
    const gap = Math.max(6, Math.round(slotW * 0.06));
    const hitW = slotW - gap;     // non-overlapping width
    const hitH = maxSlotH;        // as tall as we can sensibly make it

    this.rackSlots = {
      slotW, slotH: maxSlotH, hitW, hitH,
      // centers relative to the rack container
      centers: [-slotW, 0, slotW]
    };
  }

  // ----- Board helpers -----
  drawBoard() {
    if (!this.cellsContainer) return;
    this.cellsContainer.removeAll(true);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const color = this.board[r][c];
        if (!color) continue;
        const s = this.add.image(0, 0, 'block').setTint(color);
        s.setDisplaySize(CELL - 6, CELL - 6);
        s.setPosition(
          this.boardPixel.x + c * CELL + CELL / 2,
          this.boardPixel.y + r * CELL + CELL / 2
        );
        this.cellsContainer.add(s);
      }
    }
  }

  boardFits(shape, row, col) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= BOARD_SIZE || cc >= BOARD_SIZE) return false;
        if (this.board[rr][cc]) return false;
      }
    }
    return true;
  }

  shapeFitsAnywhere(shape) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (this.boardFits(shape, r, c)) return true;
      }
    }
    return false;
  }

  placeShape(shape, row, col, tint) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        this.board[row + r][col + c] = tint;
      }
    }
    this.drawBoard();
  }

  // ----- FX -----
  highlightRow(rowIndex) {
    const rect = this.add.rectangle(
      this.boardPixel.x + this.boardPixel.w / 2,
      this.boardPixel.y + rowIndex * CELL + CELL / 2,
      this.boardPixel.w,
      CELL - 2,
      0xffff8d,
      0.25
    ).setDepth(5);
    this.tweens.add({ targets: rect, alpha: 0, duration: 260, ease: 'Sine.easeOut', onComplete: () => rect.destroy() });
  }

  highlightCol(colIndex) {
    const rect = this.add.rectangle(
      this.boardPixel.x + colIndex * CELL + CELL / 2,
      this.boardPixel.y + this.boardPixel.h / 2,
      CELL - 2,
      this.boardPixel.h,
      0x90caf9,
      0.25
    ).setDepth(5);
    this.tweens.add({ targets: rect, alpha: 0, duration: 260, ease: 'Sine.easeOut', onComplete: () => rect.destroy() });
  }

  // <<< NEW: praise popup >>>
  showPraise(linesCleared) {
    const n = Math.max(1, Math.min(4, linesCleared));
    const choices = PRAISE[n];
    if (!choices?.length) return;
    const phrase = Phaser.Utils.Array.GetRandom(choices);

    const x = this.boardPixel.x + this.boardPixel.w / 2;
    const y = this.boardPixel.y + Math.round(this.boardPixel.h * 0.35);

    const t = this.add.text(x, y, phrase, {
      fontSize: Math.round(Math.max(28, Math.min(46, CELL * 1.1))),
      fontStyle: 'bold',
      color: '#ffffff',
      align: 'center'
    })
      .setOrigin(0.5)
      .setDepth(9);

    t.setStroke('#000000', 6);

    // small particle pop
    this.fxEmitter && this.fxEmitter.explode(18, x, y);

    // float + fade animation
    this.tweens.add({
      targets: t,
      y: y - Math.max(32, Math.round(CELL * 0.8)),
      scale: { from: 0.9, to: 1.1 },
      alpha: { from: 1, to: 0 },
      duration: 2000,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy()
    });
  }

  clearLines() {
    const fullRows = [];
    const fullCols = [];

    for (let r = 0; r < BOARD_SIZE; r++) {
      if (this.board[r].every(v => v !== 0)) fullRows.push(r);
    }
    for (let c = 0; c < BOARD_SIZE; c++) {
      let full = true;
      for (let r = 0; r < BOARD_SIZE; r++) if (!this.board[r][c]) { full = false; break; }
      if (full) fullCols.push(c);
    }

    if (fullRows.length === 0 && fullCols.length === 0) {
      this.multiplier = 1;
      return 0;
    }

    fullRows.forEach(r => this.highlightRow(r));
    fullCols.forEach(c => this.highlightCol(c));

    const toClear = new Set();
    fullRows.forEach(r => { for (let c = 0; c < BOARD_SIZE; c++) toClear.add(`${r},${c}`); });
    fullCols.forEach(c => { for (let r = 0; r < BOARD_SIZE; r++) toClear.add(`${r},${c}`); });

    toClear.forEach(key => {
      const [r, c] = key.split(',').map(Number);
      this.board[r][c] = 0;
      const x = this.boardPixel.x + c * CELL + CELL / 2;
      const y = this.boardPixel.y + r * CELL + CELL / 2;
      this.fxEmitter && this.fxEmitter.explode(12, x, y);
    });

    // Haptics (commented out)
    // navigator.vibrate?.(20);

    const cleared = toClear.size;
    const lines = fullRows.length + fullCols.length; // <<< NEW: number of lines cleared >>>

    const base = cleared * 10;
    const bonus = (lines - 1) * 50;
    const gained = Math.round((base + bonus) * this.multiplier);
    this.score += gained;
    this.multiplier += 0.1;
    this.updateScore();

    // Praise popup
    if (lines > 0) this.showPraise(lines);

    this.time.delayedCall(60, () => this.drawBoard());
    return cleared;
  }

  updateScore() {
    this.ui.score.setText(`${this.score}`);
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('blockbreeze_best', String(this.best));
      this.ui.best.setText(`🏆 ${this.best}`);
    }
  }

  // ----- Fair dealing (collectively placeable rack) -----
  placementsForShape(boardSnap, shape) {
    const spots = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        let ok = true;
        for (let rr = 0; rr < shape.length && ok; rr++) {
          for (let cc = 0; cc < shape[rr].length; cc++) {
            if (!shape[rr][cc]) continue;
            const R = r + rr, C = c + cc;
            if (R < 0 || C < 0 || R >= BOARD_SIZE || C >= BOARD_SIZE || boardSnap[R][C]) { ok = false; break; }
          }
        }
        if (ok) spots.push({ r, c });
      }
    }
    return spots;
  }

  applyShape(boardSnap, shape, pos, fillVal = 1) {
    const copy = boardSnap.map(row => row.slice());
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        copy[pos.r + r][pos.c + c] = fillVal;
      }
    }
    return copy;
  }

  canPlaceAllOnBoard(boardSnap, shapes) {
    if (shapes.length === 0) return true;
    // choose the shape with fewest placements first
    let bestIdx = 0, bestSpots = null;
    for (let i = 0; i < shapes.length; i++) {
      const spots = this.placementsForShape(boardSnap, shapes[i]);
      if (spots.length === 0) return false;
      if (!bestSpots || spots.length < bestSpots.length) {
        bestSpots = spots;
        bestIdx = i;
      }
    }
    const [shape] = shapes.splice(bestIdx, 1);
    for (const pos of bestSpots) {
      const nextBoard = this.applyShape(boardSnap, shape, pos, 1);
      if (this.canPlaceAllOnBoard(nextBoard, shapes.slice())) return true;
    }
    return false;
  }

  makeFairTrio() {
    const attempts = 120;
    for (let k = 0; k < attempts; k++) {
      const trio = [
        Phaser.Utils.Array.GetRandom(SHAPES),
        Phaser.Utils.Array.GetRandom(SHAPES),
        Phaser.Utils.Array.GetRandom(SHAPES),
      ];
      // Quick filter: each individually placeable
      if (!trio.every(s => this.shapeFitsAnywhere(s))) continue;
      // Strict check: trio placeable together (in some order)
      const snap = this.board.map(row => row.slice());
      if (this.canPlaceAllOnBoard(snap, trio.slice())) return trio;
    }
    return null;
  }

  dealPieces(fair = false) {
    this.deal = [];
    this.rack.removeAll(true);

    let shapes;
    if (fair) {
      shapes = this.makeFairTrio();
      if (!shapes) {
        // No valid trio exists -> Game Over
        this.time.delayedCall(10, () => this.gameOver());
        return;
      }
    } else {
      shapes = Array.from({ length: DEAL_SIZE }, () => Phaser.Utils.Array.GetRandom(SHAPES));
    }

    // <<< NEW: place pieces left / middle / right with large, non-overlapping hit areas >>>
    const { centers, hitW, hitH, slotW } = this.rackSlots;

    shapes.forEach((shape, i) => {
      const tint = Phaser.Utils.Array.GetRandom(PIECE_PALETTES);

      // create piece visuals + interaction
      const piece = this.createPiece(shape, tint, hitW, hitH);

      // position into the i-th slot (-slotW, 0, +slotW)
      piece.x = centers[i];
      piece.y = 0;

      // (optional) show weak slot bounds for debugging:
      // const dbg = this.add.rectangle(0, 0, hitW, hitH, 0xff0000, 0.06).setStrokeStyle(1, 0xff0000, 0.2);
      // piece.add(dbg);

      this.rack.add(piece);
      this.deal.push(piece);
    });
  }

  allPiecesPlaced() {
    return this.deal.every(p => p.placed);
  }

  anyPlacementAvailable() {
    for (const piece of this.deal.filter(p => !p.placed)) {
      if (this.shapeFitsAnywhere(piece.shape)) return true;
    }
    return false;
  }

  // ----- Piece creation / drag -----
  containerTopLeftWorld(cont) {
    // Convert container local (-w/2,-h/2) to world coordinates of the PIECE (not the big hit area)
    return { x: this.rack.x + cont.x - cont.bounds.w / 2, y: this.rack.y + cont.y - cont.bounds.h / 2 };
  }

  // <<< CHANGED: accept hit rect width/height to make grab area large (slot-sized) >>>
  createPiece(shape, tint, hitW, hitH) {
    const cont = this.add.container(0, 0);
    cont.shape = shape;
    cont.tint = tint;
    cont.placed = false;

    // Render blocks (visual size is the actual piece)
    const blocks = [];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const s = this.add.image(c * CELL, r * CELL, 'block').setOrigin(0).setTint(tint);
        s.setDisplaySize(CELL - 6, CELL - 6);
        cont.add(s);
        blocks.push(s);
      }
    }

    // Center local positions and set visual size/bounds (for snapping math)
    const w = shape[0].length * CELL;
    const h = shape.length * CELL;
    blocks.forEach(b => { b.x -= w / 2; b.y -= h / 2; });
    cont.bounds = { w, h };

    // >>> Large, non-overlapping hit area (slot sized)
    // Use a big rect but keep snapping anchored to the piece's visual top-left via dragOffset math.
    const hw = Math.max(hitW ?? w, 1);
    const hh = Math.max(hitH ?? h, 1);
    cont.setInteractive(
      new Phaser.Geom.Rectangle(-hw / 2, -hh / 2, hw, hh),
      Phaser.Geom.Rectangle.Contains
    );
    this.input.setDraggable(cont);

    // Drag-anchor compensation
    cont.dragOffset = { x: 0, y: 0 }; // where inside the piece the user grabbed (pixels from piece top-left)
    cont.on('dragstart', (pointer) => {
      if (this.isGameOver || cont.placed) return;
      cont.setScale(1.05);

      // Compute offset relative to the *piece* top-left, not the big hit rect:
      const topLeft = this.containerTopLeftWorld(cont);
      cont.dragOffset.x = pointer.worldX - topLeft.x;
      cont.dragOffset.y = pointer.worldY - topLeft.y;

      // Remember starting absolute pos for snap-back
      cont.startPos = { x: cont.parentContainer.x + cont.x, y: cont.parentContainer.y + cont.y };
      this.showGhost(cont);
    });

    cont.on('drag', (pointer, dragX, dragY) => {
      if (this.isGameOver || cont.placed) return;
      cont.x = dragX - this.rack.x;
      cont.y = dragY - this.rack.y;
      this.updateGhostWithOffset(cont, pointer.worldX, pointer.worldY);
    });

    cont.on('dragend', (pointer) => {
      if (this.isGameOver || cont.placed) return;
      const cell = this.worldToCellWithOffset(pointer.worldX, pointer.worldY, cont.dragOffset);
      if (cell && this.boardFits(cont.shape, cell.r, cell.c)) {
        this.placeShape(cont.shape, cell.r, cell.c, cont.tint);
        cont.placed = true;
        cont.visible = false;
        // Haptics (commented out)
        // navigator.vibrate?.(15);
        this.clearGhost();
        this.clearLines();
        if (this.allPiecesPlaced()) this.dealPieces(true);
        this.time.delayedCall(80, () => {
          if (!this.anyPlacementAvailable()) this.gameOver();
        });
      } else {
        // Snap back
        // navigator.vibrate?.(5);
        this.tweens.add({
          targets: cont,
          x: cont.startPos.x - this.rack.x,
          y: cont.startPos.y - this.rack.y,
          scale: 1,
          duration: 120,
          ease: 'Sine.easeOut',
          onComplete: () => this.clearGhost(),
        });
      }
    });

    return cont;
  }

  worldToCell(wx, wy) {
    const x = wx - this.boardPixel.x;
    const y = wy - this.boardPixel.y;
    if (x < 0 || y < 0) return null;
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) return null;
    return { r, c };
  }

  worldToCellWithOffset(wx, wy, offset) {
    // Translate pointer to shape's top-left based on grab offset
    return this.worldToCell(wx - offset.x, wy - offset.y);
  }

  showGhost(piece) {
    this.clearGhost();
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < piece.shape[r].length; c++) {
        if (!piece.shape[r][c]) continue;
        const spr = this.add.image(0, 0, 'ghost').setDisplaySize(CELL - 4, CELL - 4).setDepth(2);
        this.ghostSprites.push(spr);
      }
    }
  }

  updateGhostWithOffset(piece, wx, wy) {
    const cell = this.worldToCellWithOffset(wx, wy, piece.dragOffset);
    let i = 0;
    if (!cell) {
      this.ghostSprites.forEach(s => s.setVisible(false));
      return;
    }
    const fits = this.boardFits(piece.shape, cell.r, cell.c);
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < piece.shape[r].length; c++) {
        if (!piece.shape[r][c]) continue;
        const spr = this.ghostSprites[i++];
        spr.setVisible(true);
        spr.setTint(fits ? 0xffffff : 0xff4444);
        spr.setPosition(
          this.boardPixel.x + (cell.c + c) * CELL + CELL / 2,
          this.boardPixel.y + (cell.r + r) * CELL + CELL / 2
        );
      }
    }
  }

  clearGhost() {
    this.ghostSprites.forEach(s => s.destroy());
    this.ghostSprites = [];
  }

  // ----- Game over -----
  gameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    const W = this.scale.gameSize.width;
    const H = this.scale.gameSize.height;

    const veil = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.5).setDepth(10);
    const panel = this.add.rectangle(W / 2, H / 2, Math.min(460, W * 0.9), 280, 0x1f2f77, 1).setDepth(11);
    panel.setStrokeStyle(6, COLORS.grid, 1);
    const title = this.add.text(W / 2, H / 2 - 96, 'Block Breeze', {
      fontSize: 36, color: '#fff', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(12);
    const scoreTxt = this.add.text(
      W / 2, H / 2 - 28,
      `Game Over\nScore: ${this.score}\nBest: ${this.best}`,
      { fontSize: 22, color: '#ffeb3b', align: 'center' }
    ).setOrigin(0.5).setDepth(12);
    const btn = this.add.text(W / 2, H / 2 + 70, 'Play Again', {
      fontSize: 26, color: '#ffffff', backgroundColor: '#3b4bd1', padding: { x: 16, y: 8 }
    }).setOrigin(0.5).setDepth(12).setInteractive({ useHandCursor: true });

    btn.on('pointerdown', () => {
      // Reset state
      this.board = this.emptyBoard();
      this.score = 0;
      this.multiplier = 1;
      this.updateScore();
      this.drawBoard();
      this.rack.removeAll(true);
      this.deal = [];
      this.isGameOver = false;
      this.dealPieces(true);
      veil.destroy(); panel.destroy(); title.destroy(); scoreTxt.destroy(); btn.destroy();
    });
  }
}

// ----- Game config -----
const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.bg,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
  scene: [GameScene],
};
new Phaser.Game(config);

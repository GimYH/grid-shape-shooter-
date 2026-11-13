import { GridTile, TileColor, Cluster, ShapePatternType } from '../types/game';

export const GRID_COLS = 8;
export const GRID_ROWS = 4;
export const BASE_REFILL_TIME = 2.0;

export const TILE_COLORS: TileColor[] = ['red', 'blue', 'yellow'];

export const COLOR_HEX: Record<TileColor, string> = {
  red: '#FF3366',
  blue: '#33CCFF',
  yellow: '#FFCC00',
};

// Serializable board state for online reconciliation (board_sync packets).
export interface BoardSnapshot {
  colors: (TileColor | null)[][];
  cooldowns: number[][];
}

export class GridBoard {
  public tiles: GridTile[][] = [];
  public clusters: Cluster[] = [];
  public owner: 'player' | 'enemy';
  private rngSeed: number = 1234567;
  // True when this board stores the MIRRORED copy of a remote player's board
  // (online only: the remote player's front row must appear adjacent to the
  // screen center). Mirrored boards scan rows in reverse during update() so
  // refill RNG draws happen in the sender's row-major order and the two
  // copies stay aligned.
  public mirrored: boolean = false;

  constructor(owner: 'player' | 'enemy', seed?: number) {
    this.owner = owner;
    this.reset(seed);
  }

  public nextRandom(): number {
    this.rngSeed = (this.rngSeed * 9301 + 49297) % 233280;
    return this.rngSeed / 233280;
  }

  // `mirrored`: store the board flipped vertically (row r holds the
  // sender's row GRID_ROWS-1-r). Online only, for the local copy of the
  // remote player's board: every remote action (launch/discard/skill) is
  // applied with flipped rows, so the stored layout must be flipped too,
  // or the initial tiles and the flipped actions disagree about which tile
  // is which. The RNG stream is identical either way: generation runs in
  // the same order, then the rows are reversed.
  public reset(seed?: number, mirrored: boolean = false) {
    if (seed !== undefined) {
      this.rngSeed = Math.abs(seed) || 1234567;
    }
    this.mirrored = mirrored;
    this.tiles = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      const row: GridTile[] = [];
      for (let c = 0; c < GRID_COLS; c++) {
        const randIndex = Math.floor(this.nextRandom() * TILE_COLORS.length);
        const randColor = TILE_COLORS[randIndex];
        row.push({
          col: c,
          row: r,
          color: randColor,
          cooldownRemaining: 0,
          pulsePhase: this.nextRandom() * Math.PI * 2,
        });
      }
      this.tiles.push(row);
    }
    if (mirrored) {
      this.tiles.reverse();
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          this.tiles[r][c].row = r;
          this.tiles[r][c].col = c;
        }
      }
    }
    this.updateClusters(false);
  }

  public update(dt: number, cooldownSpeedMult: number = 1.0, isSniper: boolean = false): boolean {
    let hasRefilled = false;

    // Mirrored boards scan bottom-to-top so refill RNG draws land on the
    // same logical tiles as on the sender's side (sender scans top-to-
    // bottom in its own frame). Cooldown/pulse updates are order-free.
    const rowOrder: number[] = [];
    for (let i = 0; i < GRID_ROWS; i++) rowOrder.push(this.mirrored ? GRID_ROWS - 1 - i : i);
    for (const r of rowOrder) {
      for (let c = 0; c < GRID_COLS; c++) {
        const tile = this.tiles[r][c];
        tile.pulsePhase += dt * 3;

        if (tile.cooldownRemaining > 0) {
          tile.cooldownRemaining -= dt * cooldownSpeedMult;
          if (tile.cooldownRemaining <= 0) {
            tile.cooldownRemaining = 0;
            const randIndex = Math.floor(this.nextRandom() * TILE_COLORS.length);
            tile.color = TILE_COLORS[randIndex];
            hasRefilled = true;
          }
        }
      }
    }

    this.updateClusters(isSniper);
    return hasRefilled;
  }

  public updateClusters(isSniper: boolean) {
    const visited: boolean[][] = Array.from({ length: GRID_ROWS }, () =>
      Array(GRID_COLS).fill(false)
    );
    const newClusters: Cluster[] = [];

    const dirs = [
      { dc: 1, dr: 0 },
      { dc: -1, dr: 0 },
      { dc: 0, dr: 1 },
      { dc: 0, dr: -1 },
    ];

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (visited[r][c]) continue;
        const startTile = this.tiles[r][c];
        if (!startTile.color) continue; // In cooldown

        const color = startTile.color;
        const group: { col: number; row: number }[] = [];
        const queue: { col: number; row: number }[] = [{ col: c, row: r }];
        visited[r][c] = true;

        while (queue.length > 0) {
          const current = queue.shift()!;
          group.push(current);

          for (const d of dirs) {
            const nc = current.col + d.dc;
            const nr = current.row + d.dr;

            if (nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS) {
              if (!visited[nr][nc]) {
                const neighbor = this.tiles[nr][nc];
                if (neighbor.color === color) {
                  visited[nr][nc] = true;
                  queue.push({ col: nc, row: nr });
                }
              }
            }
          }
        }

        const minLaunchSize = isSniper ? 1 : 3;
        const isActive = group.length >= minLaunchSize;
        const { shapeType, shapeTitle } = this.detectShapePattern(group);

        newClusters.push({
          id: `${this.owner}_${r}_${c}_${color}_${group.length}`,
          color,
          tiles: group,
          isActivePad: isActive,
          shapeType,
          shapeTitle,
        });
      }
    }

    this.clusters = newClusters;
  }

  // Find which cluster contains (col, row)
  public getClusterAt(col: number, row: number): Cluster | null {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null;
    return this.clusters.find((cl) => cl.tiles.some((t) => t.col === col && t.row === row)) || null;
  }

  // Detect shape patterns
  public detectShapePattern(tiles: { col: number; row: number }[]): {
    shapeType: ShapePatternType;
    shapeTitle: string;
  } {
    const tileSet = new Set(tiles.map((t) => `${t.col},${t.row}`));

    // Check Meteor Burst (T-shape or Cross shape >= 5)
    if (tiles.length >= 5) {
      for (const t of tiles) {
        let orthogonalNeighbors = 0;
        if (tileSet.has(`${t.col + 1},${t.row}`)) orthogonalNeighbors++;
        if (tileSet.has(`${t.col - 1},${t.row}`)) orthogonalNeighbors++;
        if (tileSet.has(`${t.col},${t.row + 1}`)) orthogonalNeighbors++;
        if (tileSet.has(`${t.col},${t.row - 1}`)) orthogonalNeighbors++;

        // 3 or 4 neighbors means a T junction or cross intersection!
        if (orthogonalNeighbors >= 3) {
          return { shapeType: 'meteor', shapeTitle: 'Meteor Burst [메테오 버스트]' };
        }
      }
    }

    // Check Homing Core (2x2 square)
    for (const t of tiles) {
      if (
        tileSet.has(`${t.col + 1},${t.row}`) &&
        tileSet.has(`${t.col},${t.row + 1}`) &&
        tileSet.has(`${t.col + 1},${t.row + 1}`)
      ) {
        return { shapeType: 'homing', shapeTitle: 'Homing Core [유도 코어]' };
      }
    }

    // Check Piercing Spear (Vertical 1x3, 1x4)
    for (const t of tiles) {
      if (
        tileSet.has(`${t.col},${t.row + 1}`) &&
        tileSet.has(`${t.col},${t.row + 2}`)
      ) {
        return { shapeType: 'spear', shapeTitle: 'Piercing Spear [관통 스피어]' };
      }
    }

    // Check Shockwave Wall (Horizontal 3x1, 4x1)
    for (const t of tiles) {
      if (
        tileSet.has(`${t.col + 1},${t.row}`) &&
        tileSet.has(`${t.col + 2},${t.row}`)
      ) {
        return { shapeType: 'wall', shapeTitle: 'Shockwave Wall [충격파 월]' };
      }
    }

    return { shapeType: 'standard', shapeTitle: 'Standard Shape [기본 블록]' };
  }

  // Launch cluster -> turn all into cooldown
  public launchCluster(cluster: Cluster, customCooldown: number = BASE_REFILL_TIME) {
    for (const t of cluster.tiles) {
      const tile = this.tiles[t.row][t.col];
      tile.color = null;
      tile.cooldownRemaining = customCooldown;
    }
  }

  // Fast discard single tile or small unprimed group (0.7s reload)
  public discardTile(col: number, row: number, customCooldown: number = 0.7): boolean {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return false;
    const tile = this.tiles[row][col];
    if (!tile.color) return false; // Already in cooldown

    tile.color = null;
    tile.cooldownRemaining = customCooldown;
    return true;
  }

  // Calculate dominant color on board
  public getDominantColor(): TileColor {
    const counts: Record<TileColor, number> = { red: 0, blue: 0, yellow: 0 };
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const colr = this.tiles[r][c].color;
        if (colr) counts[colr]++;
      }
    }
    if (counts.blue >= counts.red && counts.blue >= counts.yellow) return 'blue';
    if (counts.yellow >= counts.red && counts.yellow >= counts.blue) return 'yellow';
    return 'red';
  }

  // Refill entire row (Wave skill). Rolls with Math.random and RETURNS the
  // refilled tiles: in online play the sender includes them in the skill
  // packet (SkillEffect) and the remote side applies them verbatim with
  // refillRowWith(). The board's seeded RNG is deliberately NOT used here:
  // frame-timing differences change the draw order between clients, so a
  // seeded roll on both sides still drifts. Only refills inside update()
  // use the seeded RNG.
  public refillRow(row: number): { col: number; row: number; color: TileColor }[] {
    if (row < 0 || row >= GRID_ROWS) return [];
    const picks: { col: number; row: number; color: TileColor }[] = [];
    for (let c = 0; c < GRID_COLS; c++) {
      if (this.tiles[row][c].cooldownRemaining > 0) {
        const color = TILE_COLORS[Math.floor(Math.random() * TILE_COLORS.length)];
        this.tiles[row][c].cooldownRemaining = 0;
        this.tiles[row][c].color = color;
        picks.push({ col: c, row, color });
      }
    }
    return picks;
  }

  // Apply a Wave refill received from the remote player: exact tiles, no roll.
  public refillRowWith(row: number, picks: { col: number; row: number; color: TileColor }[]) {
    if (row < 0 || row >= GRID_ROWS) return;
    for (const p of picks) {
      if (p.row !== row || p.col < 0 || p.col >= GRID_COLS) continue;
      this.tiles[row][p.col].cooldownRemaining = 0;
      this.tiles[row][p.col].color = p.color;
    }
  }

  // Convert column tiles (Lancer skill)
  public convertColumnToRed(col: number, count: number = 2) {
    if (col < 0 || col >= GRID_COLS) return;
    let converted = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      if (converted >= count) break;
      const tile = this.tiles[r][col];
      tile.color = 'red';
      tile.cooldownRemaining = 0;
      converted++;
    }
  }

  // Convert random tiles to red (Monochrome skill). Rolls with Math.random
  // and RETURNS the chosen tiles; online, the sender carries them in the
  // skill packet and the remote side applies convertTilesToRed(). Same
  // reasoning as refillRow: never roll the same effect twice.
  public convertRandomToRed(count: number = 3): { col: number; row: number }[] {
    const picked: { col: number; row: number }[] = [];
    const candidates: { col: number; row: number }[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.tiles[r][c].color !== 'red') {
          candidates.push({ col: c, row: r });
        }
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const t of candidates) {
      if (picked.length >= count) break;
      this.tiles[t.row][t.col].color = 'red';
      this.tiles[t.row][t.col].cooldownRemaining = 0;
      picked.push(t);
    }
    return picked;
  }

  // Apply a Monochrome conversion received from the remote player.
  public convertTilesToRed(tiles: { col: number; row: number }[]) {
    for (const t of tiles) {
      if (t.col < 0 || t.col >= GRID_COLS || t.row < 0 || t.row >= GRID_ROWS) continue;
      this.tiles[t.row][t.col].color = 'red';
      this.tiles[t.row][t.col].cooldownRemaining = 0;
    }
  }

  // Painter skill: Color current and adjacent to dominant
  public paintAdjacentDominant(centerCol: number, centerRow: number) {
    const dom = this.getDominantColor();
    const targets = [
      { c: centerCol, r: centerRow },
      { c: centerCol + 1, r: centerRow },
      { c: centerCol - 1, r: centerRow },
      { c: centerCol, r: centerRow + 1 },
      { c: centerCol, r: centerRow - 1 },
    ];
    for (const t of targets) {
      if (t.c >= 0 && t.c < GRID_COLS && t.r >= 0 && t.r < GRID_ROWS) {
        this.tiles[t.r][t.c].color = dom;
        this.tiles[t.r][t.c].cooldownRemaining = 0;
      }
    }
  }

  // Transporter Swap
  public swapTiles(c1: number, r1: number, c2: number, r2: number) {
    if (
      c1 < 0 || c1 >= GRID_COLS || r1 < 0 || r1 >= GRID_ROWS ||
      c2 < 0 || c2 >= GRID_COLS || r2 < 0 || r2 >= GRID_ROWS
    ) return;
    const tempColor = this.tiles[r1][c1].color;
    const tempCD = this.tiles[r1][c1].cooldownRemaining;

    this.tiles[r1][c1].color = this.tiles[r2][c2].color;
    this.tiles[r1][c1].cooldownRemaining = this.tiles[r2][c2].cooldownRemaining;

    this.tiles[r2][c2].color = tempColor;
    this.tiles[r2][c2].cooldownRemaining = tempCD;
  }

  // Contaminate tiles around a hit cell (Yellow projectile effect).
  // Fully deterministic: both online clients derive the same tiles from the
  // hit position (each in its own mirrored board frame), so boards stay in
  // sync. The old random version desynced online boards. Colors cycle
  // red -> blue -> yellow -> red instead of rolling a random color.
  public contaminateAt(col: number, row: number) {
    const nextColor = (cur: TileColor | null): TileColor =>
      cur === 'red' ? 'blue' : cur === 'blue' ? 'yellow' : 'red';
    const targets = [
      { c: col, r: row },
      { c: col + 1 < GRID_COLS ? col + 1 : col - 1, r: row },
    ];
    for (const t of targets) {
      if (t.c < 0 || t.c >= GRID_COLS || t.r < 0 || t.r >= GRID_ROWS) continue;
      const tile = this.tiles[t.r][t.c];
      tile.color = nextColor(tile.color);
      tile.cooldownRemaining = 0;
    }
  }

  // --- Online reconciliation -------------------------------------------------
  // Refill timing differs slightly between clients (frame-rate dependent),
  // so the two copies of a board can drift even with a shared seed. The
  // engine periodically compares color hashes; on a persistent mismatch it
  // requests a snapshot and overwrites its copy of the remote board.
  // Hashes cover colors only: cooldown floats never match exactly across
  // clients, and a color mismatch is what actually changes gameplay.

  public snapshot(): BoardSnapshot {
    return {
      colors: this.tiles.map((row) => row.map((t) => t.color)),
      cooldowns: this.tiles.map((row) => row.map((t) => t.cooldownRemaining)),
    };
  }

  public applySnapshot(snap: BoardSnapshot, mirrored: boolean = false) {
    // Validate the whole snapshot first: a truncated or malformed one must
    // be rejected wholesale, never partially applied (that would corrupt
    // the board it was meant to repair).
    if (!snap || !Array.isArray(snap.colors) || !Array.isArray(snap.cooldowns)) return;
    if (snap.colors.length !== GRID_ROWS || snap.cooldowns.length !== GRID_ROWS) return;
    for (let r = 0; r < GRID_ROWS; r++) {
      if (!Array.isArray(snap.colors[r]) || snap.colors[r].length !== GRID_COLS) return;
      if (!Array.isArray(snap.cooldowns[r]) || snap.cooldowns[r].length !== GRID_COLS) return;
      for (let c = 0; c < GRID_COLS; c++) {
        const color = snap.colors[r][c];
        const cd = snap.cooldowns[r][c];
        if (color !== 'red' && color !== 'blue' && color !== 'yellow' && color !== null) return;
        if (typeof cd !== 'number' || Number.isNaN(cd)) return;
      }
    }
    for (let r = 0; r < GRID_ROWS; r++) {
      const srcRow = mirrored ? GRID_ROWS - 1 - r : r;
      for (let c = 0; c < GRID_COLS; c++) {
        this.tiles[r][c].color = snap.colors[srcRow][c];
        this.tiles[r][c].cooldownRemaining = Math.max(0, snap.cooldowns[srcRow][c]);
      }
    }
    this.updateClusters(false);
  }

  public colorHash(mirrored: boolean = false): string {
    let out = '';
    for (let r = 0; r < GRID_ROWS; r++) {
      const srcRow = mirrored ? GRID_ROWS - 1 - r : r;
      for (let c = 0; c < GRID_COLS; c++) {
        const col = this.tiles[srcRow][c].color;
        out += col === 'red' ? 'r' : col === 'blue' ? 'b' : col === 'yellow' ? 'y' : '.';
      }
    }
    return out;
  }
}

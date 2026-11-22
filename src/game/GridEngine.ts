import { GridTile, TileColor, Cluster, ShapePatternType } from '../types/game';

export const GRID_COLS = 9;
export const GRID_ROWS = 5;
export const BASE_REFILL_TIME = 1.3;
export const DISCARD_REFILL_TIME = 0.45;
// v3.0 side disruption lane: a projectile that passes the enemy board in
// a side column destroys the rearmost active tile there; the tile refills
// after this cooldown.
export const DISRUPT_REFILL_TIME = 1.5;

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
  // v2.2 rear-core collapse: when the owning side's core drops to 50% or
  // below, the outer columns (1 and 9) lock and the board plays 7 wide.
  public collapsed: boolean = false;
  // v2.2 shrink zone: tiles covered by the closing wall lock individually.
  private shrinkLocked: boolean[][] = [];
  // Deadlock-Free Engine (2026-11-22): replaces the v3.0 Pity Guard
  // (pityArmed / pityColorFor, removed) and the hotfix Anti-Clumping
  // re-roll. Refill colors now come from rollRefillColor's three-step
  // sweet-spot decision, and a fully stalled board is rescued by
  // resolveDeadlock() (called from GameEngine, not from here).

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
    this.collapsed = false;
    this.shrinkLocked = Array.from({ length: GRID_ROWS }, () =>
      Array(GRID_COLS).fill(false)
    );
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
          cooldownMax: 0,
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

  // Inclusive playable column range. Collapsed boards lose columns 1 and 9
  // (0 and 8 in 0-based indices) and play 7 wide.
  public colRange(): { min: number; max: number } {
    return this.collapsed ? { min: 1, max: GRID_COLS - 2 } : { min: 0, max: GRID_COLS - 1 };
  }

  public isTileLocked(col: number, row: number): boolean {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return true;
    const range = this.colRange();
    if (col < range.min || col > range.max) return true;
    return this.shrinkLocked[row]?.[col] === true;
  }

  // 1.5 공통 헬퍼 — 활성 타일 = 붕괴 열 밖 + 수축 잠금 아님. isTileLocked가
  // 경계 밖·붕괴 열·수축 잠금을 모두 포함하므로 활성은 그 부정이다.
  // 타일 변환·리필 스킬은 후보 선정을 이 헬퍼들로 통일한다.
  public isTileActive(col: number, row: number): boolean {
    return !this.isTileLocked(col, row);
  }

  // 보드 전체의 활성 타일 좌표 목록 (행 우선 순서).
  public activeTiles(): { col: number; row: number }[] {
    const out: { col: number; row: number }[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.isTileActive(c, r)) out.push({ col: c, row: r });
      }
    }
    return out;
  }

  // 좌표 목록에서 활성 타일만 남긴다 (경계 밖 좌표도 떨어진다).
  public filterActiveTiles<T extends { col: number; row: number }>(tiles: T[]): T[] {
    return tiles.filter((t) => this.isTileActive(t.col, t.row));
  }

  // v2.2 core collapse: lock the outer columns immediately. Tiles already
  // there keep their color but leave every cluster and cannot be used.
  // Hotfix (2026-11-21): data-level exclusion — the collapsed columns'
  // tiles are emptied outright (color null, cooldown 0) so no code path
  // can ever count, launch, or refill them. Locked-column checks in
  // updateClusters/launch/update remain as a second line of defense.
  public collapseSides() {
    this.collapsed = true;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (const c of [0, GRID_COLS - 1]) {
        const tile = this.tiles[r][c];
        tile.color = null;
        tile.cooldownRemaining = 0;
        tile.cooldownMax = 0;
      }
    }
    this.updateClusters(false);
  }

  // v2.2 shrink zone: lock/unlock one tile as the wall passes over it.
  public setShrinkLocked(col: number, row: number, locked: boolean) {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return;
    this.shrinkLocked[row][col] = locked;
  }

  // Deadlock-Free Engine (2026-11-22): refill color decision, three
  // sequential steps. All randomness comes from the caller's roll() —
  // the seeded RNG inside update() so both online clients draw the same
  // sequence (refillRow() passes Math.random and sends the picks
  // verbatim instead; see its comment). Step 1: weighted draw with a
  // 3-color minimum-ratio guard (a color under 20% of the colored
  // active tiles rolls at 2.0x weight). Step 2: combo induction — when
  // the board is starved (<= 2 launchable clusters) and this tile
  // touches a 2-tile block, take that block's color 70% of the time to
  // complete a 3+ cluster at once. Step 3: bomb suppression — if
  // placing the chosen color here would join a 7+ cluster, re-roll once
  // and accept whatever comes (no infinite re-rolls). Suppression is
  // lifted in the shrink endgame (<= 12 active tiles), where big blocks
  // are the only way to keep firing.
  private rollRefillColor(col: number, row: number, roll: () => number): TileColor {
    let color = this.weightedColorRoll(roll);
    const induc = this.inductionColorFor(col, row);
    if (induc && roll() < 0.7) color = induc;
    if (this.activeTileCount() > 12 && this.joinedClusterSize(col, row, color) >= 7) {
      color = this.weightedColorRoll(roll);
    }
    return color;
  }

  // Step 1: weighted color roll. Colors under 20% of the colored active
  // tiles get weight 2.0 (base 1.0 each). With no colored active tiles
  // the weights are uniform.
  private weightedColorRoll(roll: () => number): TileColor {
    const counts: Record<TileColor, number> = { red: 0, blue: 0, yellow: 0 };
    let total = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (!this.isTileActive(c, r)) continue;
        const colr = this.tiles[r][c].color;
        if (!colr) continue;
        counts[colr]++;
        total++;
      }
    }
    const weights = TILE_COLORS.map((colr) =>
      total > 0 && counts[colr] / total < 0.2 ? 2.0 : 1.0
    );
    const sum = weights[0] + weights[1] + weights[2];
    let x = roll() * sum;
    for (let i = 0; i < TILE_COLORS.length; i++) {
      x -= weights[i];
      if (x <= 0) return TILE_COLORS[i];
    }
    return TILE_COLORS[TILE_COLORS.length - 1];
  }

  // Step 2: the color of an adjacent 2-tile cluster, when the board is
  // starved (<= 2 launchable clusters). Scan order up, right, down,
  // left — the first adjacent 2-cluster wins (all of them are one step
  // away, so there is no nearer one to prefer). Reads the last computed
  // clusters; the refilling tile is empty, so it belongs to none.
  private inductionColorFor(col: number, row: number): TileColor | null {
    if (this.clusters.filter((c) => c.isActivePad).length > 2) return null;
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
    for (const [dc, dr] of dirs) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS) continue;
      const neighbor = this.tiles[nr][nc];
      if (!neighbor.color) continue;
      const cl = this.clusters.find((c) =>
        c.tiles.some((t) => t.col === nc && t.row === nr)
      );
      if (cl && cl.tiles.length === 2) return cl.color;
    }
    return null;
  }

  // Step 3: size of the cluster that would form if (col, row) became
  // `color` — 1 (this tile) plus the connected same-color active tiles
  // around it. The candidate cell itself is empty; every other cell in
  // the component must already carry the color.
  private joinedClusterSize(col: number, row: number, color: TileColor): number {
    const seen = new Set<string>([`${col},${row}`]);
    const queue: { col: number; row: number }[] = [{ col, row }];
    let size = 0;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      size++;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = cur.col + dc;
        const nr = cur.row + dr;
        const key = `${nc},${nr}`;
        if (seen.has(key)) continue;
        if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS) continue;
        if (!this.isTileActive(nc, nr)) continue;
        if (this.tiles[nr][nc].color !== color) continue;
        seen.add(key);
        queue.push({ col: nc, row: nr });
      }
    }
    return size;
  }

  // Playable tiles (not collapsed, not shrink-locked) — same definition
  // updateClusters() uses for the min-launch-size relaxation.
  public activeTileCount(): number {
    let n = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (!this.isTileLocked(c, r)) n++;
      }
    }
    return n;
  }

  // Launchable clusters (isActivePad) — optionally filtered by color.
  // The min-launch-size rule (sniper 1, <= 9 active tiles 2, else 3) is
  // already encoded in isActivePad by updateClusters().
  public launchableClusterCount(color?: TileColor): number {
    return this.clusters.filter(
      (c) => c.isActivePad && (color === undefined || c.color === color)
    ).length;
  }

  // Empty active tiles still waiting on a refill cooldown. A board with
  // none of these and no launchable cluster is fully stalled (RESYNC).
  // Locked tiles never refill, so they are excluded.
  public pendingRefillCount(): number {
    let n = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (!this.isTileActive(c, r)) continue;
        const t = this.tiles[r][c];
        if (!t.color && t.cooldownRemaining > 0) n++;
      }
    }
    return n;
  }

  // GRID RESYNC (Deadlock-Free Engine): force-convert tiles so a
  // launchable cluster appears. Finds up to 2 two-tile blocks nearest
  // (nearCol, nearRow) and converts one adjacent active tile per block
  // to the block's color (making 3+); with no 2-tile block, paints the
  // 3 active tiles nearest the character one color. Returns the tiles
  // actually changed (for sparks / popup). Converted tiles stay active
  // immediately (no refill cooldown). Clusters are recomputed on the
  // next board.update() — this method only mutates colors.
  public resolveDeadlock(
    nearCol: number,
    nearRow: number
  ): { col: number; row: number; color: TileColor }[] {
    const changed: { col: number; row: number; color: TileColor }[] = [];
    const converted = new Set<string>();
    const manhattan = (c: number, r: number) =>
      Math.abs(c - nearCol) + Math.abs(r - nearRow);
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

    // Two-tile blocks, nearest first (distance = closest tile of the
    // pair). Ties break by row-major order of the pair's first tile so
    // the choice is deterministic.
    const pairs = this.clusters
      .filter((c) => c.tiles.length === 2)
      .map((c) => ({
        cluster: c,
        dist: Math.min(...c.tiles.map((t) => manhattan(t.col, t.row))),
      }))
      .sort(
        (a, b) =>
          a.dist - b.dist ||
          a.cluster.tiles[0].row - b.cluster.tiles[0].row ||
          a.cluster.tiles[0].col - b.cluster.tiles[0].col
      )
      .slice(0, 2);

    for (const { cluster } of pairs) {
      // First adjacent active tile of a different color (pair tiles in
      // order, neighbours up/right/down/left). Already-converted tiles
      // are skipped so the second pair cannot steal the first pair's
      // third tile back.
      let target: { col: number; row: number } | null = null;
      outer: for (const t of cluster.tiles) {
        for (const [dc, dr] of dirs) {
          const nc = t.col + dc;
          const nr = t.row + dr;
          if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS) continue;
          if (!this.isTileActive(nc, nr)) continue;
          if (converted.has(`${nc},${nr}`)) continue;
          const tile = this.tiles[nr][nc];
          if (!tile.color || tile.color === cluster.color) continue;
          target = { col: nc, row: nr };
          break outer;
        }
      }
      if (!target) continue;
      this.tiles[target.row][target.col].color = cluster.color;
      this.tiles[target.row][target.col].cooldownRemaining = 0;
      converted.add(`${target.col},${target.row}`);
      changed.push({ col: target.col, row: target.row, color: cluster.color });
    }
    if (changed.length > 0) return changed;

    // No 2-tile block (or no convertible neighbour): paint the 3 active
    // tiles nearest the character one color — the foot tile's color if
    // it has one, else the most common color among the three (ties:
    // red > blue > yellow).
    const actives = this.activeTiles()
      .filter((t) => this.tiles[t.row][t.col].color)
      .map((t) => ({ ...t, dist: manhattan(t.col, t.row) }))
      .sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)
      .slice(0, 3);
    if (actives.length === 0) return changed;
    const foot = this.tiles[nearRow]?.[nearCol];
    let color: TileColor | null =
      foot && this.isTileActive(nearCol, nearRow) ? foot.color : null;
    if (!color) {
      const counts: Record<TileColor, number> = { red: 0, blue: 0, yellow: 0 };
      for (const t of actives) counts[this.tiles[t.row][t.col].color!]++;
      color =
        counts.red >= counts.blue && counts.red >= counts.yellow
          ? 'red'
          : counts.blue >= counts.yellow
            ? 'blue'
            : 'yellow';
    }
    for (const t of actives) {
      const tile = this.tiles[t.row][t.col];
      if (tile.color === color) continue;
      tile.color = color;
      tile.cooldownRemaining = 0;
      changed.push({ col: t.col, row: t.row, color });
    }
    return changed;
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

        // Locked tiles freeze: their cooldown neither ticks nor refills.
        if (this.isTileLocked(c, r)) continue;
        if (tile.cooldownRemaining > 0) {
          tile.cooldownRemaining -= dt * cooldownSpeedMult;
          if (tile.cooldownRemaining <= 0) {
            tile.cooldownRemaining = 0;
            tile.color = this.rollRefillColor(c, r, () => this.nextRandom());
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

    // v2.2 late-game anti-stall: when collapse + shrink leave 9 or fewer
    // usable (unlocked) tiles, a 3-tile cluster is nearly impossible —
    // relax the minimum launch size to 2 (sniper stays at 1).
    const activeTiles = this.activeTileCount();
    const minLaunchSize = isSniper ? 1 : activeTiles <= 9 ? 2 : 3;

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        // Locked tiles (collapsed columns, shrink wall) are excluded from
        // every cluster and marked visited so they never seed one.
        if (this.isTileLocked(c, r)) {
          visited[r][c] = true;
          continue;
        }
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
              // Hotfix: a locked tile (collapsed column / shrink wall)
              // must never join a cluster, even when the BFS reaches it
              // before the outer scan marks it visited (e.g. expanding
              // down from the row above a collapsed column).
              if (!visited[nr][nc] && !this.isTileLocked(nc, nr)) {
                const neighbor = this.tiles[nr][nc];
                if (neighbor.color === color) {
                  visited[nr][nc] = true;
                  queue.push({ col: nc, row: nr });
                }
              }
            }
          }
        }

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

  // v3.0 side disruption lane: destroy the rearmost ACTIVE tile in a side
  // column (farthest from the attacker — top row for the enemy board,
  // bottom row for the player board) and put it on a 1.5s refill
  // cooldown. Returns false when the column has no active tile to destroy
  // (the passing cell then simply flies on).
  public destroyBackTile(col: number, backSide: 'top' | 'bottom'): boolean {
    if (col < 0 || col >= GRID_COLS) return false;
    const rows = backSide === 'top' ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
    for (const r of rows) {
      const tile = this.tiles[r][col];
      if (tile.color && this.isTileActive(col, r)) {
        tile.color = null;
        tile.cooldownRemaining = DISRUPT_REFILL_TIME;
        tile.cooldownMax = DISRUPT_REFILL_TIME;
        return true;
      }
    }
    return false;
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
      if (this.isTileLocked(t.col, t.row)) continue;
      const tile = this.tiles[t.row][t.col];
      tile.color = null;
      tile.cooldownRemaining = customCooldown;
      tile.cooldownMax = customCooldown;
    }
  }

  // Fast discard single tile or small unprimed group (0.45s reload, v2.2)
  public discardTile(col: number, row: number, customCooldown: number = DISCARD_REFILL_TIME): boolean {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return false;
    const tile = this.tiles[row][col];
    if (!tile.color) return false; // Already in cooldown
    if (this.isTileLocked(col, row)) return false;

    tile.color = null;
    tile.cooldownRemaining = customCooldown;
    tile.cooldownMax = customCooldown;
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
      if (this.tiles[row][c].cooldownRemaining > 0 && this.isTileActive(c, row)) {
        const color = this.rollRefillColor(c, row, () => Math.random());
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
      if (!this.isTileActive(p.col, row)) continue;
      this.tiles[row][p.col].cooldownRemaining = 0;
      this.tiles[row][p.col].color = p.color;
    }
  }

  // v3.0 Wave skill (Tide Surge): refill up to maxCount cooldown (empty)
  // tiles in the row with BLUE, left to right. Returns the refilled tiles
  // in the same shape as refillRow() — the sender carries them in the
  // skill packet (SkillEffect 'wave') and the remote side applies them
  // verbatim with refillRowWith().
  public refillRowBlue(row: number, maxCount: number = 3): { col: number; row: number; color: TileColor }[] {
    if (row < 0 || row >= GRID_ROWS) return [];
    const picks: { col: number; row: number; color: TileColor }[] = [];
    for (let c = 0; c < GRID_COLS && picks.length < maxCount; c++) {
      if (this.tiles[row][c].cooldownRemaining > 0 && this.isTileActive(c, row)) {
        this.tiles[row][c].cooldownRemaining = 0;
        this.tiles[row][c].color = 'blue';
        picks.push({ col: c, row, color: 'blue' });
      }
    }
    return picks;
  }

  // Convert column tiles (Lancer skill)
  public convertColumnToRed(col: number, count: number = 2) {
    if (col < 0 || col >= GRID_COLS) return;
    let converted = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      if (converted >= count) break;
      if (!this.isTileActive(col, r)) continue;
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
    // 후보는 활성 타일 중 적색이 아닌 타일만 (행 우선 순서 유지).
    const candidates = this.activeTiles().filter(
      (t) => this.tiles[t.row][t.col].color !== 'red'
    );
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
    // filterActiveTiles가 경계 밖·붕괴·잠금 좌표를 모두 거른다.
    for (const t of this.filterActiveTiles(tiles)) {
      this.tiles[t.row][t.col].color = 'red';
      this.tiles[t.row][t.col].cooldownRemaining = 0;
    }
  }

  // Painter skill: Color current and adjacent to dominant
  public paintAdjacentDominant(centerCol: number, centerRow: number) {
    const dom = this.getDominantColor();
    const targets = [
      { col: centerCol, row: centerRow },
      { col: centerCol + 1, row: centerRow },
      { col: centerCol - 1, row: centerRow },
      { col: centerCol, row: centerRow + 1 },
      { col: centerCol, row: centerRow - 1 },
    ];
    for (const t of this.filterActiveTiles(targets)) {
      this.tiles[t.row][t.col].color = dom;
      this.tiles[t.row][t.col].cooldownRemaining = 0;
    }
  }

  // v3.0 Painter skill (Chroma Infusion): paint up to maxCount adjacent
  // ACTIVE tiles with the FOOT tile's color (order: up, down, left,
  // right). The foot tile itself is the source, not a target. When the
  // foot tile is empty (cooldown), fall back to the board's dominant color
  // so the skill still does something.
  public paintAdjacentFromFoot(centerCol: number, centerRow: number, maxCount: number = 3) {
    const foot = this.tiles[centerRow]?.[centerCol];
    const color = foot?.color ?? this.getDominantColor();
    const targets = [
      { col: centerCol, row: centerRow - 1 },
      { col: centerCol, row: centerRow + 1 },
      { col: centerCol - 1, row: centerRow },
      { col: centerCol + 1, row: centerRow },
    ];
    let painted = 0;
    for (const t of this.filterActiveTiles(targets)) {
      if (painted >= maxCount) break;
      this.tiles[t.row][t.col].color = color;
      this.tiles[t.row][t.col].cooldownRemaining = 0;
      painted++;
    }
  }

  // Transporter Swap
  public swapTiles(c1: number, r1: number, c2: number, r2: number) {
    if (
      c1 < 0 || c1 >= GRID_COLS || r1 < 0 || r1 >= GRID_ROWS ||
      c2 < 0 || c2 >= GRID_COLS || r2 < 0 || r2 >= GRID_ROWS
    ) return;
    if (!this.isTileActive(c1, r1) || !this.isTileActive(c2, r2)) return;
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
      if (!this.isTileActive(t.c, t.r)) continue;
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

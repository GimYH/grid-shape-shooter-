import React, { useState } from 'react';
import { X, Copy, Check, Download, FileCode, FolderTree } from 'lucide-react';

interface GodotExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GODOT_FILES: Record<string, { filename: string; path: string; content: string }> = {
  project_godot: {
    filename: 'project.godot',
    path: 'project.godot',
    content: `; Engine configuration file.
; It's best edited using the editor UI and not directly,
; since the parameters that go here are not all obvious.
;
; Format:
;   [section] ; section goes between []
;   param=value ; assign values to parameters

config_version=5

[application]

config/name="Grid Shape Shooter"
run/main_scene="res://scenes/battle_arena.tscn"
config/features=PackedStringArray("4.3", "Forward Plus")
config/icon="res://icon.svg"

[display]

window/size/viewport_width=1920
window/size/viewport_height=1080
window/size/mode=0
window/size/resizable=true
window/stretch/mode="canvas_items"
window/stretch/aspect="expand"

[rendering]

renderer/rendering_method="forward_plus"
environment/defaults/default_clear_color=Color(0.04, 0.05, 0.08, 1)

[input]

move_left={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":4194319,"physical_keycode":0,"key_label":0,"unicode":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":65,"physical_keycode":0,"key_label":0,"unicode":97,"echo":false,"script":null)
]
}
move_right={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":4194321,"physical_keycode":0,"key_label":0,"unicode":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":68,"physical_keycode":0,"key_label":0,"unicode":100,"echo":false,"script":null)
]
}
move_up={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":4194320,"physical_keycode":0,"key_label":0,"unicode":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":87,"physical_keycode":0,"key_label":0,"unicode":119,"echo":false,"script":null)
]
}
move_down={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":4194322,"physical_keycode":0,"key_label":0,"unicode":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":83,"physical_keycode":0,"key_label":0,"unicode":115,"echo":false,"script":null)
]
}
action_fire={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":32,"physical_keycode":0,"key_label":0,"unicode":32,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":74,"physical_keycode":0,"key_label":0,"unicode":106,"echo":false,"script":null)
]
}
action_skill={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":75,"physical_keycode":0,"key_label":0,"unicode":107,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":4194325,"physical_keycode":0,"key_label":0,"unicode":0,"echo":false,"script":null)
]
}
`,
  },

  game_types: {
    filename: 'game_types.gd',
    path: 'scripts/core/game_types.gd',
    content: `class_name GameTypes
extends RefCounted

## Enumerations for Grid Shape Shooter Commercial Architecture

enum TileColor {
	NONE = 0,   # Cooldown / Empty Slot
	RED = 1,    # Fast Projectile, Enemy Cooldown Disruption
	BLUE = 2,   # High Durability Barrier, Absorptive
	YELLOW = 3  # Slowing Debuff, Grid Contamination
}

enum ShapePattern {
	NORMAL = 0,
	SPEAR_V = 1,       # Vertical 1x3, 1x4 (1.8x Speed & Piercing Trail)
	WAVE_H = 2,        # Horizontal 3x1, 4x1 (Shockwave & Knockback)
	HOMING_SQUARE = 3, # 2x2 Square (Tracks Enemy X-Axis)
	METEOR_CROSS = 4   # T/Cross >= 5 (3x3 AOE Explosion on arrival)
}

enum Archetype {
	LANCER = 0,
	WAVE = 1,
	SNIPER = 2,
	PAINTER = 3,
	TRANSPORTER = 4,
	SPEEDSTER = 5,
	MONOCHROME = 6
}

static func get_color_code(color: TileColor) -> Color:
	match color:
		TileColor.RED: return Color("#FF3366")
		TileColor.BLUE: return Color("#33CCFF")
		TileColor.YELLOW: return Color("#FFCC00")
		_: return Color("#222838")
`,
  },

  grid_board: {
    filename: 'grid_board.gd',
    path: 'scripts/core/grid_board.gd',
    content: `class_name GridBoard
extends Node2D

const COLS: int = 8
const ROWS: int = 4
const TILE_SIZE: Vector2 = Vector2(110.0, 64.0)
const TILE_GAP: float = 6.0
const BASE_REFILL_TIME: float = 2.0

class TileCell:
	var col: int
	var row: int
	var color: GameTypes.TileColor = GameTypes.TileColor.NONE
	var cooldown: float = 0.0
	var cluster_id: int = -1

var tiles: Array = [] # 2D array [row][col]
var clusters: Dictionary = {} # cluster_id -> Array[Vector2i]
var is_enemy: bool = false
var min_cluster_size: int = 3

func _init(p_is_enemy: bool = false) -> void:
	is_enemy = p_is_enemy
	_init_grid()

func _init_grid() -> void:
	tiles.clear()
	for r in range(ROWS):
		var row_arr: Array = []
		for c in range(COLS):
			var cell = TileCell.new()
			cell.col = c
			cell.row = r
			cell.color = [GameTypes.TileColor.RED, GameTypes.TileColor.BLUE, GameTypes.TileColor.YELLOW].pick_random()
			row_arr.append(cell)
		tiles.append(row_arr)
	rebuild_clusters()

func update_board(delta: float, cd_mult: float = 1.0) -> void:
	var needs_rebuild := false
	for r in range(ROWS):
		for c in range(COLS):
			var cell: TileCell = tiles[r][c]
			if cell.cooldown > 0.0:
				cell.cooldown -= delta * cd_mult
				if cell.cooldown <= 0.0:
					cell.cooldown = 0.0
					cell.color = [GameTypes.TileColor.RED, GameTypes.TileColor.BLUE, GameTypes.TileColor.YELLOW].pick_random()
					needs_rebuild = true
	if needs_rebuild:
		rebuild_clusters()
	queue_redraw()

func rebuild_clusters() -> void:
	clusters.clear()
	var visited: Array = []
	for r in range(ROWS):
		var v_row: Array = []
		v_row.resize(COLS)
		v_row.fill(false)
		visited.append(v_row)

	var next_id := 1
	var dirs := [Vector2i(1,0), Vector2i(-1,0), Vector2i(0,1), Vector2i(0,-1)]

	for r in range(ROWS):
		for c in range(COLS):
			if visited[r][c]: continue
			var start_cell: TileCell = tiles[r][c]
			if start_cell.color == GameTypes.TileColor.NONE: continue

			var target_color = start_cell.color
			var group: Array[Vector2i] = []
			var queue: Array[Vector2i] = [Vector2i(c, r)]
			visited[r][c] = true

			while not queue.is_empty():
				var curr: Vector2i = queue.pop_front()
				group.append(curr)
				for d in dirs:
					var nc = curr.x + d.x
					var nr = curr.y + d.y
					if nc >= 0 and nc < COLS and nr >= 0 and nr < ROWS:
						if not visited[nr][nc]:
							var n_cell: TileCell = tiles[nr][nc]
							if n_cell.color == target_color:
								visited[nr][nc] = true
								queue.append(Vector2i(nc, nr))

			if group.size() >= min_cluster_size:
				clusters[next_id] = group
				for pt in group:
					tiles[pt.y][pt.x].cluster_id = next_id
				next_id += 1
			else:
				for pt in group:
					tiles[pt.y][pt.x].cluster_id = -1

func consume_cluster_at(col: int, row: number) -> Dictionary:
	if col < 0 or col >= COLS or row < 0 or row >= ROWS: return {}
	var cell: TileCell = tiles[row][col]
	if cell.cluster_id == -1 or not clusters.has(cell.cluster_id): return {}

	var group: Array[Vector2i] = clusters[cell.cluster_id]
	var color = cell.color

	# Set all to cooldown
	for pt in group:
		tiles[pt.y][pt.x].color = GameTypes.TileColor.NONE
		tiles[pt.y][pt.x].cooldown = BASE_REFILL_TIME
		tiles[pt.y][pt.x].cluster_id = -1

	rebuild_clusters()
	return { "tiles": group, "color": color }

func _draw() -> void:
	for r in range(ROWS):
		for c in range(COLS):
			var cell: TileCell = tiles[r][c]
			var pos = Vector2(c * (TILE_SIZE.x + TILE_GAP), r * (TILE_SIZE.y + TILE_GAP))
			var rect = Rect2(pos, TILE_SIZE)

			if cell.color == GameTypes.TileColor.NONE:
				draw_rect(rect, Color(0.1, 0.12, 0.18, 0.8), true)
				draw_rect(rect, Color(0.2, 0.25, 0.35, 0.4), false, 1.5)
			else:
				var col = GameTypes.get_color_code(cell.color)
				var is_primed = cell.cluster_id != -1
				var fill = col
				fill.a = 0.35 if is_primed else 0.18
				draw_rect(rect, fill, true)
				draw_rect(rect, col, false, 2.5 if is_primed else 1.0)
`,
  },

  shape_projectile: {
    filename: 'shape_projectile.gd',
    path: 'scripts/core/shape_projectile.gd',
    content: `class_name ShapeProjectile
extends Node2D

class CellNode:
	var rel_col: int
	var rel_row: int
	var hp: int
	var destroyed: bool = false
	var area: Area2D

var owner_is_player: bool = true
var color: GameTypes.TileColor
var shape_pattern: GameTypes.ShapePattern = GameTypes.ShapePattern.NORMAL
var cells: Array[CellNode] = []
var velocity: Vector2 = Vector2.ZERO
var cell_size: Vector2 = Vector2(110.0, 64.0)
var gap: float = 6.0
var damage_per_cell: int = 4

func setup(p_is_player: bool, p_color: GameTypes.TileColor, tile_coords: Array[Vector2i]) -> void:
	owner_is_player = p_is_player
	color = p_color

	var min_c = 99
	var min_r = 99
	for pt in tile_coords:
		min_c = mini(min_c, pt.x)
		min_r = mini(min_r, pt.y)

	var base_hp = 1
	if tile_coords.size() >= 9: base_hp = 3
	elif tile_coords.size() >= 6: base_hp = 2
	if color == GameTypes.TileColor.BLUE: base_hp *= 2

	for pt in tile_coords:
		var cn = CellNode.new()
		cn.rel_col = pt.x - min_c
		cn.rel_row = pt.y - min_r
		cn.hp = base_hp
		cells.append(cn)

	var speed = 440.0
	velocity = Vector2(0, -speed if owner_is_player else speed)

func _physics_process(delta: float) -> void:
	position += velocity * delta
	queue_redraw()

	var all_dead = true
	for c in cells:
		if not c.destroyed: all_dead = false
	if all_dead or position.y < -400 or position.y > 1500:
		queue_free()

func _draw() -> void:
	var col = GameTypes.get_color_code(color)
	for c in cells:
		if c.destroyed: continue
		var pos = Vector2(c.rel_col * (cell_size.x + gap), c.rel_row * (cell_size.y + gap))
		draw_rect(Rect2(pos, cell_size), col, true)
		draw_rect(Rect2(pos, cell_size), Color.WHITE, false, 2.0)
`,
  },

  fighter_actor: {
    filename: 'fighter_actor.gd',
    path: 'scripts/actors/fighter_actor.gd',
    content: `class_name FighterActor
extends CharacterBody2D

signal fired_shape(cluster_data: Dictionary)
signal skill_used(archetype_id: int)

@export var is_player: bool = true
var hp: float = 100.0
var max_hp: float = 100.0
var current_archetype: GameTypes.Archetype = GameTypes.Archetype.LANCER
var skill_cooldown_timer: float = 0.0

var current_col: int = 3
var current_row: int = 2
var board: GridBoard

func _physics_process(delta: float) -> void:
	if skill_cooldown_timer > 0.0:
		skill_cooldown_timer -= delta

	if is_player:
		var dir = Input.get_vector("move_left", "move_right", "move_up", "move_down")
		velocity = dir * 340.0
		move_and_slide()

		if Input.is_action_just_pressed("action_fire"):
			fire_under_feet()
		if Input.is_action_just_pressed("action_skill"):
			trigger_skill()

func fire_under_feet() -> void:
	if not board: return
	var cluster_data = board.consume_cluster_at(current_col, current_row)
	if not cluster_data.is_empty():
		fired_shape.emit(cluster_data)

func trigger_skill() -> void:
	if skill_cooldown_timer > 0.0: return
	skill_cooldown_timer = 5.0
	skill_used.emit(current_archetype)
`,
  },

  enemy_ai: {
    filename: 'enemy_ai.gd',
    path: 'scripts/actors/enemy_ai.gd',
    content: `class_name EnemyAI
extends FighterActor

var decision_timer: float = 0.0
var target_pos: Vector2

func _init() -> void:
	is_player = false

func _physics_process(delta: float) -> void:
	super._physics_process(delta)

	decision_timer -= delta
	if decision_timer <= 0.0:
		decision_timer = randf_range(0.4, 0.8)
		# AI Cluster scan & auto-fire
		if board and not board.clusters.is_empty():
			var keys = board.clusters.keys()
			var chosen_id = keys.pick_random()
			var tile_coords = board.clusters[chosen_id]
			if not tile_coords.is_empty():
				var target_cell = tile_coords.pick_random()
				current_col = target_cell.x
				current_row = target_cell.y
				fire_under_feet()
`,
  },

  battle_manager: {
    filename: 'battle_manager.gd',
    path: 'scripts/battle_manager.gd',
    content: `class_name BattleManager
extends Node2D

var player_board: GridBoard
var enemy_board: GridBoard
var player: FighterActor
var enemy: EnemyAI
var projectiles: Array[ShapeProjectile] = []

func _ready() -> void:
	# 1. Spawn Grid Boards
	player_board = GridBoard.new(false)
	player_board.position = Vector2(490, 680)
	add_child(player_board)

	enemy_board = GridBoard.new(true)
	enemy_board.position = Vector2(490, 80)
	add_child(enemy_board)

	# 2. Spawn Actors
	player = FighterActor.new()
	player.board = player_board
	player.position = Vector2(960, 800)
	player.fired_shape.connect(_on_player_fire)
	add_child(player)

	enemy = EnemyAI.new()
	enemy.board = enemy_board
	enemy.position = Vector2(960, 200)
	enemy.fired_shape.connect(_on_enemy_fire)
	add_child(enemy)

func _on_player_fire(data: Dictionary) -> void:
	var proj = ShapeProjectile.new()
	proj.setup(true, data.color, data.tiles)
	proj.position = player.position
	add_child(proj)
	projectiles.append(proj)

func _on_enemy_fire(data: Dictionary) -> void:
	var proj = ShapeProjectile.new()
	proj.setup(false, data.color, data.tiles)
	proj.position = enemy.position
	add_child(proj)
	projectiles.append(proj)
`,
  },
};

export const GodotExportModal: React.FC<GodotExportModalProps> = ({ isOpen, onClose }) => {
  const [selectedKey, setSelectedKey] = useState<string>('project_godot');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const currentFile = GODOT_FILES[selectedKey];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([currentFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = currentFile.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 font-['Chakra_Petch']">
      <div className="bg-slate-950 border border-cyan-500/50 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl shadow-cyan-950/80 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/40">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">
                Godot 4.x / Steam & Android Commercial Architecture
              </h2>
              <p className="text-xs text-slate-400">
                Code-First Procedural Scene & Multi-Cell Collision Physics Scripts
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* File Sidebar */}
          <div className="w-64 border-r border-slate-800 bg-slate-950/70 p-3 space-y-1 overflow-y-auto">
            <div className="text-[11px] font-bold text-slate-400 px-3 py-1.5 uppercase tracking-wider">
              Export Scripts
            </div>
            {Object.entries(GODOT_FILES).map(([key, item]) => {
              const active = selectedKey === key;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs transition-all font-mono ${
                    active
                      ? 'bg-cyan-600/25 text-cyan-300 border border-cyan-500/40 font-semibold'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
                >
                  <FileCode className={`w-4 h-4 ${active ? 'text-cyan-400' : 'text-slate-500'}`} />
                  <span className="truncate">{item.filename}</span>
                </button>
              );
            })}
          </div>

          {/* Code Viewer */}
          <div className="flex-1 flex flex-col bg-slate-900/30 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-950/50">
              <span className="text-xs font-mono text-cyan-400 font-bold">{currentFile.path}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 rounded-lg border border-slate-700 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy Code'}</span>
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 text-xs bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 border border-cyan-500/40 px-3 py-1 rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download File</span>
                </button>
              </div>
            </div>

            <pre className="flex-1 p-4 font-mono text-xs text-slate-300 overflow-auto bg-slate-950/90 leading-relaxed selection:bg-cyan-500/30">
              <code>{currentFile.content}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

# Combo Multiplier HUD & Dynamic Combat Intensification

A real-time combat streak system that tracks consecutive direct hits on the opponent, boosting outgoing projectile damage and score, with a 3.5-second decaying timer and high-impact visual escalation tiers.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following parameters were confirmed during interactive clarification and are locked into the system design:
> - **Gameplay Benefit**: Direct hits scale outgoing projectile damage and award bonus combo score.
> - **Combo Decay Mechanism**: An active 3.5-second countdown timer resets upon each landed hit. If 3.5 seconds elapse without landing a hit, the combo drops back to zero.

- **Confirmed Decision 1**: Damage boost scales from 1.0x up to 3.0x max across a 10-hit streak ladder.
- **Confirmed Decision 2**: Timed decay bar gives players clear visual urgency to chain their attacks.

---

## 1. Overview & Core Concept

- **What It Does**: Whenever a player's launched tile projectile or skill directly strikes the opponent (enemy AI in single-player or remote opponent in 1v1 online), the combo streak increments. This multiplies future hit damage, triggers floating combat callouts, and activates progressive visual aura tiers (Cyan -> Amber -> Prismatic Neon Flame).
- **Target Audience**: Competitive arcade action players looking for deep timing rhythms, combo chaining rewards, and high-adrenaline visual feedback.
- **Key Value**: Replaces passive spamming with intentional, aggressive offensive tempo—rewarding players who sustain continuous pressure while dodging incoming threats.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Initial Hit (Combo Start)**: On first direct contact, a sleek HUD widget springs into view near the frontline clash zone displaying `COMBO x1.0` with a 3.5s decay bar.
2. **Chain Streak (Escalation)**: Each subsequent direct hit bounces the counter with an elastic scale pop, refreshes the 3.5s gauge, and upgrades the visual tier:
   - **Tier 1 (2–3 Hits - "STRIKE")**: Crisp electric cyan aura, 1.2x–1.5x damage, subtle particle hum.
   - **Tier 2 (4–6 Hits - "HYPER")**: Vibrant gold/amber radiance, 1.8x–2.0x damage, animated streak sparks, pitched-up audio chiming.
   - **Tier 3 (7+ Hits - "OVERDRIVE")**: Fiery crimson-magenta prismatic pulse, 2.2x–3.0x damage, subtle camera micro-shake on impact, blazing neon border glow.
3. **Decay / Reset**: If the gauge runs out of time without another hit, the meter quickly burns out with a gentle smoke particle puff and resets to 0.

### Visual Styling & HUD Geometry
- **Location**: Positioned floating right above the player's command deck / bottom grid frontline, perfectly centered so it does not obstruct tile readability.
- **Decay Meter**: A glowing horizontal neon progress bar that smoothly drains from 100% to 0% over 3.5 seconds.
- **Typography**: Heavy, condensed futuristic monospace numerals (`Chakra Petch` font) with tabular alignment to prevent layout jitter during fast counting.
- **Zero-Pill Compliance**: Uses raw glowing typography, hairline neon frames, and floating combat text rather than static generic badges.

---

## 3. Key Product Decisions & Trade-Offs

- **Damage Scaling Curve**:
  - *Chosen Approach*: Stepped smooth multiplier formula:
    - 1 Hit: 1.0x
    - 2 Hits: 1.2x
    - 3 Hits: 1.4x
    - 4 Hits: 1.6x
    - 5 Hits: 1.8x
    - 6 Hits: 2.0x
    - 7+ Hits: 2.2x to 3.0x (caps at 3.0x at 11 hits).
  - *Why*: Provides noticeable, punchy reward without making early-game battles end in 2 hits.
- **Hit Detection Precision**:
  - *Chosen Approach*: Only count direct physical collisions with the character actor (or AI boss). Projectile-to-projectile central neutral clashes do not increment the combo, reinforcing that true skill lies in penetrating the opponent's defenses.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────┐
│                   GameEngine 60fps Loop                │
│                                                        │
│  ┌───────────────────────┐   Direct Hit   ┌──────────┐ │
│  │ Collision Resolution  ├───────────────►│ Combo    │ │
│  │ (Projectile vs Actor) │                │ System   │ │
│  └───────────────────────┘                └────┬─────┘ │
│                                                │       │
│                                           Ticking dt   │
│                                                │       │
│  ┌─────────────────────────────────────────────▼─────┐ │
│  │ ComboState:                                       │ │
│  │ - count: number (e.g. 5)                          │ │
│  │ - multiplier: number (e.g. 1.8x)                  │ │
│  │ - timerRemaining: 3.5s                            │ │
│  │ - tier: 'strike' | 'hyper' | 'overdrive'          │ │
│  └─────────────────────────────┬─────────────────────┘ │
│                                │                       │
│              ┌─────────────────┴────────────────┐      │
│              ▼                                  ▼      │
│     ┌───────────────────┐             ┌──────────────┐ │
│     │ HUD Canvas / DOM  │             │ Audio / FX   │ │
│     │ Dynamic Overlay   │             │ Pitch Shift  │ │
│     └───────────────────┘             └──────────────┘ │
└────────────────────────────────────────────────────────┘
```

### State Integration
- **`GameEngine` State**:
  - `comboCount: number` (current hit count)
  - `comboTimer: number` (remaining seconds out of 3.5)
  - `comboMaxStreak: number` (recorded for post-battle stats)
- **Audio Feedback**:
  - Incremental harmonic frequency on `soundManager.playHit()` so consecutive strikes produce rising musical pitches.
- **Multiplayer Synchronization**:
  - In Online 1v1 mode, local combo is calculated authoritatively from local hits landed, and opponent's combo count is mirrored during network state sync.

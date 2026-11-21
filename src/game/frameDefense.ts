// Optimization (2.2): automatic frame defense.
//
// Watches real frame times during battle. When the recent 60-frame
// average FPS stays under 45fps for 2s straight, `degraded` latches on
// and the engine halves the particle spawn rate (ParticleSystem
// autoDegradeScale 0.5). It recovers only when the average is back at
// or above 50fps for 2s straight (hysteresis, so it does not flicker).
// Pure logic, no DOM — unit-tested in optimization-2026-11-21.test.ts.

const WINDOW = 60;
const LOW_FPS = 45;
const RECOVER_FPS = 50;
const HOLD_SEC = 2;
// A single huge gap (tab switch, hitch) is not sustained slowness.
const MAX_SAMPLE_SEC = 0.25;

export class FrameDefense {
  private window = new Float64Array(WINDOW);
  private cursor = 0;
  private filled = 0;
  private sum = 0;
  private lowTime = 0;
  private highTime = 0;
  public degraded = false;

  public update(rawDt: number): void {
    if (!Number.isFinite(rawDt) || rawDt <= 0 || rawDt > MAX_SAMPLE_SEC) return;
    if (this.filled === WINDOW) {
      this.sum -= this.window[this.cursor];
    } else {
      this.filled++;
    }
    this.window[this.cursor] = rawDt;
    this.sum += rawDt;
    this.cursor = (this.cursor + 1) % WINDOW;
    if (this.filled < WINDOW) return;

    const avgFps = WINDOW / this.sum;
    if (!this.degraded && avgFps < LOW_FPS) {
      this.lowTime += rawDt;
      this.highTime = 0;
      if (this.lowTime >= HOLD_SEC) {
        this.degraded = true;
        this.lowTime = 0;
      }
    } else if (this.degraded && avgFps >= RECOVER_FPS) {
      this.highTime += rawDt;
      this.lowTime = 0;
      if (this.highTime >= HOLD_SEC) {
        this.degraded = false;
        this.highTime = 0;
      }
    } else {
      this.lowTime = 0;
      this.highTime = 0;
    }
  }

  public reset(): void {
    this.window.fill(0);
    this.cursor = 0;
    this.filled = 0;
    this.sum = 0;
    this.lowTime = 0;
    this.highTime = 0;
    this.degraded = false;
  }
}

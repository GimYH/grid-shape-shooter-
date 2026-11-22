import { ArchetypeId, CampaignProgress, NoContinueRecord } from '../types/game';

// v2.3 campaign progress: highest cleared stage + no-continue record.
// Stored in localStorage under this key. When localStorage is unavailable
// (node tests, privacy mode) an in-memory copy is used instead so the
// helpers never throw.
export const CAMPAIGN_STORAGE_KEY = 'gss_campaign_v1';

let memoryStore: CampaignProgress | null = null;

function cloneProgress(p: CampaignProgress): CampaignProgress {
  return {
    maxCleared: p.maxCleared,
    noContinue: p.noContinue ? { ...p.noContinue } : null,
    lastStage: p.lastStage,
    lastArchetype: p.lastArchetype,
  };
}

export function loadCampaignProgress(): CampaignProgress {
  if (memoryStore) return cloneProgress(memoryStore);
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CAMPAIGN_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as CampaignProgress;
      if (typeof parsed.maxCleared === 'number') {
        return {
          maxCleared: Math.max(0, Math.min(30, Math.floor(parsed.maxCleared))),
          noContinue: parsed.noContinue ?? null,
          lastStage:
            typeof parsed.lastStage === 'number'
              ? Math.max(1, Math.min(30, Math.floor(parsed.lastStage)))
              : undefined,
          lastArchetype: typeof parsed.lastArchetype === 'string' ? parsed.lastArchetype : undefined,
        };
      }
    }
  } catch {
    // Corrupted save: start fresh.
  }
  return { maxCleared: 0, noContinue: null };
}

export function saveCampaignProgress(p: CampaignProgress): void {
  memoryStore = cloneProgress(p);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(p));
    }
  } catch {
    // Storage full/blocked: the in-memory copy still works for the session.
  }
}

export function recordStageClear(stageId: number): CampaignProgress {
  const p = loadCampaignProgress();
  p.maxCleared = Math.max(p.maxCleared, Math.max(0, Math.min(30, stageId)));
  saveCampaignProgress(p);
  return p;
}

// v3.0 Phase 2: remember the last single-campaign deploy so the title
// screen can offer a one-click quick entry (last stage + archetype).
export function recordLastSingle(stageId: number, archetype: ArchetypeId): CampaignProgress {
  const p = loadCampaignProgress();
  p.lastStage = Math.max(1, Math.min(30, Math.floor(stageId)));
  p.lastArchetype = archetype;
  saveCampaignProgress(p);
  return p;
}

// A no-continue run: stages 1..30 cleared in order, starting at stage 1,
// with no defeat in between. "Continue" here means retrying after a defeat
// (or leaving for the title screen mid-run); the engine marks the run
// broken at that point, so a later 1..30 clear only counts if the run
// object survived unbroken from stage 1.
export interface CampaignRunState {
  active: boolean;
  startStage: number;
  broken: boolean;
  startTime: number; // Date.now() at run start
}

export function startCampaignRun(startStage: number): CampaignRunState {
  return { active: true, startStage, broken: false, startTime: Date.now() };
}

export function markRunBroken(run: CampaignRunState): CampaignRunState {
  return { ...run, broken: true };
}

// Call when stage 30 is cleared. Returns the recorded no-continue record,
// or null when this run does not qualify.
export function tryRecordNoContinue(run: CampaignRunState | null): NoContinueRecord | null {
  if (!run || !run.active || run.broken || run.startStage !== 1) return null;
  const rec: NoContinueRecord = {
    timeSec: Math.max(0, Math.round((Date.now() - run.startTime) / 1000)),
    clearedAt: new Date().toISOString(),
  };
  const p = loadCampaignProgress();
  p.noContinue = rec;
  saveCampaignProgress(p);
  return rec;
}

// H:MM:SS once a run passes an hour (a 30-stage run usually does),
// otherwise M:SS.
export function formatClearTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/** Booth data kept in the user-data folder (Chromium caches are not copied). */
export const BOOTH_DATA_ENTRIES = ['settings.json', 'players', 'records', 'logs', 'diagnostics'] as const;

/** Earlier names of the app, newest first: their data folders are migration sources. */
export const PREVIOUS_APP_NAMES = ['Maltina Dance All', 'Maltina Dance Hall', 'DanceOff Booth'] as const;

/** The most recent earlier data folder that holds booth settings, or null. */
export function previousDataDir(appDataDir: string, names: readonly string[] = PREVIOUS_APP_NAMES): string | null {
  for (const n of names) {
    const dir = path.join(appDataDir, n);
    if (existsSync(path.join(dir, 'settings.json'))) return dir;
  }
  return null;
}

/**
 * The app was renamed (DanceOff Booth -> Maltina Dance Hall/All -> FUZE Power
 * Stage), which moves Electron's user-data folder. On the first start under the new name, copy
 * the booth's own data (settings, player ids, session records, logs) across so
 * player numbering, the leaderboard and operator settings carry on.
 * The old folder is left untouched (rollback stays possible). Returns what was copied.
 */
export function migrateUserData(oldDir: string, newDir: string): string[] {
  if (path.resolve(oldDir) === path.resolve(newDir)) return [];
  if (!existsSync(oldDir)) return [];
  // Already migrated or already used under the new name: never overwrite.
  if (existsSync(path.join(newDir, 'settings.json'))) return [];
  const copied: string[] = [];
  mkdirSync(newDir, { recursive: true });
  for (const entry of BOOTH_DATA_ENTRIES) {
    const from = path.join(oldDir, entry);
    const to = path.join(newDir, entry);
    if (!existsSync(from) || existsSync(to)) continue;
    cpSync(from, to, { recursive: true, errorOnExist: false, force: false });
    copied.push(entry);
  }
  return copied;
}

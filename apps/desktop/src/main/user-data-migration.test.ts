import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateUserData, previousDataDir } from './user-data-migration';

function dirs() {
  const root = mkdtempSync(path.join(tmpdir(), 'udm-'));
  const oldDir = path.join(root, 'DanceOff Booth');
  const newDir = path.join(root, 'FUZE Power Stage');
  mkdirSync(path.join(oldDir, 'players'), { recursive: true });
  mkdirSync(path.join(oldDir, 'Cache'), { recursive: true });
  writeFileSync(path.join(oldDir, 'settings.json'), '{"schemaVersion":1}');
  writeFileSync(path.join(oldDir, 'players', 'maltina.json'), '{"next":7}');
  return { oldDir, newDir };
}

describe('migrateUserData', () => {
  it('copies booth data (not caches) to the renamed folder once', () => {
    const { oldDir, newDir } = dirs();
    expect(migrateUserData(oldDir, newDir).sort()).toEqual(['players', 'settings.json']);
    expect(readFileSync(path.join(newDir, 'players', 'maltina.json'), 'utf-8')).toBe('{"next":7}');
    expect(() => readFileSync(path.join(newDir, 'Cache'))).toThrow();
    // Second start: nothing to do, nothing overwritten.
    writeFileSync(path.join(newDir, 'settings.json'), '{"schemaVersion":1,"changed":true}');
    expect(migrateUserData(oldDir, newDir)).toEqual([]);
    expect(readFileSync(path.join(newDir, 'settings.json'), 'utf-8')).toContain('changed');
  });

  it('picks the most recent earlier folder that has booth settings', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'udm-'));
    expect(previousDataDir(root)).toBeNull();
    for (const n of ['DanceOff Booth', 'Maltina Dance Hall']) {
      mkdirSync(path.join(root, n), { recursive: true });
      writeFileSync(path.join(root, n, 'settings.json'), '{}');
    }
    // An earlier folder without settings (only logs, say) is skipped.
    mkdirSync(path.join(root, 'Maltina Dance All', 'logs'), { recursive: true });
    expect(previousDataDir(root)).toBe(path.join(root, 'Maltina Dance Hall'));
  });

  it('does nothing without an old folder', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'udm-'));
    expect(migrateUserData(path.join(root, 'missing'), path.join(root, 'new'))).toEqual([]);
  });
});

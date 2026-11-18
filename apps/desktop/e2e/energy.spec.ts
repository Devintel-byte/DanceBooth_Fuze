import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { enterNames, launchBooth, type Booth } from './launch';

/**
 * FUZE energy experience in REPLAY mode: the synthetic dancer copies the
 * moves, the shared meter charges, and the stage powers up level by level.
 * Captures the stage at 0/25/50/75/100 % (set BOOTH_E2E_FUZE_SHOTS to a
 * folder to also copy them there).
 */
let booth: Booth;

test.beforeAll(async () => {
  booth = await launchBooth({ BOOTH_FORCE_REPLAY: '1' }, { activeProfileId: 'fuze' });
});

test.afterAll(async () => {
  await booth?.close();
});

const state = (s: string) => `.app.state-${s.toLowerCase()}`;

test('energy session: meter charges, stage powers up, ranked by time to full', async () => {
  const p = booth.participant;
  const shots: string[] = [];
  const shot = async (name: string) => {
    const file = test.info().outputPath(`${name}.png`);
    await p.screenshot({ path: file });
    shots.push(file);
  };
  await expect(p.locator(state('ATTRACT'))).toBeVisible({ timeout: 30_000 });
  await expect(p.getByText('Power up the FUZE stage.')).toBeVisible();
  await shot('fuze-00-attract');
  await p.keyboard.press('Enter');
  await expect(p.locator(state('MODE_SELECT'))).toBeVisible();
  await expect(p.getByText('Power up the stage yourself.')).toBeVisible();
  await p.keyboard.press('Enter'); // solo
  await expect(p.locator(state('CHARACTER_SELECT'))).toBeVisible();
  await p.keyboard.press('Enter');
  await enterNames(p, ['Ada']);
  await expect(p.locator(state('TUTORIAL'))).toBeVisible({ timeout: 20_000 });
  await expect(p.getByText('Follow the lit moves.')).toBeVisible();
  await p.keyboard.press('Enter');
  await expect(p.locator(state('PLAYING'))).toBeVisible({ timeout: 10_000 });

  const meter = p.getByRole('meter', { name: 'FUZE energy' });
  await expect(meter).toBeVisible();
  await expect(p.locator('.move-strip .move-card').first()).toBeVisible({ timeout: 10_000 });
  await shot('fuze-01-level-0');

  // Wait for each power level; the meter never goes down.
  let last = 0;
  for (const level of [25, 50, 75, 100]) {
    await expect
      .poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 90_000, intervals: [100] })
      .toBeGreaterThanOrEqual(level);
    const now = Number(await meter.getAttribute('aria-valuenow'));
    expect(now).toBeGreaterThanOrEqual(last);
    last = now;
    await p.waitForTimeout(level === 100 ? 1500 : 700); // let the lights fade in (and the show start)
    await shot(`fuze-0${2 + [25, 50, 75, 100].indexOf(level)}-level-${level}`);
  }
  await expect(p.getByText('Stage powered!')).toBeVisible();
  await p.waitForTimeout(2500);
  await shot('fuze-06-full-show');

  await expect(p.locator(state('RESULTS'))).toBeVisible({ timeout: 90_000 });
  await expect(p.getByText('Ada powered the FUZE stage!')).toBeVisible();
  await expect(p.getByText(/Full power in \d+ seconds/)).toBeVisible();
  await shot('fuze-07-results');

  const dir = process.env.BOOTH_E2E_FUZE_SHOTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const f of shots) copyFileSync(f, path.join(dir, path.basename(f)));
  }
  await p.getByRole('button', { name: 'Finish' }).click();
  await expect(p.locator(state('ATTRACT'))).toBeVisible({ timeout: 10_000 });
});

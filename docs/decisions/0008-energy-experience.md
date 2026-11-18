# 0008 — Energy experience (FUZE: dance to power up the stage)

Date: 2026-11-13. Status: accepted.

## Brief

Participants are the source of the festival's energy. A digital stage shows a
FUZE energy meter at zero; illuminated moves appear on screen; copying them
correctly generates voltage that fills the meter; the more accurate the moves,
the faster it charges; at 100 % the stage comes alive with lights, effects and
a celebration.

## Decisions

* **A second experience, not a replacement.** A profile chooses
  `experience: "dance-off"` (points per move, as the earlier Maltina edition
  played) or `"energy"` (FUZE). The dance-off mode stays available to profiles. The FUZE profile is
  `assets/profiles/fuze.json`, with `stageTheme: "fuze-stage"`.
* **Same judge, different reward.** Moves are judged exactly as in the
  dance-off (same tolerances, same Easy/Normal/Hard). Each judged move adds
  voltage in proportion to how well it was copied: a close match 0.35–0.7, a
  match 0.85–1.2 (cleaner = more). A miss, standing still, random movement or
  being out of view adds nothing. The meter never drains.
* **How fast it fills.** `energy.fullChargeShare` (default 0.75): matching
  every move fills the meter after 75 % of the song's judged moves. Measured on
  the bundled songs (Easy): real copies of the dancer, from tight to loose,
  are full at 65–73 % of the song; sloppy, wrong-move, head-bobbing and
  flailing performers stay at 4–29 %; standing still stays at 0. Raise the
  share for a harder charge, lower it for an easier one (0.3–1).
* **Duo: one shared meter**, each player's voltage counting half, so it fills
  fastest when both dance well.
* **The song plays out.** At 100 % the stage comes alive (with a power-up
  sound, crowd cheer and the dancers celebrating) and the rest of the song is
  the party.
* **Ranking: fastest to full.** Leaderboards and the main leaderboard feed
  still rank integer `points`, higher is better: a full meter scores
  1000 + 10 per second of song left when it filled; otherwise 10 per percent
  reached (max 990). The booth's leaderboard shows "Powered in N s" or "N%".
  Feed records also carry `energyPercent` and `fullAtSec`. Central registry
  results are labelled `fuze-energy-v1`.

## Stage power levels

| Level | What switches on |
| --- | --- |
| 0 % | Dark stage, work light on the dancers, dim screen with the event name |
| 25 % | LED edge strips, truss outline, floor grid |
| 50 % | Par cans pulsing on the beat |
| 75 % | Animated LED screen, sweeping moving-head beams |
| 100 % | Lasers, beat strobe, colour cycling, confetti cannons, spark fountains |

The power towers either side always mirror the meter. Strobes flash at most
once per beat and are off with reduced motion, which also freezes the sweeps.
Particle and beam counts scale with the quality preset. Before a session
(attract, selection) the stage idles at a 30 % teaser.

## Placeholders

FUZE colours, fonts and text are placeholders until official FUZE brand assets
arrive. No logo is set and none is drawn in the scene; the event name is
rendered as text on the screen.

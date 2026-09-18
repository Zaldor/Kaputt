# Kaputt! 3.0 Vs Lab

Dependency-free HTML/JavaScript competitive playtest bench for K3-E1.

Open `index.html` in any modern browser. No build step is required.

## Current experiment

The Lab now tests whether an opponent, score pressure and losing pressure change the Attack / Defense psychology.

- Human vs Human on the same device, alternating turns with a pass-device privacy screen.
- Human vs Computer Bot.
- Bot profiles: Random, Aggressive, Safe, EV Score and transparent State-aware heuristic.
- Shared NtB carried between players.
- Individual score and Kaputt counters.
- Test baseline: first to 100 points wins; reaching 5 Kaputt loses. Both thresholds are editable.
- Immediate match-end detection and rematch.
- PLAY view hides conditional decision statistics.
- LAB view exposes exact conditional Attack / Defense metrics without recommending a move.
- Match telemetry includes turns, Extremes, lead changes, per-player A/D counts, decision time and full JSON history.
- Bot choice rationale is shown only after the bot has committed.

## Frozen K3-E1 resolution

The dice engine is unchanged: hidden 2d6, reveal one, irrevocably choose Attack or Defense, then reveal the second. Attack uses product and must strictly beat NtB; failed Attack causes Kaputt. Defense uses sum, scores the higher die, never causes Kaputt and sets NtB to the sum. Extreme is only 1+6 / 6+1: Attack resolves to 36; Defense resolves to 2 and scores 1. Doubles are normal.

## Experimental status

The competitive victory conditions are a test baseline, not yet frozen 3.0 rules. Fortune Points and other game modes are intentionally excluded from this experiment.



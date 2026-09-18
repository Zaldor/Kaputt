# KAPUTT!

Private development repository for **Kaputt! 3.0**.

Current experimental core build: **K3-E1 — Extremes**.

## Repository structure

- `rules/` — current and reference rulesets
- `design/` — design pillars, decisions, open questions
- `analysis/` — probability work and simulation results
- `simulation/` — scripts and agents
- `playtests/` — protocols and session reports

## Current core

1. Roll 2d6 hidden.
2. Reveal one die.
3. Declare **Attack** or **Defense** before seeing the second die.
4. Reveal the second die.
5. Resolve:
   - **Attack** = multiply.
   - **Defense** = add.
   - **Extreme** on 1+6 / 6+1 polarizes the chosen action.
6. Update the shared Number to Beat (NtB).

See `rules/kaputt-3.0-development.md`.

## Status

Development / mathematical stress test / playtest.

Not publication-ready.

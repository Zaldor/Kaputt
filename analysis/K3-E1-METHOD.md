# K3-E1 Analysis Method

## Purpose

Test the frozen K3-E1 core before changing PF or game modes.

The first model deliberately avoids assigning a single arbitrary utility
function to Attack and Defense. Their strategic value changes by mode:
a high future NtB can hurt the team in cooperative play but pressure an
opponent in competitive play.

## Exact state space

For each:

- NtB = 0..36
- visible die = 1..6
- hidden die = 1..6
- declared action = Attack / Defense

the analyzer resolves the outcome exactly.

The exported conditional matrix contains 37 × 6 = **222 information states**.
If NtB 0 is excluded, the conventional NtB 1..36 analysis contains **216 states**.

## K3-E1 resolution

### Attack

Normal: visible × hidden.

Extreme 1–6 / 6–1: value = 36.

- value > NtB: success, score value, next NtB = value.
- value <= NtB: 1 Kaputt, score 0, NtB unchanged.

### Defense

Normal: visible + hidden.

Extreme 1–6 / 6–1: value = 2, score = 1.

Defense never causes Kaputt and always sets next NtB to its resolved value.

## Metrics exported

- Attack success probability
- Attack Kaputt probability
- Attack expected immediate points
- Attack expected next NtB
- Defense expected immediate points
- Defense expected next NtB
- probability Defense exceeds old NtB
- Extreme probability

## Important distinction

A static state matrix cannot prove that 1→Defense or 6→Attack is dominant.

Dominance depends on:
- mode;
- score target;
- Kaputt threshold;
- ownership of NtB consequences;
- PF rules;
- current score/lives.

Therefore the next simulation layer must implement mode-specific utility and
dynamic game trajectories rather than inventing a universal EV.

## Hypotheses

### H01 Decision Density
Measure how often the preferred action changes with strategic state rather
than only with visible die / NtB.

### H02 Polar dominance
Specifically measure circumstances where:
- visible 1 → Attack remains rational;
- visible 6 → Defense remains rational.

### H03 NtB oscillator
Measure whether real trajectories naturally cycle:
low NtB → Attack escalation → high pressure → Defense decompression.

## Reproducibility

Run:

```bash
python simulation/k3e1_analyzer.py
```

This creates `simulation/k3e1_state_matrix.csv`.

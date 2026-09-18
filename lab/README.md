# Kaputt! 3.0 Lab

A dependency-free HTML/JavaScript playable rules laboratory for K3-E1.

Open `index.html` in any modern browser. No build step or server is required.

## Purpose

This is deliberately halfway between a game prototype and an instrumented test bench.

It provides:

- hidden 2d6 turn flow;
- first-die reveal;
- binding Attack / Defense declaration;
- K3-E1 Extreme resolution;
- editable NtB, score and Kaputt state;
- exact conditional probabilities after the first reveal;
- expected immediate points and expected next NtB;
- session telemetry and event log;
- JSON export for later analysis.

The probability panel is intentionally descriptive: it does not recommend an action because strategic utility depends on the game mode.

## Current limitation

This is a core-engine lab, not yet a complete implementation of Cooperative / Vs / King of the Hill / Battle Royale. Those modes should be added only after their 3.0 rules are frozen.

// Kaputt! K3-E1 — Pure deterministic game engine.
// Single source of truth for rules resolution, state management, and telemetry.
// Used by: Human games, Bot games, Batch simulation, LLM games.
//
// CRITICAL: The engine owns dice/results. Player implementations never see the
// hidden second die before choosing.

// ---------- Seeded PRNG (deterministic simulation) ----------

/** Mulberry32 PRNG — 32-bit state, full period 2^32. */
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a dice roller. If seed is provided, uses deterministic PRNG; otherwise Math.random. */
export function createRng(seed) {
  if (seed === undefined || seed === null) {
    return () => 1 + Math.floor(Math.random() * 6);
  }
  const rng = mulberry32(seed);
  return () => 1 + Math.floor(rng() * 6);
}

// ---------- K3-E1 Resolution (pure, stateless) ----------

const EXTREME_PAIRS = new Set(['1,6', '6,1']);

/** Check if dice form an Extreme pair (1+6 / 6+1 in any order). */
export function isExtreme(a, b) {
  return EXTREME_PAIRS.has(a + ',' + b);
}

/**
 * Resolve a K3-E1 action. Pure function — no side effects.
 *
 * @param {'attack'|'defense'} action - The declared action.
 * @param {number} visible - First revealed die (1-6).
 * @param {number} hidden - Second revealed die (1-6).
 * @param {number} ntb - Current Numero da Battere.
 * @returns {{ extreme: boolean, value: number, points: number, kaputt: boolean,
 *             nextNtb: number, success: boolean }}
 */
export function resolve(action, visible, hidden, ntb) {
  if (action !== 'attack' && action !== 'defense') {
    throw new Error('action must be "attack" or "defense"');
  }
  if (visible < 1 || visible > 6 || hidden < 1 || hidden > 6) {
    throw new Error('dice must be 1-6');
  }
  if (ntb < 0) {
    throw new Error('ntb must be non-negative');
  }

  const extreme = isExtreme(visible, hidden);

  if (action === 'attack') {
    const value = extreme ? 36 : visible * hidden;
    const success = value > ntb;
    return {
      extreme,
      value,
      points: success ? value : 0,
      kaputt: !success,
      nextNtb: success ? value : ntb,
      success,
    };
  }

  // Defense
  const value = extreme ? 2 : visible + hidden;
  const points = extreme ? 1 : Math.max(visible, hidden);
  return {
    extreme,
    value,
    points,
    kaputt: false,
    nextNtb: value,
    success: value > ntb,
  };
}

/**
 * Compute conditional statistics for a visible die + NtB state.
 * Useful for LAB view and bot decision-making.
 *
 * @param {number} visible - Revealed die (1-6).
 * @param {number} ntb - Current NtB.
 * @param {'attack'|'defense'} action - Action to evaluate.
 * @returns {{ success: number, kaputt: number, points: number, nextNtb: number, extreme: number }}
 */
export function conditionalStats(visible, ntb, action) {
  let success = 0, kaputt = 0, points = 0, nextNtb = 0, extreme = 0;
  for (let h = 1; h <= 6; h++) {
    const r = resolve(action, visible, h, ntb);
    if (r.success) success++;
    if (r.kaputt) kaputt++;
    if (r.extreme) extreme++;
    points += r.points;
    nextNtb += r.nextNtb;
  }
  return {
    success: success / 6,
    kaputt: kaputt / 6,
    points: points / 6,
    nextNtb: nextNtb / 6,
    extreme: extreme / 6,
  };
}

// ---------- Game Engine (stateful match) ----------

/** @enum {string} */
export const Phase = Object.freeze({
  IDLE: 'idle',
  ROLLING: 'rolling',
  ROLLED: 'rolled',
  FIRST: 'first',
  CHOSEN: 'chosen',
  RESOLVED: 'resolved',
});

/**
 * Create a new Kaputt engine instance.
 *
 * @param {object} config
 * @param {number} [config.target=100] - Score to reach for victory.
 * @param {number} [config.kaputtLimit=5] - Kaputt lives before loss.
 * @param {number} [config.startingNtb=1] - Initial Numero da Battere.
 * @param {number|string} [config.seed] - PRNG seed for deterministic play.
 * @param {number} [config.playerCount=2] - Number of players (currently always 2).
 */
export function createMatch(config = {}) {
  const target = config.target ?? 100;
  const kaputtLimit = config.kaputtLimit ?? 5;
  const startingNtb = config.startingNtb ?? 1;
  const playerCount = config.playerCount ?? 2;
  const roll = createRng(config.seed);

  let phase = Phase.IDLE;
  let currentPlayer = 0;
  let dice = [0, 0];
  let choice = null;
  let turnNumber = 0;
  let ntb = startingNtb;
  let winner = null;
  let winReason = null;
  let decisionStartTime = 0;

  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      score: 0,
      kaputt: 0,
      attackCount: 0,
      defenseCount: 0,
      failedAttacks: 0,
      decisionTimes: [],
    });
  }

  let extremes = 0;
  let leadChanges = 0;
  let lastLeader = -1;
  const history = [];

  // --- Private helpers ---

  function checkTerminal() {
    for (let i = 0; i < playerCount; i++) {
      if (players[i].score >= target) {
        winner = i;
        winReason = 'score target';
        return true;
      }
    }
    for (let i = 0; i < playerCount; i++) {
      if (players[i].kaputt >= kaputtLimit) {
        winner = 1 - i; // opponent wins
        winReason = 'opponent reached Kaputt limit';
        return true;
      }
    }
    return false;
  }

  function updateLead() {
    let leader;
    if (players[0].score === players[1].score) {
      leader = -1;
    } else {
      leader = players[0].score > players[1].score ? 0 : 1;
    }
    if (lastLeader >= 0 && leader >= 0 && leader !== lastLeader) {
      leadChanges++;
    }
    if (leader >= 0) lastLeader = leader;
  }

  // --- Public API ---

  return {
    /** Current configuration (read-only snapshot). */
    get config() {
      return { target, kaputtLimit, startingNtb, playerCount, seed: config.seed };
    },

    /** Current game phase. */
    get phase() { return phase; },

    /** Index of the player whose turn it is. */
    get currentPlayer() { return currentPlayer; },

    /** Current NtB value. */
    get ntb() { return ntb; },

    /** Dice from the current turn [visible?, hidden?]. */
    get dice() { return [...dice]; },

    /** The chosen action for the current turn, or null. */
    get choice() { return choice; },

    /** Running turn counter. */
    get turnNumber() { return turnNumber; },

    /** Winner index, or null if match ongoing. */
    get winner() { return winner; },

    /** 'score target' | 'opponent reached Kaputt limit' | null. */
    get winReason() { return winReason; },

    /** Player state array (read-only snapshots). */
    get players() {
      return players.map(p => ({
        score: p.score,
        kaputt: p.kaputt,
        attackCount: p.attackCount,
        defenseCount: p.defenseCount,
        failedAttacks: p.failedAttacks,
        decisionTimes: [...p.decisionTimes],
      }));
    },

    /** Count of Extreme events in this match. */
    get extremes() { return extremes; },

    /** Count of lead changes. */
    get leadChanges() { return leadChanges; },

    /** Full match history (array of turn result objects). */
    get history() { return [...history]; },

    /** True if the match has ended. */
    get isTerminal() { return winner !== null; },

    /**
     * Get the PUBLIC state visible to a player making a decision.
     * CRITICAL: Does NOT reveal the hidden second die.
     *
     * @param {number} [playerIndex] - Which player is asking (default: current).
     * @returns {object} Public state snapshot.
     */
    getPublicState(playerIndex) {
      const pi = playerIndex ?? currentPlayer;
      return {
        phase,
        currentPlayer,
        ntb,
        target,
        kaputtLimit,
        visibleDie: phase === Phase.FIRST || phase === Phase.CHOSEN || phase === Phase.RESOLVED
          ? dice[0] : null,
        choice,
        turnNumber,
        winner,
        winReason,
        players: players.map((p, i) => ({
          score: p.score,
          kaputt: p.kaputt,
          isMe: i === pi,
        })),
      };
    },

    /** Start a new turn. Rolls two hidden dice. */
    roll() {
      if (phase !== Phase.IDLE && phase !== Phase.RESOLVED) {
        throw new Error(`Cannot roll in phase "${phase}"`);
      }
      if (winner !== null) {
        throw new Error('Match is over');
      }
      dice = [roll(), roll()];
      choice = null;
      phase = Phase.ROLLING;
      // Immediately transition to ROLLED (animation is a UI concern)
      phase = Phase.ROLLED;
      return { dice: [0, 0] }; // Hidden — callers must not see dice yet
    },

    /** Reveal the first die. Records decision timer start. */
    revealFirst() {
      if (phase !== Phase.ROLLED) {
        throw new Error(`Cannot reveal first in phase "${phase}"`);
      }
      phase = Phase.FIRST;
      decisionStartTime = Date.now();
      return { visibleDie: dice[0] };
    },

    /**
     * Commit to an action. Irrevocable.
     * @param {'attack'|'defense'} action
     */
    choose(action) {
      if (phase !== Phase.FIRST) {
        throw new Error(`Cannot choose in phase "${phase}"`);
      }
      if (action !== 'attack' && action !== 'defense') {
        throw new Error('action must be "attack" or "defense"');
      }
      choice = action;
      phase = Phase.CHOSEN;
      return { choice };
    },

    /** Reveal the second die and resolve the turn. Returns full turn result. */
    revealSecond() {
      if (phase !== Phase.CHOSEN) {
        throw new Error(`Cannot reveal second in phase "${phase}"`);
      }

      const ntbBefore = ntb;
      const decisionMs = Date.now() - decisionStartTime;
      const result = resolve(choice, dice[0], dice[1], ntbBefore);
      const player = players[currentPlayer];
      const opponent = players[1 - currentPlayer];

      // Record pre-turn state for telemetry
      const preState = {
        scoreSelf: player.score,
        scoreOpponent: opponent.score,
        kaputtSelf: player.kaputt,
        kaputtOpponent: opponent.kaputt,
      };

      // Apply result
      player.score += result.points;
      if (result.kaputt) {
        player.kaputt++;
        player.failedAttacks++;
      }
      if (choice === 'attack') {
        player.attackCount++;
      } else {
        player.defenseCount++;
      }
      player.decisionTimes.push(decisionMs);

      ntb = result.nextNtb;
      turnNumber++;
      if (result.extreme) extremes++;

      updateLead();
      checkTerminal();

      // Build canonical turn event
      const turnEvent = {
        turn: turnNumber,
        player: currentPlayer,
        ntbBefore,
        visibleDie: dice[0],
        hiddenDie: dice[1],
        choice,
        decisionMs,
        ...result,
        scoreSelfBefore: preState.scoreSelf,
        scoreOpponentBefore: preState.scoreOpponent,
        kaputtSelfBefore: preState.kaputtSelf,
        kaputtOpponentBefore: preState.kaputtOpponent,
        scoreAfter: player.score,
        kaputtAfter: player.kaputt,
        ntbAfter: ntb,
        winner,
        winReason,
      };

      history.push(turnEvent);
      phase = Phase.RESOLVED;

      return turnEvent;
    },

    /** Advance to the next player's turn. */
    nextTurn() {
      if (phase !== Phase.RESOLVED) {
        throw new Error(`Cannot advance in phase "${phase}"`);
      }
      if (winner !== null) {
        throw new Error('Match is over');
      }
      currentPlayer = 1 - currentPlayer;
      phase = Phase.IDLE;
      dice = [0, 0];
      choice = null;
    },

    /**
     * Execute a full turn atomically: roll → revealFirst → choose → revealSecond → nextTurn.
     * For use by bots and simulators that don't need UI interaction.
     *
     * @param {'attack'|'defense'} action - The action to take.
     * @returns {object} Turn result with all telemetry.
     */
    executeTurn(action) {
      this.roll();
      const { visibleDie } = this.revealFirst();
      this.choose(action);
      const result = this.revealSecond();
      if (!this.isTerminal) {
        this.nextTurn();
      }
      return { visibleDie, ...result };
    },

    /** Export full match data for telemetry / D1 persistence. */
    exportMatch() {
      return {
        config: { target, kaputtLimit, startingNtb, playerCount, seed: config.seed },
        players: players.map(p => ({
          score: p.score,
          kaputt: p.kaputt,
          attackCount: p.attackCount,
          defenseCount: p.defenseCount,
          failedAttacks: p.failedAttacks,
          avgDecisionMs: p.decisionTimes.length
            ? p.decisionTimes.reduce((a, b) => a + b, 0) / p.decisionTimes.length
            : 0,
        })),
        winner,
        winReason,
        turns: turnNumber,
        extremes,
        leadChanges,
        finalNtb: ntb,
        history,
      };
    },
  };
}

// ---------- CommonJS compatibility (for Node.js tests) ----------

/* global module */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createRng,
    isExtreme,
    resolve,
    conditionalStats,
    createMatch,
    Phase,
  };
}

// Kaputt! K3-E1 — Batch bot-vs-bot simulator.
// Runs deterministic experiments using the shared engine.
// Designed for browser (Web Worker or main thread) and Node.js.

/* global KaputtBots */
const engine = (() => {
  // In browser, engine.js is loaded via script tag; in Node, require it.
  if (typeof window !== 'undefined' && window.KaputtEngine) return window.KaputtEngine;
  try { return require('./engine.js'); } catch (e) { return null; }
})();

/**
 * Run a single bot-vs-bot match.
 *
 * @param {object} config
 * @param {string} config.botA - Bot ID for player 0 (from KaputtBots registry).
 * @param {string} config.botB - Bot ID for player 1.
 * @param {number} [config.target=100] - Score target.
 * @param {number} [config.kaputtLimit=5] - Kaputt limit.
 * @param {number} [config.startingNtb=1] - Starting NtB.
 * @param {number} [config.seed] - PRNG seed.
 * @param {number} [config.maxTurns=1000] - Safety limit.
 * @param {object} [config.botRegistry] - Bot registry (window.KaputtBots or equivalent).
 * @returns {object} Full match export + bot metadata.
 */
function runMatch(config) {
  const {
    botA = 'random',
    botB = 'random',
    target = 100,
    kaputtLimit = 5,
    startingNtb = 1,
    seed,
    maxTurns = 1000,
    botRegistry,
  } = config;

  const registry = botRegistry || (typeof window !== 'undefined' && window.KaputtBots);
  if (!registry) throw new Error('No bot registry available');

  const botAInst = registry.get(botA);
  const botBInst = registry.get(botB);
  if (!botAInst) throw new Error(`Bot "${botA}" not found`);
  if (!botBInst) throw new Error(`Bot "${botB}" not found`);

  const match = engine.createMatch({ target, kaputtLimit, startingNtb, seed });
  const botIds = [botA, botB];
  const botInstances = [botAInst, botBInst];

  let turns = 0;
  while (!match.isTerminal && turns < maxTurns) {
    match.roll();
    const { visibleDie } = match.revealFirst();
    const currentPlayer = match.currentPlayer;
    const bot = botInstances[currentPlayer];
    const p = match.players;
    const me = p[currentPlayer];
    const opp = p[1 - currentPlayer];
    const ntb = match.ntb;

    // Build bot context (same interface as Lab)
    const statsA = engine.conditionalStats(visibleDie, ntb, 'attack');
    const statsD = engine.conditionalStats(visibleDie, ntb, 'defense');

    const ctx = {
      a: visibleDie,
      n: ntb,
      A: statsA,
      D: statsD,
      p: me,
      opp,
      target,
      lim: kaputtLimit,
      resolve: engine.resolve,
      stats: engine.conditionalStats,
    };

    const decision = bot.choose(ctx);
    match.choose(decision.choice);
    match.revealSecond();

    if (!match.isTerminal) {
      match.nextTurn();
    }
    turns++;
  }

  const data = match.exportMatch();
  return {
    ...data,
    botA,
    botB,
    maxTurnsReached: turns >= maxTurns,
  };
}

/**
 * Run a batch experiment: N matches between two bots.
 *
 * @param {object} config
 * @param {string} config.botA - Bot ID for player 0.
 * @param {string} config.botB - Bot ID for player 1.
 * @param {number} [config.games=100] - Number of matches.
 * @param {number} [config.target=100] - Score target.
 * @param {number} [config.kaputtLimit=5] - Kaputt limit.
 * @param {number} [config.startingNtb=1] - Starting NtB.
 * @param {number} [config.baseSeed=0] - Base seed (each game gets baseSeed + i).
 * @param {function} [config.onProgress] - Progress callback (completed, total).
 * @param {object} [config.botRegistry] - Bot registry.
 * @returns {object} Experiment results with aggregate metrics.
 */
function runExperiment(config) {
  const {
    botA = 'random',
    botB = 'random',
    games = 100,
    target = 100,
    kaputtLimit = 5,
    startingNtb = 1,
    baseSeed = 0,
    onProgress,
    botRegistry,
  } = config;

  const matches = [];
  const startTime = Date.now();

  for (let i = 0; i < games; i++) {
    const match = runMatch({
      botA,
      botB,
      target,
      kaputtLimit,
      startingNtb,
      seed: baseSeed + i,
      botRegistry,
    });
    matches.push(match);
    if (onProgress) onProgress(i + 1, games);
  }

  const elapsed = Date.now() - startTime;

  return {
    config: { botA, botB, games, target, kaputtLimit, startingNtb, baseSeed },
    elapsed,
    matches,
    metrics: computeMetrics(matches, botA, botB),
  };
}

/**
 * Compute aggregate metrics from a batch of matches.
 */
function computeMetrics(matches, botA, botB) {
  const n = matches.length;
  if (n === 0) return {};

  let botAWins = 0, botBWins = 0;
  let totalTurns = 0, totalExtremes = 0, totalLeadChanges = 0;
  let totalScoreA = 0, totalScoreB = 0;
  let totalKaputtA = 0, totalKaputtB = 0;
  let totalAttacksA = 0, totalDefensesA = 0;
  let totalAttacksB = 0, totalDefensesB = 0;
  let scoreTargetWins = 0, kaputtLimitWins = 0;

  // NtB distribution tracking
  const ntbBands = { low: 0, mid: 0, high: 0, danger: 0 };
  let totalNtb = 0;
  let ntbCount = 0;

  // HOLD chain tracking
  let maxHoldChain = 0;
  let totalHoldChains = 0;
  let holdChainCount = 0;

  // Decision-level aggregation
  let totalAttackSuccess = 0;
  let totalAttackAttempts = 0;
  let totalKaputtEvents = 0;

  for (const m of matches) {
    // Winner
    if (m.winner === 0) botAWins++;
    else if (m.winner === 1) botBWins++;

    totalTurns += m.turns;
    totalExtremes += m.extremes;
    totalLeadChanges += m.leadChanges;

    if (m.players && m.players.length >= 2) {
      totalScoreA += m.players[0].score;
      totalScoreB += m.players[1].score;
      totalKaputtA += m.players[0].kaputt;
      totalKaputtB += m.players[1].kaputt;
      totalAttacksA += m.players[0].attackCount;
      totalDefensesA += m.players[0].defenseCount;
      totalAttacksB += m.players[1].attackCount;
      totalDefensesB += m.players[1].defenseCount;
    }

    if (m.winReason === 'score target') scoreTargetWins++;
    else if (m.winReason === 'opponent reached Kaputt limit') kaputtLimitWins++;

    // Analyze history for NtB and HOLD chains
    if (m.history) {
      let currentHoldChain = 0;
      for (const t of m.history) {
        // NtB bands
        const ntb = t.ntbBefore;
        totalNtb += ntb;
        ntbCount++;
        if (ntb <= 6) ntbBands.low++;
        else if (ntb <= 15) ntbBands.mid++;
        else if (ntb <= 25) ntbBands.high++;
        else ntbBands.danger++;

        // Attack success / Kaputt
        if (t.choice === 'attack') {
          totalAttackAttempts++;
          if (t.success) totalAttackSuccess++;
          if (t.kaputt) totalKaputtEvents++;
        }

        // HOLD chains (failed attacks preserving NtB)
        if (t.choice === 'attack' && t.kaputt && t.ntbAfter === t.ntbBefore) {
          currentHoldChain++;
        } else {
          if (currentHoldChain > 0) {
            totalHoldChains += currentHoldChain;
            holdChainCount++;
            if (currentHoldChain > maxHoldChain) maxHoldChain = currentHoldChain;
          }
          currentHoldChain = 0;
        }
      }
      if (currentHoldChain > 0) {
        totalHoldChains += currentHoldChain;
        holdChainCount++;
        if (currentHoldChain > maxHoldChain) maxHoldChain = currentHoldChain;
      }
    }
  }

  return {
    sampleSize: n,
    winRate: {
      [botA]: botAWins / n,
      [botB]: botBWins / n,
      draws: (n - botAWins - botBWins) / n,
    },
    wins: { [botA]: botAWins, [botB]: botBWins },
    terminalCause: { scoreTarget: scoreTargetWins, kaputtLimit: kaputtLimitWins },
    turns: {
      total: totalTurns,
      mean: totalTurns / n,
    },
    scores: {
      [`${botA}_mean`]: totalScoreA / n,
      [`${botB}_mean`]: totalScoreB / n,
    },
    kaputt: {
      [`${botA}_mean`]: totalKaputtA / n,
      [`${botB}_mean`]: totalKaputtB / n,
    },
    actions: {
      [`${botA}_attack_rate`]: totalAttacksA / Math.max(1, totalAttacksA + totalDefensesA),
      [`${botB}_attack_rate`]: totalAttacksB / Math.max(1, totalAttacksB + totalDefensesB),
      [`${botA}_attacks`]: totalAttacksA,
      [`${botA}_defenses`]: totalDefensesA,
      [`${botB}_attacks`]: totalAttacksB,
      [`${botB}_defenses`]: totalDefensesB,
    },
    attackSuccessRate: totalAttackAttempts > 0 ? totalAttackSuccess / totalAttackAttempts : 0,
    kaputtRate: totalAttackAttempts > 0 ? totalKaputtEvents / totalAttackAttempts : 0,
    extremes: { total: totalExtremes, mean: totalExtremes / n },
    leadChanges: { total: totalLeadChanges, mean: totalLeadChanges / n },
    ntb: {
      mean: ntbCount > 0 ? totalNtb / ntbCount : 0,
      bands: ntbBands,
    },
    holdChains: {
      max: maxHoldChain,
      mean: holdChainCount > 0 ? totalHoldChains / holdChainCount : 0,
      totalChains: holdChainCount,
    },
    firstPlayerAdvantage: {
      // How often player 0 (first to act) wins
      rate: botAWins / n,
    },
  };
}

/**
 * Run the full experimental matrix: bot matchups × K values.
 *
 * @param {object} config
 * @param {Array<[string,string]>} config.matchups - Array of [botA, botB] pairs.
 * @param {number[]} config.kValues - Kaputt limits to test.
 * @param {number} [config.games=1000] - Games per cell.
 * @param {number} [config.target=100] - Score target.
 * @param {number} [config.baseSeed=0] - Base seed.
 * @param {function} [config.onProgress] - Progress callback (experiment, total).
 * @param {object} [config.botRegistry] - Bot registry.
 * @returns {object} Map of experiment results keyed by "botA-vs-botB-K{k}".
 */
function runMatrix(config) {
  const {
    matchups = [['random', 'random']],
    kValues = [5],
    games = 1000,
    target = 100,
    baseSeed = 0,
    onProgress,
    botRegistry,
  } = config;

  const results = {};
  const total = matchups.length * kValues.length;
  let completed = 0;

  for (const [botA, botB] of matchups) {
    for (const k of kValues) {
      const key = `${botA}-vs-${botB}-K${k}`;
      results[key] = runExperiment({
        botA,
        botB,
        games,
        target,
        kaputtLimit: k,
        startingNtb: 1,
        baseSeed: baseSeed + completed * games,
        botRegistry,
      });
      completed++;
      if (onProgress) onProgress(completed, total);
    }
  }

  return results;
}

// Export for both browser and Node.js
if (typeof window !== 'undefined') {
  window.KaputtSimulator = { runMatch, runExperiment, computeMetrics, runMatrix };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runMatch, runExperiment, computeMetrics, runMatrix };
}

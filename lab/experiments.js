#!/usr/bin/env node
// Kaputt! K3-E1 — Experimental matrix runner.
// Runs the key experiments defined in the handoff (§19).
// Run: node lab/experiments.js

const { resolve, conditionalStats, createMatch } = require('./engine.js');

// ---------- Bot implementations (mirror of lab/bots.js) ----------

const bots = {
  random: {
    id: 'random', label: 'Random',
    choose: () => ({ choice: Math.random() < 0.5 ? 'attack' : 'defense' }),
  },
  aggressive: {
    id: 'aggressive', label: 'Aggressive',
    choose: ({ A }) => ({ choice: A.success >= 1 / 6 ? 'attack' : 'defense' }),
  },
  safe: {
    id: 'safe', label: 'Safe',
    choose: ({ A, D }) => ({ choice: (A.kaputt <= 1 / 6 && A.points > D.points) ? 'attack' : 'defense' }),
  },
  ev: {
    id: 'ev', label: 'EV Score',
    choose: ({ A, D }) => ({ choice: A.points > D.points ? 'attack' : 'defense' }),
  },
  state: {
    id: 'state', label: 'State-aware',
    choose: ({ A, D, p, opp, target, lim, n }) => {
      const urgency = (p.score < opp.score ? 2 : 0) + (opp.score >= target * 0.8 ? 2 : 0);
      const danger = p.kaputt >= lim - 1 ? 5 : 0;
      const ua = A.points - A.kaputt * (8 + danger) + A.success * urgency;
      const ud = D.points + (D.nextNtb < n ? 1.5 : 0);
      return { choice: ua > ud ? 'attack' : 'defense' };
    },
  },
  strategist2: {
    id: 'strategist2', label: 'Strategist v2',
    choose: ({ a, n, A, p, opp, target, lim }) => {
      const utility = (myScore, myK, enemyScore, enemyK, nextNtb) => {
        if (myScore >= target || enemyK >= lim) return 1;
        if (enemyScore >= target || myK >= lim) return 0;
        const score = (myScore - enemyScore) / (target * 2.5);
        const lives = ((lim - myK) - (lim - enemyK)) * 0.06;
        const pressure = Math.min(nextNtb, 36) / 36 * 0.035;
        return Math.max(0, Math.min(1, 0.5 + score + lives + pressure));
      };
      const afterOpponent = (myScore, myK, enemyScore, enemyK, nextNtb) => {
        let total = 0;
        for (let ov = 1; ov <= 6; ov++) {
          let worst = 1;
          for (const oc of ['attack', 'defense']) {
            let branch = 0;
            for (let oh = 1; oh <= 6; oh++) {
              const rr = resolve(oc, ov, oh, nextNtb);
              branch += utility(myScore, myK, enemyScore + rr.points, enemyK + (rr.kaputt ? 1 : 0), rr.nextNtb);
            }
            branch /= 6;
            if (branch < worst) worst = branch;
          }
          total += worst;
        }
        return total / 6;
      };
      const evalAction = (action) => {
        let total = 0;
        for (let h = 1; h <= 6; h++) {
          const r = resolve(action, a, h, n);
          const ms = p.score + r.points, mk = p.kaputt + (r.kaputt ? 1 : 0);
          if (ms >= target || opp.kaputt >= lim) total += 1;
          else if (mk >= lim) total += 0;
          else total += afterOpponent(ms, mk, opp.score, opp.kaputt, r.nextNtb);
        }
        return total / 6;
      };
      const ua = evalAction('attack'), ud = evalAction('defense');
      return { choice: ua > ud ? 'attack' : 'defense' };
    },
  },
  strategist3: {
    id: 'strategist3', label: 'Strategist v3',
    choose: ({ a, n, A, D, p, opp, target, lim }) => {
      const clamp = (x) => Math.max(0, Math.min(1, x));
      const memo = new Map();
      const attMemo = new Map();
      const MAX_DEPTH = 3;
      const attackability = (ntb) => {
        if (attMemo.has(ntb)) return attMemo.get(ntb);
        let q = 0;
        for (let v = 1; v <= 6; v++) {
          let best = 0;
          for (const action of ['attack', 'defense']) {
            let ev = 0;
            for (let h = 1; h <= 6; h++) {
              const r = resolve(action, v, h, ntb);
              ev += r.points - r.kaputt * 6;
            }
            best = Math.max(best, ev / 6);
          }
          q += best;
        }
        const out = q / 6; attMemo.set(ntb, out); return out;
      };
      const baseAttackability = attackability(1);
      const pressureOf = (ntb) => clamp(1 - attackability(ntb) / Math.max(0.001, baseAttackability));
      const leaf = (ms, mk, es, ek, ntb) => {
        if (ms >= target || ek >= lim) return 1;
        if (es >= target || mk >= lim) return 0;
        const score = (ms - es) / (target * 2.1);
        const life = (ek - mk) / Math.max(1, lim) * 0.18;
        const enemyNeed = Math.max(1, target - es);
        const urgency = clamp(12 / enemyNeed);
        return clamp(0.5 + score + life + pressureOf(ntb) * (0.08 + 0.12 * urgency));
      };
      const stateValue = (ms, mk, es, ek, ntb, depth) => {
        if (ms >= target || ek >= lim) return 1;
        if (es >= target || mk >= lim) return 0;
        if (depth <= 0) return leaf(ms, mk, es, ek, ntb);
        const key = [ms, mk, es, ek, ntb, depth].join('|');
        if (memo.has(key)) return memo.get(key);
        let total = 0;
        for (let v = 1; v <= 6; v++) {
          let worst = 1;
          for (const action of ['attack', 'defense']) {
            let q = 0;
            for (let h = 1; h <= 6; h++) {
              const r = resolve(action, v, h, ntb);
              q += 1 - stateValue(es + r.points, ek + (r.kaputt ? 1 : 0), ms, mk, r.nextNtb, depth - 1);
            }
            q /= 6;
            if (q < worst) worst = q;
          }
          total += worst;
        }
        const out = total / 6;
        memo.set(key, out);
        return out;
      };
      const evalAction = (action) => {
        let total = 0;
        for (let h = 1; h <= 6; h++) {
          const r = resolve(action, a, h, n);
          total += stateValue(p.score + r.points, p.kaputt + (r.kaputt ? 1 : 0), opp.score, opp.kaputt, r.nextNtb, MAX_DEPTH);
        }
        return total / 6;
      };
      let ua = evalAction('attack'), ud = evalAction('defense');
      const lives = Math.max(0, lim - p.kaputt);
      const enemyLives = Math.max(0, lim - opp.kaputt);
      const oppNeed = Math.max(1, target - opp.score);
      const opportunity = clamp(A.success * 0.55 + clamp(A.points / 18) * 0.45);
      const buildRoom = 1 - pressureOf(n);
      const runway = clamp((lives - 0.5) / Math.max(1, lim));
      const attackBonus = opportunity * buildRoom * runway * 0.16;
      const concession = Math.max(0, pressureOf(n) - pressureOf(D.nextNtb));
      const leverage = clamp(0.5 + (lives - enemyLives) / (2 * Math.max(1, lim)));
      const holdBonus = concession * (0.04 + 0.1 * leverage + 0.1 * clamp(12 / oppNeed));
      ua += attackBonus + holdBonus;
      return { choice: ua > ud ? 'attack' : 'defense' };
    },
  },
};

// ---------- Simulator ----------

function runMatch(botA, botB, config) {
  const { target, kaputtLimit, startingNtb, seed, maxTurns = 1000 } = config;
  const match = createMatch({ target, kaputtLimit, startingNtb, seed });
  const botInstances = [bots[botA], bots[botB]];
  let turns = 0;
  while (!match.isTerminal && turns < maxTurns) {
    match.roll();
    const { visibleDie } = match.revealFirst();
    const cp = match.currentPlayer;
    const me = match.players[cp];
    const opp = match.players[1 - cp];
    const ctx = {
      a: visibleDie, n: match.ntb,
      A: conditionalStats(visibleDie, match.ntb, 'attack'),
      D: conditionalStats(visibleDie, match.ntb, 'defense'),
      p: me, opp, target, lim: kaputtLimit,
    };
    const decision = botInstances[cp].choose(ctx);
    match.choose(decision.choice);
    match.revealSecond();
    if (!match.isTerminal) match.nextTurn();
    turns++;
  }
  return match.exportMatch();
}

function runExperiment(botA, botB, games, config) {
  const matches = [];
  const start = Date.now();
  for (let i = 0; i < games; i++) {
    matches.push(runMatch(botA, botB, { ...config, seed: config.baseSeed + i }));
  }
  return { elapsed: Date.now() - start, matches, config: { botA, botB, games, ...config } };
}

function computeMetrics(result) {
  const { matches, config } = result;
  const n = matches.length;
  let botAWins = 0, botBWins = 0, totalTurns = 0, totalExtremes = 0, totalLeadChanges = 0;
  let totalScoreA = 0, totalScoreB = 0, totalKaputtA = 0, totalKaputtB = 0;
  let totalAttacksA = 0, totalDefensesA = 0, totalAttacksB = 0, totalDefensesB = 0;
  let scoreTargetWins = 0, kaputtLimitWins = 0;
  let totalNtb = 0, ntbCount = 0;
  const ntbBands = { low: 0, mid: 0, high: 0, danger: 0 };
  let maxHoldChain = 0, totalHoldChains = 0, holdChainCount = 0;
  let totalAttackSuccess = 0, totalAttackAttempts = 0, totalKaputtEvents = 0;

  for (const m of matches) {
    if (m.winner === 0) botAWins++;
    else if (m.winner === 1) botBWins++;
    totalTurns += m.turns;
    totalExtremes += m.extremes;
    totalLeadChanges += m.leadChanges;
    totalScoreA += m.players[0].score;
    totalScoreB += m.players[1].score;
    totalKaputtA += m.players[0].kaputt;
    totalKaputtB += m.players[1].kaputt;
    totalAttacksA += m.players[0].attackCount;
    totalDefensesA += m.players[0].defenseCount;
    totalAttacksB += m.players[1].attackCount;
    totalDefensesB += m.players[1].defenseCount;
    if (m.winReason === 'score target') scoreTargetWins++;
    else if (m.winReason === 'opponent reached Kaputt limit') kaputtLimitWins++;

    if (m.history) {
      let currentHoldChain = 0;
      for (const t of m.history) {
        const ntb = t.ntbBefore;
        totalNtb += ntb;
        ntbCount++;
        if (ntb <= 6) ntbBands.low++;
        else if (ntb <= 15) ntbBands.mid++;
        else if (ntb <= 25) ntbBands.high++;
        else ntbBands.danger++;
        if (t.choice === 'attack') {
          totalAttackAttempts++;
          if (t.success) totalAttackSuccess++;
          if (t.kaputt) totalKaputtEvents++;
        }
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
    winRate: { [config.botA]: botAWins / n, [config.botB]: botBWins / n },
    wins: { [config.botA]: botAWins, [config.botB]: botBWins },
    terminalCause: { scoreTarget: scoreTargetWins, kaputtLimit: kaputtLimitWins },
    turns: { mean: totalTurns / n },
    scores: { [config.botA]: totalScoreA / n, [config.botB]: totalScoreB / n },
    kaputt: { [config.botA]: totalKaputtA / n, [config.botB]: totalKaputtB / n },
    actions: {
      [config.botA + '_attack_rate']: totalAttacksA / Math.max(1, totalAttacksA + totalDefensesA),
      [config.botB + '_attack_rate']: totalAttacksB / Math.max(1, totalAttacksB + totalDefensesB),
    },
    attackSuccessRate: totalAttackAttempts > 0 ? totalAttackSuccess / totalAttackAttempts : 0,
    kaputtRate: totalAttackAttempts > 0 ? totalKaputtEvents / totalAttackAttempts : 0,
    extremes: { mean: totalExtremes / n },
    leadChanges: { mean: totalLeadChanges / n },
    ntb: { mean: ntbCount > 0 ? totalNtb / ntbCount : 0, bands: ntbBands },
    holdChains: { max: maxHoldChain, mean: holdChainCount > 0 ? totalHoldChains / holdChainCount : 0, totalChains: holdChainCount },
    firstPlayerAdvantage: { rate: botAWins / n },
  };
}

// ---------- Main ----------

function main() {
  const TARGET = 100;
  const BASE_SEED = 0;

  const matchups = [
    ['random', 'random', 1000],
    ['strategist2', 'strategist3', 10],
    ['strategist3', 'strategist3', 10],
  ];
  const kValues = [1, 3, 5];

  console.log('='.repeat(80));
  console.log('KAPUTT! K3-E1 — Experimental Matrix');
  console.log(`Target: ${TARGET} | Base seed: ${BASE_SEED}`);
  console.log('='.repeat(80));

  const allResults = {};
  let cell = 0;
  const total = matchups.length * kValues.length;

  for (const [botA, botB, games] of matchups) {
    for (const k of kValues) {
      cell++;
      const label = `${botA} vs ${botB} K=${k}`;
      process.stdout.write(`[${cell}/${total}] ${label} ... `);

      const result = runExperiment(botA, botB, games, {
        target: TARGET,
        kaputtLimit: k,
        startingNtb: 1,
        baseSeed: BASE_SEED + cell * 10000,
      });
      const metrics = computeMetrics(result);
      allResults[label] = { ...result, metrics };

      console.log(`${result.elapsed}ms | WR: ${botA} ${(metrics.winRate[botA] * 100).toFixed(1)}% / ${botB} ${(metrics.winRate[botB] * 100).toFixed(1)}% | Turns: ${metrics.turns.mean.toFixed(1)} | Hold max: ${metrics.holdChains.max}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('DETAILED RESULTS');
  console.log('='.repeat(80));

  for (const [label, result] of Object.entries(allResults)) {
    const m = result.metrics;
    const c = result.config;
    console.log(`\n--- ${label} ---`);
    console.log(`  Win rate: ${c.botA} ${(m.winRate[c.botA] * 100).toFixed(1)}% | ${c.botB} ${(m.winRate[c.botB] * 100).toFixed(1)}%`);
    console.log(`  Terminal: score=${m.terminalCause.scoreTarget} | kaputt=${m.terminalCause.kaputtLimit}`);
    console.log(`  Turns: ${m.turns.mean.toFixed(1)} mean`);
    console.log(`  Scores: ${c.botA}=${m.scores[c.botA].toFixed(1)} | ${c.botB}=${m.scores[c.botB].toFixed(1)}`);
    console.log(`  Kaputt: ${c.botA}=${m.kaputt[c.botA].toFixed(2)} | ${c.botB}=${m.kaputt[c.botB].toFixed(2)}`);
    console.log(`  Attack rate: ${c.botA}=${(m.actions[c.botA + '_attack_rate'] * 100).toFixed(1)}% | ${c.botB}=${(m.actions[c.botB + '_attack_rate'] * 100).toFixed(1)}%`);
    console.log(`  Attack success: ${(m.attackSuccessRate * 100).toFixed(1)}% | Kaputt rate: ${(m.kaputtRate * 100).toFixed(1)}%`);
    console.log(`  NtB mean: ${m.ntb.mean.toFixed(1)} | Bands: low=${m.ntb.bands.low} mid=${m.ntb.bands.mid} high=${m.ntb.bands.high} danger=${m.ntb.bands.danger}`);
    console.log(`  Hold chains: max=${m.holdChains.max} | total=${m.holdChains.totalChains} | mean=${m.holdChains.mean.toFixed(1)}`);
    console.log(`  Extremes/game: ${m.extremes.mean.toFixed(2)} | Lead changes/game: ${m.leadChanges.mean.toFixed(1)}`);
    console.log(`  First player WR: ${(m.firstPlayerAdvantage.rate * 100).toFixed(1)}%`);
  }

  // Cross-K comparison
  console.log('\n' + '='.repeat(80));
  console.log('K-PARAMETER COMPARISON');
  console.log('='.repeat(80));
  console.log('Matchup'.padEnd(35) + 'K=1'.padStart(12) + 'K=3'.padStart(12) + 'K=5'.padStart(12));
  console.log('-'.repeat(71));

  for (const [botA, botB] of matchups) {
    for (const metric of ['turns.mean', 'holdChains.max', 'attackSuccessRate', 'ntb.mean']) {
      const label = `${botA} vs ${botB} — ${metric}`;
      let vals = [];
      for (const k of kValues) {
        const key = `${botA} vs ${botB} K=${k}`;
        const m = allResults[key].metrics;
        let val;
        if (metric === 'turns.mean') val = m.turns.mean.toFixed(1);
        else if (metric === 'holdChains.max') val = String(m.holdChains.max);
        else if (metric === 'attackSuccessRate') val = (m.attackSuccessRate * 100).toFixed(1) + '%';
        else if (metric === 'ntb.mean') val = m.ntb.mean.toFixed(1);
        vals.push(val);
      }
      console.log(label.padEnd(35) + vals[0].padStart(12) + vals[1].padStart(12) + vals[2].padStart(12));
    }
    console.log('');
  }

  // Save results
  const fs = require('fs');
  const outPath = __dirname + '/experiment-results.json';
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`Results saved to ${outPath}`);
}

main();

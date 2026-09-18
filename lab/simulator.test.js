// Quick verification of simulator.js with mock bots (Node.js).
// Run: node lab/simulator.test.js

const { createMatch, resolve, conditionalStats } = require('./engine.js');
const { runMatch, runExperiment, runMatrix } = require('./simulator.js');

// Mock bot registry for Node.js testing
const mockBots = {
  random: { id: 'random', label: 'Random', choose: () => ({ choice: Math.random() < 0.5 ? 'attack' : 'defense' }) },
  aggressive: { id: 'aggressive', label: 'Aggressive', choose: ({ A }) => ({ choice: A.success >= 1 / 6 ? 'attack' : 'defense' }) },
  safe: { id: 'safe', label: 'Safe', choose: ({ A, D }) => ({ choice: (A.kaputt <= 1 / 6 && A.points > D.points) ? 'attack' : 'defense' }) },
};

const mockRegistry = {
  get: (id) => mockBots[id] || null,
  list: () => Object.values(mockBots),
};

console.log('Testing simulator...');

// Test 1: runMatch
const match = runMatch({
  botA: 'random',
  botB: 'random',
  target: 100,
  kaputtLimit: 5,
  seed: 42,
  botRegistry: mockRegistry,
});

console.log(`Match complete: winner=${match.winner}, turns=${match.turns}, reason=${match.winReason}`);
console.assert(match.winner !== null, 'Match should have a winner');
console.assert(match.turns > 0, 'Match should have turns');
console.assert(match.history.length === match.turns, 'History should match turn count');

// Test 2: Seeded repeatability (requires deterministic bots — random uses Math.random)
const deterministicBots = {
  always_attack: { id: 'always_attack', label: 'Always Attack', choose: () => ({ choice: 'attack' }) },
  always_defend: { id: 'always_defend', label: 'Always Defend', choose: () => ({ choice: 'defense' }) },
  ev: { id: 'ev', label: 'EV', choose: ({ A, D }) => ({ choice: A.points > D.points ? 'attack' : 'defense' }) },
};
const detRegistry = {
  get: (id) => deterministicBots[id],
  list: () => Object.values(deterministicBots),
};

const match2 = runMatch({
  botA: 'ev',
  botB: 'always_attack',
  target: 100,
  kaputtLimit: 5,
  seed: 42,
  botRegistry: detRegistry,
});
const match3 = runMatch({
  botA: 'ev',
  botB: 'always_attack',
  target: 100,
  kaputtLimit: 5,
  seed: 42,
  botRegistry: detRegistry,
});

console.assert(match2.winner === match3.winner, 'Same seed → same winner');
console.assert(match2.turns === match3.turns, 'Same seed → same turns');
const strip = h => h.map(t => ({ turn: t.turn, value: t.value, points: t.points, kaputt: t.kaputt, nextNtb: t.nextNtb, choice: t.choice }));
console.assert(JSON.stringify(strip(match2.history)) === JSON.stringify(strip(match3.history)), 'Same seed → same game logic (excluding decisionMs)');
console.log('Seeded repeatability: OK');

// Test 3: runExperiment
const exp = runExperiment({
  botA: 'random',
  botB: 'aggressive',
  games: 100,
  target: 100,
  kaputtLimit: 5,
  baseSeed: 0,
  botRegistry: mockRegistry,
});

console.log(`Experiment: ${exp.metrics.sampleSize} games in ${exp.elapsed}ms`);
console.log(`Win rate: random=${(exp.metrics.winRate.random * 100).toFixed(1)}%, aggressive=${(exp.metrics.winRate.aggressive * 100).toFixed(1)}%`);
console.log(`Mean turns: ${exp.metrics.turns.mean.toFixed(1)}`);
console.log(`Attack rate: random=${(exp.metrics.actions.random_attack_rate * 100).toFixed(1)}%, aggressive=${(exp.metrics.actions.aggressive_attack_rate * 100).toFixed(1)}%`);
console.log(`NtB mean: ${exp.metrics.ntb.mean.toFixed(1)}`);
console.log(`Hold chains: max=${exp.metrics.holdChains.max}, count=${exp.metrics.holdChains.totalChains}`);
console.assert(exp.matches.length === 100, 'Should have 100 matches');

// Test 4: runMatrix
const matrix = runMatrix({
  matchups: [['random', 'aggressive']],
  kValues: [1, 3, 5],
  games: 50,
  baseSeed: 0,
  botRegistry: mockRegistry,
});

const keys = Object.keys(matrix);
console.assert(keys.length === 3, 'Should have 3 experiments');
console.log(`Matrix: ${keys.join(', ')}`);
for (const key of keys) {
  const m = matrix[key].metrics;
  console.log(`  ${key}: WR random=${(m.winRate.random * 100).toFixed(1)}%, turns=${m.turns.mean.toFixed(1)}, hold_max=${m.holdChains.max}`);
}

console.log('\nAll simulator tests passed!');

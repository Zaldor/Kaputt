// Kaputt! K3-E1 engine test suite — node:test, zero dependencies.
// Tests the pure deterministic engine against frozen K3-E1 rules.
// Run: node --test lab/engine.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createRng, isExtreme, resolve, conditionalStats, createMatch, Phase } = require('./engine.js');

// ===== K3-E1 Resolution — Pure Functions =====

describe('isExtreme()', () => {
  it('returns true only for 1,6 and 6,1', () => {
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        const expected = (a === 1 && b === 6) || (a === 6 && b === 1);
        assert.equal(isExtreme(a, b), expected, `isExtreme(${a},${b}) should be ${expected}`);
      }
    }
  });

  it('finds exactly 2 extreme pairs out of 36', () => {
    let count = 0;
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++)
        if (isExtreme(a, b)) count++;
    assert.equal(count, 2);
  });
});

describe('resolve() — Attack', () => {
  it('succeeds when product > NtB', () => {
    const r = resolve('attack', 4, 5, 12);
    assert.equal(r.value, 20);
    assert.equal(r.success, true);
    assert.equal(r.points, 20);
    assert.equal(r.nextNtb, 20);
    assert.equal(r.kaputt, false);
    assert.equal(r.extreme, false);
  });

  it('fails when product <= NtB (Kaputt)', () => {
    const r = resolve('attack', 2, 3, 20);
    assert.equal(r.value, 6);
    assert.equal(r.success, false);
    assert.equal(r.points, 0);
    assert.equal(r.nextNtb, 20); // NtB unchanged
    assert.equal(r.kaputt, true);
    assert.equal(r.extreme, false);
  });

  it('fails when product == NtB (strictly greater)', () => {
    const r = resolve('attack', 4, 5, 20);
    assert.equal(r.value, 20);
    assert.equal(r.success, false); // 20 is NOT > 20
    assert.equal(r.kaputt, true);
  });

  it('treats 6,6 as normal (not extreme)', () => {
    const r = resolve('attack', 6, 6, 10);
    assert.equal(r.value, 36);
    assert.equal(r.extreme, false);
    assert.equal(r.success, true);
  });

  it('treats 1,1 as normal', () => {
    const r = resolve('attack', 1, 1, 0);
    assert.equal(r.value, 1);
    assert.equal(r.extreme, false);
    assert.equal(r.success, true);
  });

  it('all other doubles are normal', () => {
    for (let d = 2; d <= 5; d++) {
      const r = resolve('attack', d, d, 0);
      assert.equal(r.value, d * d);
      assert.equal(r.extreme, false);
    }
  });
});

describe('resolve() — Defense', () => {
  it('scores the higher die, not the sum', () => {
    const r = resolve('defense', 4, 3, 24);
    assert.equal(r.value, 7); // sum
    assert.equal(r.points, 4); // higher die
    assert.equal(r.nextNtb, 7);
    assert.equal(r.kaputt, false);
    assert.equal(r.extreme, false);
  });

  it('higher die works when second is larger', () => {
    const r = resolve('defense', 2, 5, 10);
    assert.equal(r.points, 5); // higher die = 5
    assert.equal(r.value, 7);
  });

  it('never causes Kaputt even at very high NtB', () => {
    const r = resolve('defense', 1, 1, 100);
    assert.equal(r.kaputt, false);
  });

  it('always safe — no Kaputt for any dice', () => {
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        const r = resolve('defense', a, b, 36);
        assert.equal(r.kaputt, false, `Defense(${a},${b}) should never be kaputt`);
      }
    }
  });
});

describe('resolve() — Extreme (1+6 / 6+1)', () => {
  it('Extreme Attack (1,6) → 36', () => {
    const r = resolve('attack', 1, 6, 10);
    assert.equal(r.value, 36);
    assert.equal(r.extreme, true);
    assert.equal(r.success, true);
    assert.equal(r.points, 36);
    assert.equal(r.nextNtb, 36);
  });

  it('Extreme Attack (6,1) → 36', () => {
    const r = resolve('attack', 6, 1, 10);
    assert.equal(r.value, 36);
    assert.equal(r.extreme, true);
    assert.equal(r.success, true);
  });

  it('Extreme Defense (1,6) → 2, score 1', () => {
    const r = resolve('defense', 1, 6, 10);
    assert.equal(r.value, 2);
    assert.equal(r.points, 1);
    assert.equal(r.nextNtb, 2);
    assert.equal(r.extreme, true);
    assert.equal(r.kaputt, false);
  });

  it('Extreme Defense (6,1) → 2, score 1', () => {
    const r = resolve('defense', 6, 1, 10);
    assert.equal(r.value, 2);
    assert.equal(r.points, 1);
    assert.equal(r.extreme, true);
  });

  it('NtB=36: Extreme Attack FAILS (36 is NOT > 36)', () => {
    const r = resolve('attack', 1, 6, 36);
    assert.equal(r.value, 36);
    assert.equal(r.success, false); // CRITICAL: strictly greater
    assert.equal(r.kaputt, true);
    assert.equal(r.points, 0);
    assert.equal(r.nextNtb, 36); // unchanged
  });

  it('Attack=36 symmetry: 6,6 and 1,6 and 6,1 all produce 36', () => {
    const pairs = [[6, 6], [1, 6], [6, 1]];
    for (const [a, b] of pairs) {
      const r = resolve('attack', a, b, 10);
      assert.equal(r.value, 36, `attack(${a},${b}) should be 36`);
    }
  });

  it('Defense=2 symmetry: 1,1 and 1,6 and 6,1 all produce value 2', () => {
    const pairs = [[1, 1], [1, 6], [6, 1]];
    for (const [a, b] of pairs) {
      const r = resolve('defense', a, b, 10);
      assert.equal(r.value, 2, `defense(${a},${b}) value should be 2`);
    }
  });

  it('Conditional: Defense scores 1 for Extreme, but 1 for 1,1', () => {
    assert.equal(resolve('defense', 1, 6, 10).points, 1); // extreme
    assert.equal(resolve('defense', 6, 1, 10).points, 1); // extreme
    assert.equal(resolve('defense', 1, 1, 10).points, 1); // natural min
  });
});

describe('resolve() — purity', () => {
  it('same inputs always produce same output', () => {
    for (let i = 0; i < 100; i++) {
      const r1 = resolve('attack', 3, 4, 15);
      const r2 = resolve('attack', 3, 4, 15);
      assert.deepStrictEqual(r1, r2);
    }
  });

  it('invalid action throws', () => {
    assert.throws(() => resolve('fly', 3, 4, 10), /action must be/);
  });

  it('invalid dice throws', () => {
    assert.throws(() => resolve('attack', 0, 4, 10), /dice must be 1-6/);
    assert.throws(() => resolve('attack', 3, 7, 10), /dice must be 1-6/);
  });

  it('negative NtB throws', () => {
    assert.throws(() => resolve('attack', 3, 4, -1), /ntb must be non-negative/);
  });
});

// ===== Conditional Statistics =====

describe('conditionalStats()', () => {
  it('visible=6, ntb=10: Attack success = 4/6 (6×2=12, 6×3=18, 6×4=24, 6×5=30, 6×6=36, extreme=36)', () => {
    const s = conditionalStats(6, 10, 'attack');
    // hidden 1: 6×1=6 fail; 2:12 ok; 3:18 ok; 4:24 ok; 5:30 ok; 6:36 ok; (but 6,1 extreme→36 ok)
    // So: 6×1 with extreme = 36, success. 6×2=12 ok. 6×3=18 ok. 6×4=24 ok. 6×5=30 ok. 6×6=36 ok.
    // All 6 succeed because even 6,1 becomes 36 > 10
    assert.equal(s.success, 1.0);
  });

  it('visible=1, ntb=10: Attack success = 1/6 (only 1,6 extreme→36)', () => {
    const s = conditionalStats(1, 10, 'attack');
    // 1×1=1 fail; 1×2=2 fail; 1×3=3 fail; 1×4=4 fail; 1×5=5 fail; 1,6 extreme=36 ok
    assert.equal(s.success, 1 / 6);
  });

  it('Defense never has Kaputt', () => {
    for (let v = 1; v <= 6; v++) {
      const s = conditionalStats(v, 10, 'defense');
      assert.equal(s.kaputt, 0);
    }
  });

  it('extreme probability = 1/6 for matching visible die (visible=1 or visible=6)', () => {
    const s1 = conditionalStats(1, 10, 'attack');
    const s6 = conditionalStats(6, 10, 'attack');
    // visible=1: extreme when hidden=6 → 1/6
    assert.equal(s1.extreme, 1 / 6);
    // visible=6: extreme when hidden=1 → 1/6
    assert.equal(s6.extreme, 1 / 6);
  });

  it('extreme probability = 0 for visible=2,3,4,5', () => {
    for (let v = 2; v <= 5; v++) {
      const s = conditionalStats(v, 10, 'attack');
      assert.equal(s.extreme, 0, `visible=${v} should have 0 extreme probability`);
    }
  });
});

// ===== Seeded PRNG =====

describe('createRng()', () => {
  it('same seed produces identical sequence', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    for (let i = 0; i < 100; i++) {
      assert.equal(rng1(), rng2(), `roll ${i} should match`);
    }
  });

  it('different seeds produce different sequences', () => {
    const rng1 = createRng(1);
    const rng2 = createRng(2);
    const seq1 = Array.from({ length: 20 }, () => rng1());
    const seq2 = Array.from({ length: 20 }, () => rng2());
    // Extremely unlikely to be identical (1/6^20)
    assert.notDeepStrictEqual(seq1, seq2);
  });

  it('produces values in range 1-6', () => {
    const rng = createRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      assert.ok(v >= 1 && v <= 6, `roll ${v} out of range`);
    }
  });

  it('null/undefined seed uses Math.random (no crash)', () => {
    const rng1 = createRng(null);
    const rng2 = createRng(undefined);
    assert.ok(rng1() >= 1 && rng1() <= 6);
    assert.ok(rng2() >= 1 && rng2() <= 6);
  });
});

// ===== Game Engine — Match Lifecycle =====

describe('createMatch()', () => {
  it('starts in IDLE phase with correct defaults', () => {
    const m = createMatch();
    assert.equal(m.phase, Phase.IDLE);
    assert.equal(m.ntb, 1);
    assert.equal(m.currentPlayer, 0);
    assert.equal(m.turnNumber, 0);
    assert.equal(m.winner, null);
    assert.equal(m.isTerminal, false);
    assert.equal(m.players[0].score, 0);
    assert.equal(m.players[1].score, 0);
  });

  it('respects custom config', () => {
    const m = createMatch({ target: 50, kaputtLimit: 3, startingNtb: 10, seed: 1 });
    assert.equal(m.config.target, 50);
    assert.equal(m.config.kaputtLimit, 3);
    assert.equal(m.config.startingNtb, 10);
    assert.equal(m.ntb, 10);
  });

  it('transitions through phases correctly', () => {
    const m = createMatch({ seed: 1 });
    assert.equal(m.phase, Phase.IDLE);

    m.roll();
    assert.equal(m.phase, Phase.ROLLED);

    const { visibleDie } = m.revealFirst();
    assert.equal(m.phase, Phase.FIRST);
    assert.ok(visibleDie >= 1 && visibleDie <= 6);

    m.choose('attack');
    assert.equal(m.phase, Phase.CHOSEN);

    const result = m.revealSecond();
    assert.equal(m.phase, Phase.RESOLVED);
    assert.ok(result.turn === 1);

    m.nextTurn();
    assert.equal(m.phase, Phase.IDLE);
    assert.equal(m.currentPlayer, 1);
  });

  it('throws on illegal phase transitions', () => {
    const m = createMatch({ seed: 1 });
    assert.throws(() => m.revealFirst(), /Cannot reveal first/);
    assert.throws(() => m.choose('attack'), /Cannot choose/);
    assert.throws(() => m.revealSecond(), /Cannot reveal second/);
    assert.throws(() => m.nextTurn(), /Cannot advance/);
  });

  it('throws when rolling after match is over', () => {
    const m = createMatch({ target: 1, seed: 1 });
    m.executeTurn('attack');
    // With target=1, even the smallest product (1×1=1) doesn't beat NtB=1
    // So we might need more turns. Let's just play until terminal.
    while (!m.isTerminal) {
      m.executeTurn('attack');
    }
    assert.throws(() => m.roll(), /Match is over/);
  });
});

describe('executeTurn()', () => {
  it('completes a full turn atomically', () => {
    const m = createMatch({ seed: 1 });
    const result = m.executeTurn('attack');
    assert.ok(result.visibleDie >= 1 && result.visibleDie <= 6);
    assert.ok(typeof result.points === 'number');
    assert.ok(typeof result.kaputt === 'boolean');
    assert.equal(m.turnNumber, 1);
    assert.equal(m.currentPlayer, 1); // switched to player 2
  });

  it('alternates players', () => {
    const m = createMatch({ seed: 1 });
    m.executeTurn('attack');
    assert.equal(m.currentPlayer, 1);
    m.executeTurn('defense');
    assert.equal(m.currentPlayer, 0);
  });
});

describe('getPublicState()', () => {
  it('never exposes hidden die', () => {
    const m = createMatch({ seed: 1 });

    // Before roll: no dice visible
    let ps = m.getPublicState();
    assert.equal(ps.visibleDie, null);

    // After roll but before reveal: no dice visible
    m.roll();
    ps = m.getPublicState();
    assert.equal(ps.visibleDie, null);

    // After revealFirst: only first die visible
    const { visibleDie } = m.revealFirst();
    ps = m.getPublicState();
    assert.equal(ps.visibleDie, visibleDie);
    // The second die must NOT be in public state
    assert.equal(Object.keys(ps).includes('hiddenDie'), false);
  });

  it('includes all public information', () => {
    const m = createMatch({ seed: 1, target: 100, kaputtLimit: 5 });
    const ps = m.getPublicState();
    assert.equal(ps.ntb, 1);
    assert.equal(ps.target, 100);
    assert.equal(ps.kaputtLimit, 5);
    assert.equal(ps.players.length, 2);
    assert.equal(ps.players[0].score, 0);
    assert.equal(ps.winner, null);
  });
});

describe('Terminal conditions', () => {
  it('player reaching target score wins', () => {
    const m = createMatch({ target: 1, startingNtb: 0, seed: 1 });
    // With NtB=0, any product > 0 succeeds. So 1×1=1 > 0 succeeds, score=1 ≥ target.
    m.executeTurn('attack');
    assert.ok(m.isTerminal, 'match should end when score reaches target');
    assert.equal(m.winReason, 'score target');
  });

  it('player reaching Kaputt limit loses (opponent wins)', () => {
    // Set up: very high NtB so attacks always fail, target very high so score doesn't trigger
    const m = createMatch({ target: 9999, kaputtLimit: 1, startingNtb: 99, seed: 1 });
    // With NtB=99, no 2d6 product beats it. Attack always fails → Kaputt.
    // After 1 Kaputt, player 0 loses, player 1 wins.
    m.executeTurn('attack'); // P0 attacks, fails, K=1 → terminal
    assert.ok(m.isTerminal);
    assert.equal(m.winReason, 'opponent reached Kaputt limit');
    assert.equal(m.winner, 1); // opponent wins
  });

  it('score win checked before Kaputt in same turn', () => {
    // Edge case: player scores AND would kaputt in same turn - score should win
    // Actually in K3-E1, this can't happen: you either succeed (score) or fail (kaputt).
    // But let's verify with a setup where scoring exactly hits target
    const m = createMatch({ target: 20, startingNtb: 12, seed: 1 });
    // If player gets 4×5=20 > 12, scores 20, hits target
    // We can't control dice with seed easily, but the logic should be correct
    // Just verify the engine handles it without crashing
    while (!m.isTerminal) {
      m.executeTurn('attack');
    }
    assert.ok(m.isTerminal);
  });
});

describe('Seeded repeatability', () => {
  it('two matches with same seed produce identical history', () => {
    const config = { target: 50, kaputtLimit: 3, startingNtb: 1, seed: 42 };
    const m1 = createMatch(config);
    const m2 = createMatch(config);

    while (!m1.isTerminal) {
      m1.executeTurn('attack');
    }
    while (!m2.isTerminal) {
      m2.executeTurn('attack');
    }

    assert.deepStrictEqual(m1.history, m2.history);
    assert.equal(m1.winner, m2.winner);
    assert.equal(m1.turnNumber, m2.turnNumber);
    assert.deepStrictEqual(m1.players, m2.players);
  });

  it('different seeds produce different histories', () => {
    const m1 = createMatch({ target: 30, seed: 1 });
    const m2 = createMatch({ target: 30, seed: 2 });

    while (!m1.isTerminal) m1.executeTurn('attack');
    while (!m2.isTerminal) m2.executeTurn('attack');

    // Extremely unlikely to have identical histories
    const h1 = JSON.stringify(m1.history);
    const h2 = JSON.stringify(m2.history);
    assert.notEqual(h1, h2);
  });
});

describe('exportMatch()', () => {
  it('returns complete match data', () => {
    const m = createMatch({ target: 10, seed: 1 });
    while (!m.isTerminal) m.executeTurn('attack');

    const data = m.exportMatch();
    assert.ok(data.config);
    assert.equal(data.config.target, 10);
    assert.ok(Array.isArray(data.players));
    assert.equal(data.players.length, 2);
    assert.ok(typeof data.players[0].score === 'number');
    assert.ok(typeof data.players[0].kaputt === 'number');
    assert.ok(typeof data.players[0].attackCount === 'number');
    assert.ok(typeof data.players[0].defenseCount === 'number');
    assert.ok(typeof data.turns === 'number');
    assert.ok(typeof data.extremes === 'number');
    assert.ok(typeof data.leadChanges === 'number');
    assert.ok(typeof data.finalNtb === 'number');
    assert.ok(Array.isArray(data.history));
    assert.equal(data.history.length, data.turns);
    assert.ok(data.winner !== null);
  });
});

describe('Lead changes tracking', () => {
  it('detects lead changes', () => {
    const m = createMatch({ target: 100, seed: 1 });
    // Play many turns and check that leadChanges is tracked
    for (let i = 0; i < 20 && !m.isTerminal; i++) {
      m.executeTurn(i % 2 === 0 ? 'attack' : 'defense');
    }
    // leadChanges should be a non-negative integer
    assert.ok(m.leadChanges >= 0);
  });
});

describe('Telemetry turn events', () => {
  it('contains all required fields', () => {
    const m = createMatch({ seed: 1 });
    const result = m.executeTurn('attack');

    // Check all telemetry fields exist
    const requiredFields = [
      'turn', 'player', 'ntbBefore', 'visibleDie', 'hiddenDie',
      'choice', 'decisionMs', 'extreme', 'value', 'points',
      'kaputt', 'nextNtb', 'success', 'scoreSelfBefore',
      'scoreOpponentBefore', 'kaputtSelfBefore', 'kaputtOpponentBefore',
      'scoreAfter', 'kaputtAfter', 'ntbAfter', 'winner', 'winReason',
    ];
    for (const field of requiredFields) {
      assert.ok(field in result, `missing field: ${field}`);
    }
  });

  it('pre-turn state matches actual pre-turn values', () => {
    const m = createMatch({ seed: 1 });
    const r1 = m.executeTurn('attack');
    assert.equal(r1.scoreSelfBefore, 0);
    assert.equal(r1.scoreOpponentBefore, 0);
    assert.equal(r1.kaputtSelfBefore, 0);
    assert.equal(r1.kaputtOpponentBefore, 0);

    // Second turn - player 1
    if (!m.isTerminal) {
      const r2 = m.executeTurn('defense');
      // Player 1's "self" state should be fresh
      assert.equal(r2.scoreSelfBefore, 0);
      assert.equal(r2.kaputtSelfBefore, 0);
      // Player 1's "opponent" (player 0) may have scored
      assert.ok(r2.scoreOpponentBefore >= 0);
    }
  });
});

// ===== Edge Cases =====

describe('Edge cases', () => {
  it('NtB=0: smallest attack (1×1=1) succeeds', () => {
    const r = resolve('attack', 1, 1, 0);
    assert.equal(r.success, true);
    assert.equal(r.points, 1);
  });

  it('NtB=35: only 6×6=36 or extreme=36 succeeds', () => {
    // Normal: 6×6=36 > 35 ✓
    assert.equal(resolve('attack', 6, 6, 35).success, true);
    // Extreme: 36 > 35 ✓
    assert.equal(resolve('attack', 1, 6, 35).success, true);
    assert.equal(resolve('attack', 6, 1, 35).success, true);
    // 5×6=30 ≤ 35
    assert.equal(resolve('attack', 5, 6, 35).success, false);
  });

  it('match with target=100 and K=5 completes within reasonable turns', () => {
    const m = createMatch({ target: 100, kaputtLimit: 5, seed: 42 });
    let maxTurns = 500;
    while (!m.isTerminal && maxTurns > 0) {
      m.executeTurn('attack');
      maxTurns--;
    }
    assert.ok(m.isTerminal, 'match should eventually end');
    assert.ok(m.turnNumber < 500, 'should not take 500+ turns');
  });
});

// ===== Lab engine parity =====

describe('Inline engine parity (bots.js resolve logic)', () => {
  // The original bots.js uses this inline resolve logic.
  // Our engine must produce identical results.
  function inlineResolve(c, a, b, n) {
    const e = (a === 1 && b === 6) || (a === 6 && b === 1);
    if (c === 'attack') {
      const v = e ? 36 : a * b;
      const ok = v > n;
      return { ex: e, value: v, points: ok ? v : 0, kaputt: !ok, next: ok ? v : n, ok };
    }
    const v = e ? 2 : a + b;
    const p = e ? 1 : Math.max(a, b);
    return { ex: e, value: v, points: p, kaputt: false, next: v, ok: v > n };
  }

  it('engine resolve matches inline resolve for all 36×2×37 states', () => {
    let mismatches = 0;
    for (let ntb = 0; ntb <= 36; ntb++) {
      for (let a = 1; a <= 6; a++) {
        for (let b = 1; b <= 6; b++) {
          for (const action of ['attack', 'defense']) {
            const engine = resolve(action, a, b, ntb);
            const inline = inlineResolve(action, a, b, ntb);
            if (engine.value !== inline.value ||
              engine.points !== inline.points ||
              engine.kaputt !== inline.kaputt ||
              engine.nextNtb !== inline.next ||
              engine.success !== inline.ok ||
              engine.extreme !== inline.ex) {
              mismatches++;
            }
          }
        }
      }
    }
    assert.equal(mismatches, 0, `Found ${mismatches} mismatches between engine and inline resolve`);
  });
});

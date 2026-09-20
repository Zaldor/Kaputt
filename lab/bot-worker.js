// Keep expensive strategy search off the animation/input thread.
self.window = self;
importScripts('engine.js', 'bots.js');
self.onmessage = ({ data: { mode, state } }) => {
  try {
    const E = self.KaputtEngine;
    const resolve = (action, a, b, n) => {
      const r = E.resolve(action, a, b, n);
      return { ...r, ex: r.extreme, ok: r.success, next: r.nextNtb };
    };
    const stats = (a, n, action) => {
      const r = E.conditionalStats(a, n, action); return { ...r, next: r.nextNtb };
    };
    const a = state.visibleDie, n = state.ntb;
    const mine = state.players[state.currentPlayer], theirs = state.players[1 - state.currentPlayer];
    const bot = self.KaputtBots.get(mode);
    if (!bot) throw new Error('Unknown bot');
    const result = bot.choose({ a, n, A: stats(a, n, 'attack'), D: stats(a, n, 'defense'), p: { score: mine.score, k: mine.kaputt }, opp: { score: theirs.score, k: theirs.kaputt }, target: state.target, lim: state.kaputtLimit, resolve, stats });
    self.postMessage(result);
  } catch (error) { self.postMessage({ error: error.message }); }
};

-- Remote VS rooms + player leaderboard
-- Migration 0002

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  match_id TEXT,
  host_name TEXT NOT NULL,
  guest_name TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  ruleset TEXT NOT NULL DEFAULT 'K3-E1',
  target INTEGER NOT NULL DEFAULT 100,
  kaputt_limit INTEGER NOT NULL DEFAULT 5,
  starting_ntb INTEGER NOT NULL DEFAULT 1,
  current_state_json TEXT,
  last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
  name TEXT PRIMARY KEY,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  total_turns INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  matches_played INTEGER NOT NULL DEFAULT 0,
  last_played TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_last_updated ON rooms(last_updated);
CREATE INDEX IF NOT EXISTS idx_players_wins ON players(wins DESC);

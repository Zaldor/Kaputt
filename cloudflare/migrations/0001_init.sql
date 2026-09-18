PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind TEXT NOT NULL,
  ruleset TEXT NOT NULL,
  target INTEGER NOT NULL,
  kaputt_limit INTEGER NOT NULL,
  starting_ntb INTEGER NOT NULL,
  player_a TEXT,
  player_b TEXT,
  game_count INTEGER NOT NULL DEFAULT 1,
  seed TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  experiment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL,
  ruleset TEXT NOT NULL,
  target INTEGER NOT NULL,
  kaputt_limit INTEGER NOT NULL,
  starting_ntb INTEGER NOT NULL,
  player_a TEXT NOT NULL,
  player_b TEXT NOT NULL,
  winner TEXT,
  terminal_cause TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  score_a INTEGER NOT NULL DEFAULT 0,
  score_b INTEGER NOT NULL DEFAULT 0,
  kaputt_a INTEGER NOT NULL DEFAULT 0,
  kaputt_b INTEGER NOT NULL DEFAULT 0,
  lead_changes INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT,
  FOREIGN KEY(experiment_id) REFERENCES experiments(id)
);

CREATE TABLE IF NOT EXISTS turns (
  match_id TEXT NOT NULL,
  turn_no INTEGER NOT NULL,
  actor TEXT NOT NULL,
  score_self_before INTEGER,
  score_opp_before INTEGER,
  kaputt_self_before INTEGER,
  kaputt_opp_before INTEGER,
  ntb_before INTEGER NOT NULL,
  visible_die INTEGER NOT NULL,
  hidden_die INTEGER NOT NULL,
  choice TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  kaputt INTEGER NOT NULL DEFAULT 0,
  ntb_after INTEGER NOT NULL,
  extreme INTEGER NOT NULL DEFAULT 0,
  decision_ms REAL,
  strategic_hold INTEGER NOT NULL DEFAULT 0,
  bot_reason TEXT,
  PRIMARY KEY(match_id, turn_no),
  FOREIGN KEY(match_id) REFERENCES matches(id)
);

CREATE INDEX IF NOT EXISTS idx_matches_experiment ON matches(experiment_id);
CREATE INDEX IF NOT EXISTS idx_turns_ntb_choice ON turns(ntb_before, choice);
CREATE INDEX IF NOT EXISTS idx_turns_hold ON turns(strategic_hold);

-- Additive only: existing rooms, matches, turns and player records remain intact.
ALTER TABLE rooms ADD COLUMN protocol INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS room_seats (
  room_code TEXT NOT NULL REFERENCES rooms(code),
  player_index INTEGER NOT NULL CHECK(player_index IN (0,1)),
  token_hash TEXT NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(room_code,player_index)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_seat_token ON room_seats(token_hash);
CREATE TABLE IF NOT EXISTS room_actions (
  room_code TEXT NOT NULL REFERENCES rooms(code),
  request_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  player_index INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY(room_code,request_id)
);

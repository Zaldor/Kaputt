-- Add uuid column to players table for persistent player identity
ALTER TABLE players ADD COLUMN uuid TEXT;

-- Create index on uuid for fast lookups
CREATE INDEX IF NOT EXISTS idx_players_uuid ON players(uuid);

-- Make uuid unique (will be enforced after data migration)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_players_uuid_unique ON players(uuid);
-- Add uuid columns to rooms table for player identification
ALTER TABLE rooms ADD COLUMN host_uuid TEXT;
ALTER TABLE rooms ADD COLUMN guest_uuid TEXT;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_rooms_host_uuid ON rooms(host_uuid);
CREATE INDEX IF NOT EXISTS idx_rooms_guest_uuid ON rooms(guest_uuid);
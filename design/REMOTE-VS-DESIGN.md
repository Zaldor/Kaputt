# Kaputt! Remote VS Mode & Leaderboard — Design

## Remote VS Mode

### Flow
1. **Host creates match** → enters name → gets a 4-character room code (e.g. `K7PX`)
2. **Guest joins** → enters room code + their name → both see "Waiting for opponent..."
3. **Match starts** → turns alternate, each player acts on their own device
4. **State sync** via polling (every 1.5s) — no WebSocket needed for turn-based game
5. **Match ends** → result uploaded to D1 → both players see winner screen

### D1 Schema Additions

```sql
-- Active remote matches (lobby + in-progress)
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,              -- 4-char room code
  match_id TEXT,                      -- null until both players join
  host_name TEXT NOT NULL,
  guest_name TEXT,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | playing | finished
  ruleset TEXT NOT NULL DEFAULT 'K3-E1',
  target INTEGER NOT NULL DEFAULT 100,
  kaputt_limit INTEGER NOT NULL DEFAULT 5,
  starting_ntb INTEGER NOT NULL DEFAULT 1,
  current_state_json TEXT,            -- serialized match state for sync
  last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Player stats (derived from matches, cached for leaderboard)
CREATE TABLE IF NOT EXISTS players (
  name TEXT PRIMARY KEY,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  total_turns INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  matches_played INTEGER NOT NULL DEFAULT 0,
  last_played TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### API Endpoints

```
POST /api/rooms          -- Create room (host_name, target, kaputt_limit, starting_ntb)
                         -- Returns: { code, status }

GET  /api/rooms/:code    -- Join/poll room
                         -- Returns: { code, status, host_name, guest_name, state, ... }

POST /api/rooms/:code/join  -- Join as guest (guest_name)
                             -- Returns: { code, status, ... }

POST /api/rooms/:code/action -- Submit turn action (player_name, action: 'attack'|'defense')
                             -- Returns: { result, state, ... }

GET  /api/leaderboard    -- Top players by wins
                         -- Returns: [{ name, wins, losses, matches_played, ... }]
```

### State Sync Design

Each room stores a `current_state_json` blob with:
- Match phase, NtB, scores, Kaputt counts, turn number
- Whose turn it is (but NOT hidden dice)
- Last action result (for opponent to see)

Players poll `GET /api/rooms/:code` every 1.5s. When it's their turn, they submit via `POST /api/rooms/:code/action`.

The Worker validates: correct player acting, correct phase, legal action.

### Security (minimal, experimental)
- Room codes are 4-char alphanumeric (36^4 = 1.6M combinations)
- No authentication — player identity is just a name
- Rate limiting not needed yet (turn-based, low traffic)

## Leaderboard

### Data Source
Derived from the `matches` table. On each match completion:
1. Extract player names from `player_a`, `player_b`
2. Update `players` table: wins/losses/points/turns
3. Cache for fast leaderboard reads

### Display
- Table: Rank, Name, W/L, Win%, Matches, Avg Score
- Sortable by wins, win rate, matches played
- Filterable by time period (all-time, last 7 days)

## Implementation Priority

1. D1 schema migration for rooms + players tables
2. Worker endpoints for rooms (create, join, poll, action)
3. Worker endpoint for leaderboard
4. UI: Remote VS option in start screen
5. UI: Room creation/joining flow
6. UI: In-game polling and state sync
7. UI: Leaderboard page

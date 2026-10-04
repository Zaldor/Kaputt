# KAPUTT! User Journeys

This document maps every possible player interaction in KAPUTT! 3.0 (K3-E1 Extremes). The journeys are exhaustive — together they cover every screen, dialog, button, input, error state, and edge case reachable in the application.

**Legend:** `REQ-###` = requirement identifier. Every interaction is tagged so tests and QA can trace coverage.

---

## Journey Map (coverage index)

| # | Journey | Entry point | Primary goal |
|---|---------|-------------|--------------|
| J1 | First-visit onboarding | Cold load, no stored name | Create player identity |
| J2 | Returning-player start | Cold load, name exists | Choose game mode |
| J3 | Play Solo (vs bot) | Start screen → Play Solo | Complete a match against AI |
| J4 | Play Local (pass & play) | Start screen → Play Local | Complete a shared-device match |
| J5 | Play Online (create room) | Start screen → Play Online → Create | Host a remote match |
| J6 | Play Online (join room) | Start screen → Play Online → Join | Join a remote match via code |
| J7 | Play Online (invite link) | `?room=XXXX` URL | Join a remote match via URL |
| J8 | Core gameplay loop | Any active match | Roll, reveal, choose, resolve |
| J9 | Pass-device handoff | Local match, turn end | Transfer control to Player 2 |
| J10 | Match completion | Any match reaching terminal state | Win / loss resolution |
| J11 | New match (from menu) | Menu → New match | Restart or reconfigure |
| J12 | Leaderboard viewing | Header trophy / Start screen / Menu | View rankings and badges |
| J13 | Profile management | Header profile icon | View or change display name |
| J14 | How to play (rules) | Menu → How to play | Read game rules |
| J15 | Match lab (telemetry) | Menu → Match lab | Inspect match data live |
| J16 | Simulation lab | Menu → Simulation lab | Run probability simulations |
| J17 | Sound & motion settings | Menu → toggles | Personalise experience |
| L18 | LLM opponent setup | Setup dialog → LLM mode | Configure BYOK LLM bot |
| J19 | Export match JSON | Menu → Export | Download match record |
| J20 | Remote room management | Lobby dialog | Copy code, share, leave, resume |
| J21 | Connection recovery | Connection bar | Retry / reconnect remote |
| J22 | Match upload & persistence | Match end / Match lab | Save to D1, retry on failure |
| J23 | Error & edge states | Various | Handle failures gracefully |

---

## J1 — First-visit onboarding

**Entry:** Cold load. `localStorage.getItem('kaputt-player-name')` is `null` or `'You'`.

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | `#start-screen` visible | REQ-001 | Start screen fills viewport. Game content (header, scoreboard, play area) hidden via `[data-start="true"]` CSS. |
| 2 | Logo + tagline | REQ-002 | `kaputt-logo.webp` centred. Tagline reads "Roll. Reveal. Rival." |
| 3 | Name input `#start-name` | REQ-003 | Label "Choose your name". Placeholder "e.g. SwiftFox". `maxlength=16`. `autocomplete=off`. |
| 4 | Continue button `#name-continue` | REQ-004 | Trims whitespace. Empty input → no action. Max 16 chars. |
| 5 | Name persistence | REQ-005 | On submit, stores to `localStorage['kaputt-player-name']`. Shows mode step. |
| 6 | Mode buttons `#mode-step` | REQ-006 | Four buttons in 2×2 grid: Play Solo, Play Local, Play Online, Leaderboard. Each has icon + strong label + descriptive subtext. |
| 7 | "Change name" link `#change-name` | REQ-007 | Returns to name input step. Pre-fills current name. Focuses input. |
| 8 | Enter key on input | REQ-008 | Submits name (same as Continue click). `preventDefault` on keydown Enter. |

**Transition →** J2 (mode step) or J3/J4/J5/J12 (direct mode selection).

---

## J2 — Returning-player start

**Entry:** Cold load. Name exists in `localStorage` and is not `'You'`.

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | `#start-screen` visible | REQ-001 | Same as J1 step 1. |
| 2 | Welcome message | REQ-009 | Shows "Welcome back, **[name]**". Name from `getPlayerName()`. |
| 3 | Mode buttons | REQ-006 | Same as J1 step 6. Name input hidden (`#name-step` hidden). |
| 4 | "Change name" link | REQ-007 | Shows name input step. Same as J1 step 7. |
| 5 | Mode button click | REQ-010 | `hideStartScreen()` → sets `data-start="false"`. Game content becomes visible. Mode-specific flow begins. |

---

## J3 — Play Solo (vs bot)

**Entry:** Start screen → "Play Solo" button (`data-mode="random"`).

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Start button | REQ-010 | Hides start screen. Calls `startMatch({...setup, mode:'random'})`. |
| 2 | Game screen | REQ-011 | Header visible. Opponent shows "COINFLIP" (bot label from `<option>` text). Player name from localStorage. Scores 0/100. |
| 3 | Bot selection (advanced) | REQ-012 | Default bot is `random` (Coinflip). Advanced bot selection via Menu → New match → Opponent dropdown. Options: Coinflip, Berserker, Guardian, Calculator, Tactician, Oracle, Sage, Grandmaster, LLM Naive, LLM Informed. |
| 4 | Bot turns | REQ-013 | Bot plays automatically. `isBotTurn()` returns true. UI shows "bot thinking" state. Bot reason shown in Match Lab. |
| 5 | LLM bots | REQ-014 | LLM modes (`llm_naive`, `llm_informed`) require API key setup. See J18. |

**Transition →** J8 (gameplay) → J10 (completion).

---

## J4 — Play Local (pass & play)

**Entry:** Start screen → "Play Local" button (`data-mode="human"`).

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Start button | REQ-010 | Hides start screen. Calls `startMatch({...setup, mode:'human'})`. |
| 2 | Game screen | REQ-011 | Opponent shows "PLAYER 2" (or custom name from setup). Both players share one device. |
| 3 | Turn alternation | REQ-015 | After each turn, pass-device dialog appears. See J9. |
| 4 | Player 2 name | REQ-016 | Default "Player 2". Customisable via Menu → New match → "Player 2 name" field. |

**Transition →** J8 → J9 → J8 → J10.

---

## J5 — Play Online (create room)

**Entry:** Start screen → "Play Online" → setup dialog opens with `#remote-settings` visible.

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | "Play Online" button | REQ-017 | Hides start screen. Shows setup dialog with `mode='remote'`, `#remote-settings` visible, `#start-local` hidden, `#setup-note` hidden. |
| 2 | "Create a room" `#create-room` | REQ-018 | Creates remote room via `roomEntry('create')`. Shows lobby dialog with 4-char room code. |
| 3 | Lobby dialog `#lobby-dialog` | REQ-019 | Shows room code in large monospace. "Copy code" and "Share invite" buttons. Status "Waiting for a friend…". Rules summary. |
| 4 | Copy code `#copy-room` | REQ-020 | Copies room code to clipboard. Shows "Room code copied." on success. |
| 5 | Share invite `#share-room` | REQ-021 | Uses Web Share API if available. Falls back to copying invite URL (`?room=XXXX`). |
| 6 | Friend joins | REQ-022 | Lobby updates. Both players enter game. First player randomly assigned. |
| 7 | Leave room `#leave-room` | REQ-023 | Opens leave confirmation dialog. See J20. |

**Transition →** J8 (gameplay) → J10.

---

## J6 — Play Online (join room)

**Entry:** Start screen → "Play Online" → enter code → Join.

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Room code input `#join-code` | REQ-024 | 4-char max. Auto-uppercased. `pattern=[A-Z0-9]`. `spellcheck=false`. |
| 2 | "Join" button `#join-room-btn` | REQ-025 | Calls `roomEntry('join')`. Validates code. Joins room if exists and has capacity. |
| 3 | Invalid code | REQ-026 | Shows error in `#room-status`. Input remains editable. |
| 4 | Room full / closed | REQ-027 | Shows appropriate error message. |
| 5 | Successful join | REQ-028 | Closes setup dialog. Enters game. Assigned seat index. |

**Transition →** J8 → J10.

---

## J7 — Play Online (invite link)

**Entry:** URL contains `?room=XXXX` (4-char code).

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | URL parsing | REQ-029 | On load, `URLSearchParams` extracts `room` param. Regex `/^[A-Z0-9]{4}$/i` validates. |
| 2 | Auto-fill | REQ-030 | Pre-fills `#join-code` with uppercase code. Sets `#mode` to `remote`. Calls `modeChanged()`. |
| 3 | Start screen bypass | REQ-031 | Start screen NOT shown. `hideStartScreen()` called. Setup dialog NOT shown. |
| 4 | Join flow | REQ-032 | Same as J6 from step 2. |

**Transition →** J6 steps 2-5 → J8 → J10.

---

## J8 — Core gameplay loop

**Entry:** Any active match (J3, J4, J5/J6/J7).

| Step | Phase | Requirement | Expected behaviour |
|------|-------|-------------|-------------------|
| 1 | **Idle** — "ROLL THE DICE" | REQ-033 | `#primary-action` enabled. Label "ROLL THE DICE". Both dice show `?`. `#turn-title` = "READY TO ROLL?" |
| 2 | Roll | REQ-034 | Click `#primary-action` or keyboard. Both dice tumble (3D animation). Values hidden. Sound effect (roll). `busy=true` during animation. |
| 3 | **Rolled** — choose die to reveal | REQ-035 | Both dice clickable (`#die-left`, `#die-right`). `#turn-title` = "Both dice are hidden. Choose either die to reveal." Die cue "REVEAL" visible. |
| 4 | First reveal | REQ-036 | Click either die. Reveals first die value. Physical dice never rerolled. `revealFirst(0)` (left) or `revealFirst(1)` (right). |
| 5 | **Chosen** — choose Attack or Defense | REQ-037 | `#attack` and `#defense` buttons visible. `#choice-explanations` visible. Attack = multiply. Defense = add (score higher die). Choice is locked once made. |
| 6 | Attack chosen | REQ-038 | Calls `match.choose('attack')`. Result = product. Must strictly exceed NtB. Success → score + new NtB. Fail → Kaputt. |
| 7 | Defense chosen | REQ-039 | Calls `match.choose('defense')`. Score = higher die. New NtB = sum. Never Kaputt. |
| 8 | Extreme (1+6 / 6+1) | REQ-040 | Attack → 36. Defense → target 2, score 1. Event popup "EXTREME". Special sound. |
| 9 | Second reveal | REQ-041 | Auto-reveals after choice. Shows outcome in `#outcome-detail`. Points, Kaputt, new NtB shown. |
| 10 | **Resolved** — turn end | REQ-042 | `#primary-action` label "NEXT TURN" or terminal. Score updated. Kaputt dots updated. |
| 11 | Next turn | REQ-043 | Click `#primary-action`. Advances to next player. Resets dice to hidden. |
| 12 | Choice explanations | REQ-044 | `#choice-explanations` shows: "Multiply the dice. Result must be greater than [NtB] or it's a Kaputt!" / "Score the higher die. New target becomes the sum of the dice." |
| 13 | Event popups | REQ-045 | `#event-popup` shows: "KAPUTT!" (red), "EXTREME" (orange), "SUCCESS" (green), "WIN" (yellow), "LOSS" (lavender). Auto-dismiss after animation. |
| 14 | Keyboard accessibility | REQ-046 | Tab to dice. Enter/Space activates. Focus outlines visible (`outline: 3px solid #e75412`). |
| 15 | Reduced motion | REQ-047 | `prefers-reduced-motion` → no animations. `data-motion="off"` → no animations. Toggle in menu. |
| 16 | Sound effects | REQ-048 | Roll (5 tones), Kaputt (2 tones), Win (4 tones), Success (2 tones), default click. Toggleable. |
| 17 | Bot turns (solo) | REQ-049 | Bot thinks (delay). Shows reason in Match Lab. Auto-plays. `botThinking=true`. |
| 18 | Remote turns | REQ-050 | Only current player can act. Polling for opponent moves. Turn number guard prevents stale resets. |

---

## J9 — Pass-device handoff (local match)

**Entry:** Local match, turn resolved, next player is human.

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Pass dialog `#pass-dialog` | REQ-051 | Appears after each turn in local mode. Shows "[Player name], you're up." |
| 2 | Dice cleared | REQ-052 | Previous roll hidden before handoff. No information leakage between players. |
| 3 | "I'M READY" `#ready` | REQ-053 | Closes dialog. Enables dice interaction. `passing=false`. |
| 4 | Dialog cancel prevention | REQ-054 | `cancel` event prevented on `#pass-dialog`. Must click button to dismiss. |
| 5 | Skip in remote mode | REQ-055 | Pass dialog NOT shown in remote mode. Auto-advance. |

---

## J10 — Match completion

**Entry:** Match reaches terminal state (score ≥ target OR opponent Kaputts ≥ limit).

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Terminal state | REQ-056 | `match.isTerminal = true`. `data-terminal="true"` on game shell. |
| 2 | Winner announcement | REQ-057 | `#turn-title` = "WINNER!" or "GOOD GAME". `#turn-detail` shows result. |
| 3 | Celebration | REQ-058 | `#celebration` shows confetti/glow particles. Animated. |
| 4 | Win sound | REQ-059 | 4-tone ascending sequence on win. |
| 5 | Score final | REQ-060 | Final scores displayed. Kaputt dots show final state. |
| 6 | "ROLL THE DICE" → "NEW MATCH" | REQ-061 | Button label changes. Click → `startMatch()` with current settings. |
| 7 | Match uploaded | REQ-062 | Match queued to D1 via `queueMatch()`. Uploaded automatically. Retry on failure. See J22. |
| 8 | Leaderboard update | REQ-063 | Completed match appears in leaderboard (after D1 write). |
| 9 | Remote terminal | REQ-064 | In remote mode, terminal state synced via `lastResult.winner`. Both players see result. |

---

## J11 — New match (from menu)

**Entry:** Menu → "New match".

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | New match button `#open-setup` | REQ-065 | Calls `newMatch()`. If remote active → leave confirmation dialog first. |
| 2 | Start screen return | REQ-066 | Shows `#start-screen` (not setup dialog). Player picks mode again. |
| 3 | Remote active guard | REQ-067 | If `remote.active && !connection.fatal && room.status!=='closed'` → shows `#leave-dialog` first. |
| 4 | Remote detach | REQ-068 | On confirm, detaches remote. Resets to `mode:'human'`. Creates new match. |

**Note:** Advanced setup (custom target, Kaputt limit, starting NtB, bot selection) is available via the setup dialog which opens when choosing "Play Online" from the start screen, or when selecting a specific bot mode.

---

## J12 — Leaderboard viewing

**Entry:** Header trophy icon, Start screen "Leaderboard" button, or Menu → Leaderboard.

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Header trophy `#open-leaderboard` | REQ-069 | Opens `#leaderboard-dialog` (in-app modal, NOT page navigation). Calls `loadLeaderboard()`. |
| 2 | Start screen button `#start-leaderboard` | REQ-070 | Same as step 1. |
| 3 | Menu link `#open-leaderboard-menu` | REQ-071 | Same as step 1. |
| 4 | Period tabs | REQ-072 | Four buttons: All time, Month, Week, Today. `aria-pressed` on active tab. Filters via `period` query param. |
| 5 | Rankings list `#lb-ranking` | REQ-073 | Shows rank number, name, wins, win rate, losses, matches, avg turns, best score. Ordered by wins DESC, win_rate DESC, name. Limit 50. |
| 6 | Badge grid `#lb-badges` | REQ-074 | Shows badges: Speed Demon, Berserker, Iron Wall, Extreme Master, Kaputt Magnet, Hold Champion, Marathon Runner, High Scorer, Veteran, Undefeated. Each shows player name + metric value. |
| 7 | Loading state | REQ-075 | "Loading standings…" / "Loading badges…" shown while fetching. |
| 8 | Empty state | REQ-076 | "No finished matches in this period. Play a round to get on the board." |
| 9 | Error state | REQ-077 | "Standings couldn't load." / "Badges couldn't load." Non-fatal. |
| 10 | Close button | REQ-078 | `#icon-button` with `data-close="leaderboard-dialog"`. Closes modal. |
| 11 | UUID-only players | REQ-079 | Only players with UUID identity shown. Legacy name-only records excluded. |
| 12 | Period definitions | REQ-080 | All = no filter. Today = `date('now','start of day')`. Week = `date('now','-6 days','weekday 1')`. Month = `date('now','start of month')`. UTC. |

---

## J13 — Profile management

**Entry:** Header profile icon.

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Profile icon `#open-profile` | REQ-081 | Opens `#profile-dialog`. Pre-fills `#profile-name` with current name. |
| 2 | Name input `#profile-name` | REQ-082 | Max 16 chars. Current name shown. |
| 3 | Save button `#save-profile` | REQ-083 | Trims. Empty → no action. Saves to `localStorage`. Updates `setup.playerName`. Shows "Name saved as [name]". |
| 4 | Name scope | REQ-084 | Name used in: leaderboard, remote matches, match exports. Stored locally only. |
| 5 | Close button | REQ-085 | `data-close="profile-dialog"`. Closes modal. |

---

## J14 — How to play (rules)

**Entry:** Menu → "How to play".

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Rules button `#open-rules` | REQ-086 | Opens `#rules-dialog`. |
| 2 | Rules content | REQ-087 | 4-step list: Roll, Tap either die, Choose Attack or Defense, Reveal other die. |
| 3 | Attack explanation | REQ-088 | "Multiply the dice. Result must be strictly greater than NtB. Score result, set as new target. Otherwise, Kaputt; target stays." |
| 4 | Defense explanation | REQ-089 | "Score the higher die, set target to sum, take no Kaputt." |
| 5 | Extreme explanation | REQ-090 | "Attack becomes 36. Defense sets target to 2 and scores 1. An Attack of 36 still fails against target 36. Doubles are normal." |
| 6 | Win condition | REQ-091 | "Reach score target, or opponent reaches Kaputt limit. Default: first to 100, five Kaputts." |
| 7 | Close button | REQ-092 | `data-close="rules-dialog"`. |

---

## J15 — Match lab (telemetry)

**Entry:** Menu → "Match lab".

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Lab button `#open-lab` | REQ-093 | Opens `#lab-dialog` (wide sheet). Calls `renderLab()`. |
| 2 | Telemetry `#telemetry` | REQ-094 | Shows match state: scores, NtB, Kaputts, turn count. |
| 3 | Decision matrix `#matrix` | REQ-095 | Conditional probability table: Attack vs Defense metrics. |
| 4 | Bot reasoning `#botwhy` | REQ-096 | Shows bot's reasoning (if bot match). "Why did the bot do that?" |
| 5 | Event log `#log` | REQ-097 | Chronological list of match events. Monospace. Scrollable. |
| 6 | Retry upload `#retry-upload` | REQ-098 | Visible only if `pendingMatches() > 0`. Retries failed uploads. |
| 7 | Upload status `#upload-status` | REQ-099 | Shows upload state. "Saved." / "Saving…" / error message. |
| 8 | Close button | REQ-100 | `data-close="lab-dialog"`. |

---

## J16 — Simulation lab

**Entry:** Menu → "Simulation lab" (link to `sim.html`).

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Sim link | REQ-101 | Navigates to `sim.html`. Separate page (not dialog). |
| 2 | Simulation controls | REQ-102 | Configure: bot matchups, number of games, ruleset parameters. |
| 3 | Results display | REQ-103 | Win rates, score distributions, turn counts. Charts/tables. |
| 4 | Back navigation | REQ-104 | Return to `index.html`. |

---

## J17 — Sound & motion settings

**Entry:** Menu → toggle buttons.

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Sound toggle `#toggle-sound` | REQ-105 | Toggles `sound` boolean. Persists to `localStorage['kaputt-sound']`. Label: "Sound on" / "Sound off". `aria-pressed`. |
| 2 | Motion toggle `#toggle-motion` | REQ-106 | Toggles `motionEnabled()`. Sets `data-motion="off"` on `<html>`. Label: "Animations on" / "Animations off". |
| 3 | Reduced motion respect | REQ-107 | `prefers-reduced-motion: reduce` disables animations regardless of toggle. |
| 4 | Sound implementation | REQ-108 | Web Audio API oscillators. No audio files. Tones: roll (5× triangle), kaputt (2× sine), win (4× sine), success (2× sine), click (1× triangle). |
| 5 | Sound state scope | REQ-109 | Per-browser (localStorage). Not synced across devices. |

---

## J18 — LLM opponent setup

**Entry:** Setup dialog → Opponent = "LLM Naive" or "LLM Informed".

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | LLM mode selected | REQ-110 | `#llmsettings` becomes visible. `#match-options` stays visible. |
| 2 | Provider select `#llmprovider` | REQ-111 | Lists supported providers. Change → refreshes model list. |
| 3 | Model select `#llmmodel` | REQ-112 | Lists models for selected provider. Change → calls `LLM.setModel()`. |
| 4 | Temperature `#llmtemp` | REQ-113 | Number input 0-2, step 0.1. Default 0.3. Change → calls `LLM.setTemperature()`. |
| 5 | API key input `#llmkey` | REQ-114 | Password field. `autocomplete=off`. Placeholder "Enter a provider key". |
| 6 | Save key `#llmsave` | REQ-115 | Saves to `LLM.setApiKey()`. Clears input. Refreshes models. |
| 7 | Remove keys `#llmclear` | REQ-116 | Calls `LLM.clearAllKeys()`. Clears input. Refreshes models. |
| 8 | Key privacy note | REQ-117 | "Keys stay in this browser and are never saved with matches." |
| 9 | LLM bot turns | REQ-118 | LLM receives only public state (no hidden die). Reasoning shown in Match Lab. |

---

## J19 — Export match JSON

**Entry:** Menu → "Export match JSON".

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Export button `#export` | REQ-119 | Calls `exportJson(payload())`. Generates JSON blob. |
| 2 | Download | REQ-120 | Triggers download as `kaputt-k3e1-vs.json`. |
| 3 | Payload contents | REQ-121 | Match ID, settings, players, full turn history, scores, Kaputts, winner. NO credentials/API keys. |
| 4 | Legacy export `#export-legacy` | REQ-122 | In remote mode, exports previous room history as `kaputt-previous-room.json`. |
| 5 | Local fallback | REQ-123 | When not on workers.dev, export is the only persistence (no D1 upload). |

---

## J20 — Remote room management

**Entry:** Lobby dialog (`#lobby-dialog`).

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Room code display `#lobby-code` | REQ-124 | Large monospace 4-char code. `letter-spacing:.14em`. |
| 2 | Copy code `#copy-room` | REQ-020 | Copies to clipboard. Success: "Room code copied." Fallback: "Share this code: [code]". |
| 3 | Share invite `#share-room` | REQ-021 | Web Share API. Fallback: copy invite URL (`?room=XXXX`). AbortError silently ignored. |
| 4 | Status `#lobby-status` | REQ-125 | "Waiting for a friend…" → "Connected" or error. |
| 5 | Rules display `#lobby-rules` | REQ-126 | Shows match rules (target, Kaputt limit, starting NtB). |
| 6 | Leave room `#leave-room` | REQ-023 | Opens `#leave-dialog` confirmation. |
| 7 | Leave confirmation `#confirm-leave` | REQ-127 | "Your opponent will see that you left. Recorded turns stay saved." Confirm → `remote.send('leave')`. Success → `startMatch({...setup, mode:'human'})`. |
| 8 | Leave error | REQ-128 | "Wait for the pending move, then retry." Shown in `#leave-status`. |
| 9 | Keep playing `#leave-dialog` | REQ-129 | `data-close="leave-dialog"`. Closes confirmation. No state change. |
| 10 | Resume room `#resume-room` | REQ-130 | Visible if `remote.saved` exists. Calls `remote.resume()`. Status "Resuming your room…". |
| 11 | Online link `#online-link` | REQ-131 | Link to `https://kaputt-lab.crafthead.workers.dev/`. Hidden when already on workers.dev. |
| 12 | Close lobby `#lobby-dialog` | REQ-132 | `data-close="lobby-dialog"`. Closes modal. Room stays active. |

---

## J21 — Connection recovery

**Entry:** Remote mode, connection lost or degraded.

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Connection bar `#connection-bar` | REQ-133 | Visible in remote mode. `role="status"`. Shows connection state. |
| 2 | Connected state | REQ-134 | `data-connected="true"`. Green/neutral. "Connected". |
| 3 | Disconnected state | REQ-135 | `data-connected="false"`. Orange warning. Shows error message. |
| 4 | Retry button `#retry-connection` | REQ-136 | Calls `remote.retry()`. Visible when disconnected. |
| 5 | Reconnection | REQ-137 | Auto-reconnect attempts. Room state preserved. Turn number guard prevents stale resets. |
| 6 | Fatal connection | REQ-138 | `connection.fatal=true`. Blocks further actions. Forces new match flow. |
| 7 | Pending action `#pending` | REQ-139 | Action queued but not acknowledged. Blocks further actions until resolved. |
| 8 | Sending state `#sending` | REQ-140 | Action in-flight. Blocks further actions until response. |
| 9 | Polling | REQ-141 | Client polls for opponent moves. Turn number guard (`4570a0a`) prevents stale poll resets. |
| 10 | Reconnect preservation | REQ-142 | UI state (dice, scores, NtB) preserved on reconnect. Room status synced. |

---

## J22 — Match upload & persistence

**Entry:** Match end (auto) or Match lab → Retry.

| Step | Screen / element | Requirement | Expected behaviour |
|------|-----------------|-------------|-------------------|
| 1 | Auto-upload | REQ-062 | Completed match queued via `queueMatch()`. Uploaded to `/api/matches`. |
| 2 | Queue persistence | REQ-143 | Queue survives page reload. `flushMatches()` retries on load. |
| 3 | Upload success | REQ-144 | Status "Saved." Match appears in leaderboard. |
| 4 | Upload failure | REQ-145 | Status shows error. `#retry-upload` visible in Match Lab. |
| 5 | Retry button `#retry-upload` | REQ-098 | Calls `retryUploads()` → `flushMatches()`. |
| 6 | Offline queue | REQ-146 | `online` event listener triggers `retryUploads()`. Queued matches upload when connectivity returns. |
| 7 | GitHub Pages / local | REQ-123 | No D1 upload. Export JSON is the only persistence. `#online-link` provides path to deployed version. |
| 8 | D1 schema | REQ-147 | Match: id, experiment_id, source, ruleset, target, kaputt_limit, starting_ntb, player_a, player_b, winner, terminal_cause, turns, score_a, score_b, kaputt_a, kaputt_b, lead_changes, payload_json. Turns: per-turn detail with decision_ms, strategic_hold, bot_reason. |

---

## J23 — Error & edge states

**Entry:** Various. This journey maps all error paths.

| Step | Error scenario | Requirement | Expected behaviour |
|------|---------------|-------------|-------------------|
| 1 | 3D dice unavailable | REQ-148 | `dice-renderer-lost` event. Falls back to accessible dice (`?` buttons). Announcement: "3D rendering is unavailable." |
| 2 | WebGL not available | REQ-149 | Canvas2D software renderer used. Same 3D geometry, no GPU. |
| 3 | Both renderers fail | REQ-150 | Accessible fallback dice (`?` buttons) remain functional. |
| 4 | localStorage unavailable | REQ-151 | Name generation runs but not persisted. `try/catch` on all storage access. |
| 5 | API 503 / D1 down | REQ-077 | Leaderboard shows "couldn't load." Non-fatal. Game playable. |
| 6 | Match upload failure | REQ-145 | Queued for retry. `#retry-upload` visible. |
| 7 | Remote room expired | REQ-027 | Error message in `#room-status`. Room code input remains editable. |
| 8 | Remote room full | REQ-027 | Error message. User can try another code. |
| 9 | Remote disconnect mid-game | REQ-137 | Connection bar shows warning. Auto-reconnect. Retry button. |
| 10 | Remote fatal disconnect | REQ-138 | Forces new match flow. Recorded turns preserved. |
| 11 | LLM API key invalid | REQ-152 | Error in `#llmstatus`. Match not started. |
| 12 | LLM timeout | REQ-153 | Bot falls back to random or shows error. |
| 13 | Clipboard unavailable | REQ-020 | Fallback text shown: "Share this code: [code]". |
| 14 | Web Share unavailable | REQ-021 | Fallback: copy invite URL to clipboard. |
| 15 | Audio context suspended | REQ-154 | `audioContext.resume()` called on first user interaction. |
| 16 | Rapid clicking / double-action | REQ-155 | `busy` flag prevents double-rolls. `connection.sending` prevents double-sends. |
| 17 | Browser back/forward | REQ-156 | No SPA routing. `?room=` URL preserved. Game state in memory. |
| 18 | Page reload during match | REQ-157 | Local match: state lost (in-memory only). Remote: state preserved (server-side). Resume via `remote.saved`. |
| 19 | Small viewport (<360px) | REQ-158 | Responsive CSS kicks in. Header min-height 62px. Font sizes reduce. |
| 20 | Large viewport (≥600px) | REQ-159 | `box-shadow` on game shell. Sheet border-radius increases. |
| 21 | Tall viewport (≥741px) | REQ-160 | Actions zone padding increases. Choice explanations get more space. |
| 22 | Short viewport (≤630px) | REQ-161 | Compact layout. Target stage shrinks. Choice explanations hidden. Connection bar shrinks header. |
| 23 | Reduced motion | REQ-047 | All animations disabled. Transitions disabled. |
| 24 | Reduced contrast | REQ-162 | System-level `prefers-contrast` respected via browser. |
| 25 | Dark mode | REQ-163 | App is light-themed. `theme-color` = `#11265d`. No dark mode support (accepted debt). |

---

## Cross-cutting requirements

| Requirement | Scope | Description |
|-------------|-------|-------------|
| REQ-164 | Identity | UUID-based player identity. Per-tab via `sessionStorage`. Distinguishes same-name players. |
| REQ-165 | Privacy | API keys never in match exports, uploads, or logs. Keys in localStorage only. |
| REQ-166 | Accessibility | ARIA labels on all interactive elements. `aria-live="polite"` for announcements. Focus outlines visible. Keyboard navigable. |
| REQ-167 | Responsive | Container queries (`cqw`) for game UI. Breakpoints: 360px, 600px, 740px, 741px. |
| REQ-168 | Self-hosted | All fonts, icons, 3D renderer bundled. No CDN. No external dependencies at runtime. |
| REQ-169 | Performance | 3D dice capped at 2× DPR. `prefers-reduced-motion` respected. Idle rendering stops. |
| REQ-170 | Offline | Match export works offline. Match queue persists offline. Remote mode requires connection. |
| REQ-171 | Extremes rule | 1+6 / 6+1 polarises action. Attack → 36. Defense → target 2, score 1. Attack 36 fails vs target 36. |
| REQ-172 | Scoring | Attack = product, must strictly exceed NtB. Defense = higher die, NtB = sum. Kaputt on failed attack. |
| REQ-173 | Win conditions | Score ≥ target (default 100) OR opponent Kaputts ≥ limit (default 5). |
| REQ-174 | Server-authoritative (remote) | Remote rolls/scoring server-owned. Actions authenticated. Versioned turns. CAS receipts. |

---

## Interaction completeness matrix

| Surface | J1 | J2 | J3 | J4 | J5 | J6 | J7 | J8 | J9 | J10 | J11 | J12 | J13 | J14 | J15 | J16 | J17 | J18 | J19 | J20 | J21 | J22 | J23 |
|---------|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|
| Start screen | ✓ | ✓ | | | | | | | | | | ✓ | | | | | | | | | | | |
| Game header | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | | | | | |
| Dice area | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | | | | | | | | | | | | | ✓ |
| Action buttons | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | | | | | | | | | | | | | ✓ |
| Scoreboard | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | | | | | | | | |
| Setup dialog | | | | | ✓ | ✓ | ✓ | | | | ✓ | | | | | | | ✓ | | | | | |
| Lobby dialog | | | | | ✓ | ✓ | | | | | | | | | | | | | | ✓ | ✓ | | |
| Pass dialog | | | | ✓ | | | | | ✓ | | | | | | | | | | | | | | |
| Leaderboard | | | | | | | | | | | | ✓ | | | | | | | | | | | ✓ |
| Profile | | | | | | | | | | | | | ✓ | | | | | | | | | | |
| Rules | | | | | | | | | | | | | | ✓ | | | | | | | | | |
| Match lab | | | | | | | | | | | | | | | ✓ | | | | | | | ✓ | |
| Sim lab | | | | | | | | | | | | | | | | ✓ | | | | | | | |
| Menu | | | | | | | | | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | | | | |
| Connection bar | | | | | ✓ | ✓ | ✓ | ✓ | | | | | | | | | | | | ✓ | ✓ | | |
| Leave dialog | | | | | ✓ | ✓ | | | | | | | | | | | | | | ✓ | | | |
| Celebration | | | | | | | | | | ✓ | | | | | | | | | | | | | |
| Event popups | | | | | | | | ✓ | | ✓ | | | | | | | | | | | | | |

**Total: 23 journeys, 174 requirements.** Every screen, dialog, button, input, toggle, error state, and edge case is mapped to at least one journey with a requirement ID.

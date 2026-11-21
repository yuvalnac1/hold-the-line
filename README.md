# Hold the Line

1-vs-1 undead-vs-military tower-defence battle for desktop Chrome, built from `Hold the Line — PRD.pdf`.
Three.js 3D renderer (procedural stylised models, soft shadows, bloom), synthesized Web Audio, no external assets.

## Run
```bash
npm install
npm run dev        # http://localhost:5173
```
`npm run build` makes a static build in `dist/`. `npm run balance` plays 60 headless AI-vs-AI matches and reports
how many end with a bunker destroyed between 3:00 and 4:30 (PRD balance target ≥ 80%).

## Where things live
- `src/config.js` – every PRD value (the dev menu edits this live; Export copies it as JSON to paste back here)
- `src/sim.js` – game rules (pure JS, also runs in Node) · `src/ai.js` – computer opponent
- `src/arena.js` – lanes, gates, build spots · `src/progress.js` – XP/unlocks in localStorage
- `src/render/` – scene, models, effects, card portraits · `src/ui.js`, `src/devmenu.js`, `src/audio.js`

Dev menu: gear icon, bottom-right.

Interpretation note: each undead's "income boost" (+1 … +10) is paid at 32% per 2-second income tick
(`global.ecoPerTick`), because paying it in full every tick made eco snowball far too fast.

## OpenRouter (offline dev tools only)

`tools/openrouter.mjs` wraps the official `@openrouter/sdk` for build-time scripts (asset/voice generation). It is never imported by `src/`, so the key never reaches the browser.

1. Create a key at https://openrouter.ai/keys
2. Add it to `.env.local` (gitignored): `OPENROUTER_API_KEY=sk-or-...`
3. `npm run ai:test` sends one example request (a Final Wave announcer line).

Change the model with `OPENROUTER_MODEL=<slug> npm run ai:test` (slugs: https://openrouter.ai/models). Other scripts can `import { ask } from './openrouter.mjs'`.

### Generated assets (`npm run assets`)

`tools/gen-assets.mjs` makes card art (23), menu key art and 7 announcer lines into `public/assets/` plus a `manifest.json`; the game loads them through `src/assets.js` and falls back to its rendered 3D portraits if anything is missing. Full-size image originals are kept in `.data/asset-src/` (gitignored); the game gets ~100 KB JPEGs (resized with macOS `sips`).

- Existing files are skipped; `--force` regenerates, `--only=<id>` does one asset, `--kind=cards|art|voice`, `--jobs=N` runs in parallel.
- Images: `openai/gpt-image-2.6-flare` (~$0.045 each). Voices: `elevenlabs/eleven-v3`, voice `george`. Override with `IMAGE_MODEL`, `VOICE_MODEL`, `VOICE`.
- All art is now from the GPT Image model, so the style is consistent. The earlier cheaper Seedream versions of 14 images are kept in `.data/seedream-backup/` (gitignored). `--only` takes a comma list, e.g. `--only=tank,samurai`.

## Progression, arenas and modes (v2)

- **Flow:** title → home (deck, arena picker, difficulty, Battle, Shop, Profile, How to play) → battle → results.
- **First launch:** a guided tutorial (6 short steps, under a minute) with no CPU or waves, then the real battle. Replay it from **How to play**.
- **Deck:** 4 attack cards (undead/sabotage) + 4 defence cards, shown as two separate rows in the deck and in the battle card bar.
- **Coins:** earned after every battle (win 100 / loss 40, + 1.5 per bunker damage, + 0.4 per kill). Spent in the **Shop** on new cards, card levels (1–5: undead +10% health, defenders +8% damage per level) and **bunker levels** (+15 health per level; a roof turret from level 3).
- **Arenas:** Haunted Fields, Frozen Front (rank 3), Dune Outpost (rank 5), Harbour Siege (rank 7), Ember Peaks (rank 9). Each has its own lanes and unbuildable water/ice/lava pools (`src/arena.js` → `ARENAS`) and its own look (`src/render/scene.js` → `THEMES`).
- **Automatic waves:** grey-ringed neutral undead attack both bunkers every 18 s from 0:20, growing over time (`global.wave*` in the dev menu). No soul energy for their bunker hits; defenders still earn kill rewards.
- **Adaptive CPU:** skill 0–1 from the menu difficulty + your rank + win/loss streak (`progress.aiSkill`). It scales the CPU's decision speed, income (×0.78–1.18), card levels and bunker level, and the opening 45 s are slower. Shown as "CPU Lv 1–10".
- **Overtime** is gentler than the PRD's (+35% bunker damage per 20 s stack instead of ×2 per 15 s), so late games no longer end in a sudden storm.
- **Audio:** generated SFX (`public/assets/sfx`, Seed Audio), music (`public/assets/music`, Lyria 3: menu / battle / final) and announcer (`public/assets/voice`, ElevenLabs v3 "brian"). Missing files fall back to the synthesized sounds.

## v3 changes

- **Faster opening:** 170 starting soul, 6 base income, automatic waves from 0:06 every 15 s.
- **No time limit:** the timer is shown, but there's no end time, overtime or announcements. Hidden late-game pressure (`global.late*`) makes undead slowly tougher from 4:00, so matches still end (balance test: 84% between 3:00 and 6:00, longest ~8 min). `global.timeLimit` > 0 brings back a time limit for testing.
- **Boss timeline** (`BOSS_TIMELINE` / `BOSS_CYCLE` in `src/config.js`): bats → pumpkins → gargoyles → iron golem → headless horseman → Bone Dragon (3:10) → **Abomination** (splits into zombies) → **Lich King** (shielded, regenerates, summons skeletons), then cycles. Bosses march on both bunkers.
- **No difficulty choice:** CPU strength comes only from rank and win/loss streak (`progress.aiSkill`).
- **Random arena** every battle from all five (never the same twice in a row, remembered across reloads); the arena name shows when the battle starts.
- Home screen trimmed to rank, coins, Battle, Shop/Deck/Profile/How to play and the deck.

## v4 changes

- **Squads (coordinated attacks):** tap undead cards to build a squad, mixing types and tapping each as often as you like (e.g. 3× Bat Swarm, 1× Pumpkin Brute, 2× Zombie Runner; up to 20). A squad bar above the cards lists it with its total cost. Drag any of those cards to a gate, or click a gate, and the whole squad spawns in that lane one after another. Right-click a card to take one off it; Esc clears the squad. Tapping a defender or magic card selects it; clicking a build spot or lane plays it once and deselects it. Plain drag still plays one card.
- **Magic** is a third deck group (4 attack, 4 defence, 3 magic): Fog of War, EMP, Raise Dead, plus new **Dark Vigor** (+50% health to your undead on the field), **War Cry** (+50% defender damage for 8 s), **Bunker Shield** (blocks 15 damage, 25 s) and **Freeze** (stops a lane of your own for 4 s). Dark Vigor and War Cry are starter cards. Magic levels give +15% power and duration per level. The CPU uses all of them.
- **Profile:** editable name, avatar picked from your owned cards (shown in the top bar), stats and recent battles.
- **No-scroll menus:** Deck, Shop and Profile scale their content to fit the window (`UI.fitScreen`), trying a few arrangements and keeping the one with the biggest cards.
- **Menu music:** a new upbeat menu song (Lyria 3 Pro, ~2 min loop); the demo battle behind the menus is silent. The previous menu clip is in `.data/music-old/`.

## Designer tuning file (`public/tuning.json`)

Every change made in the developer menu is saved automatically (while running `npm run dev`) to `public/tuning.json`. The file holds only the values that differ from the code defaults, and it **overrides `src/config.js`**. It's designer-owned: code changes never edit it, so tuning survives updates. The built game and `npm run balance` read it too, so it stays in effect after the dev menu is removed. "Reset values" in the dev menu empties it.

## New players
- Start with `global.startingCoins` (default 400, editable in the dev menu).
- The tutorial ends in the Shop: buy a first card (it goes straight into the deck), then start the first battle. Skipping the tutorial goes straight to battle.
- **Commander (support):** any number allowed. Every defender inside its circle deals more damage and fires faster (L1 +20% / +15%, radius 3 → L3 +40% / +25%, radius 4.2). Overlapping circles don't stack (the strongest counts). The circle is always shown, and boosted defenders get a gold ring. The airstrike was removed.
- **Shop:** one row per card type, scaled to fit the window.

## v5
- **First launch:** pressing Play starts the tutorial straight away (before the home screen).
- **Pause / quit:** ⏸ button at the top of the battle screen, or Esc / P. Quit counts as a loss with no rewards; quitting the tutorial just ends it.
- **Developer menu disabled** (`DEV_MENU_ENABLED = false` in `src/config.js`; set it to `true` to bring the gear button back). Values already saved in `public/tuning.json` keep applying.
- **Bunker destruction:** big fireball and shockwaves, flying concrete, roof/dome/flag/turret thrown into the air, chain explosions, then a burning rubble pile.
- **Bunker hits:** attackers leap and slam into the bunker wall (dust and sparks) instead of vanishing.
- Selection circle, drone rotors, upgrade rims and screen glows were toned down so a selected or upgraded defender never washes out to white.
- **Announcer:** the opening "Battle stations, soldiers! Hold the line!" is one quick shout (no pause). Boss arrivals rotate through 7 lines (`voice/wave*.mp3`), never the same twice in a row. The previous opening line is in `.data/voice-old/`.
- **Drones spread out:** each drone claims its own target (the most advanced undead no other drone is chasing), hovers on its own side of it, and keeps ≥ 0.7 tiles from other drones, so several operators no longer stack their drones into one.

## Ghost counters
Ghosts are invisible, but can be seen by: **Sniper L2 / Drone L2**; **any defender** right next to the path (within 1.05 tiles, `global.ghostSenseRadius`); the **bunker searchlight** (bunker level 2+: radius 3.5 / 5 / 6 / 7); **explosions** (grenades, missiles, shells, drone bombs hit and expose them); and the **Flare** magic card. Once spotted, a ghost stays visible to all defenders for 2.5 s (`global.revealLinger`). From level 3 the bunker turret is stronger (1.5–3 dmg, 1.5–2.2 shots/s, range 4.2–5.4) and shoots spotted ghosts first. Ghosts deal 3 bunker damage. The CPU always carries a detector, builds and upgrades one when ghosts get through, uses Flare, and keeps its army mixed (fewer ghosts once 4+ are on the field).
- **Flare** (magic, 40 soul): cancels the enemy's Fog, EMP and Freeze on you and reveals every ghost on your side for 10 s.

## Pacing (no fixed "5-minute surge")
Measured with `node tools/surge.mjs [matches] [peaks]` (per-30 s CPU spending and damage; `peaks` = when each game's heaviest CPU push lands; `OLD=1` approximates the previous behaviour).
- **Eco soft cap:** income boost per tick above `ecoSoftCap` (40) only counts at `ecoOverCap` (35%), so neither economy explodes late.
- **CPU offensives at random times:** between offensives the CPU's attack spend per decision is capped (`aiPressureBase` + `aiPressurePerSec` × time); big pushes happen at a random moment (first after 100–240 s, then every 50–160 s).
- **Per-match variation:** late pressure starts ±60 s from 4:00 (`lateJitter`), bosses arrive ±25 s (`bossJitter`), and escalation runs up to ±25% slower or faster (`paceJitter`).
- Result (60 simulated games): before, the decisive push landed at 4:30–5:30 in 25 of 31 games; now it's spread over 2:30–7:30 with no 30 s window holding more than 8 of 36. Median match ≈ 6.3 min.

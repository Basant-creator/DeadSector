# Audio assets

Drop audio files here and they are used automatically: the build finds them
(`src/audio/assets.ts`), nothing else needs changing, and nothing is ever requested
that is not here. Use only audio that is original, properly licensed, or otherwise
authorised for this project. No Hotline Miami (or other commercial) soundtrack.

```
src/assets/audio/
  music/   the adaptive soundtrack, as stems
  sfx/     replacements for individual sound effects
```

## Status

**There is no finished soundtrack yet.** Until a complete set of stems is added below,
the game plays **placeholder stems** synthesised at boot (`src/audio/placeholderMusic.ts`):
simple, original loops that exist so the adaptive music system can be heard and tested.
They are not the score. The browser console says which is in use
(`[audio] Placeholder music in use ...`).

Every sound effect is currently synthesised at boot from a recipe in `src/audio/sfx.ts`.

## Music stems: `music/`

The soundtrack is one loop split into six stems that always play together, in sync.
The game never switches tracks: it fades stems in and out on bar lines as the fight
changes (see `MUSIC` in `src/audio/music.ts`).

| File | Role | Heard in |
|---|---|---|
| `pad.ogg` | Dark ambient bed: drones, pads, texture. No drums. | calm (full), combat, intense |
| `drums.ogg` | Industrial percussion: kick, snare, hats, metal hits. | combat, intense, giant |
| `bass.ogg` | Distorted, driving bass line. | combat, intense, giant |
| `lead.ogg` | Aggressive synth lead or arpeggio: the high-intensity layer. | intense, giant (lower) |
| `giant.ogg` | Boss layer: heavy stabs, war drums, anything menacing. | giant |
| `blackout.ogg` | Stands alone: heartbeat, filtered drone, sparse. | blackout |

How loud each stem is in each state:

| State | pad | drums | bass | lead | giant | blackout |
|---|---|---|---|---|---|---|
| calm (intermissions, run over) | 1 | 0 | 0 | 0 | 0 | 0 |
| combat | 0.6 | 1 | 1 | 0 | 0 | 0 |
| intense (heavy waves) | 0.4 | 1 | 1 | 0.9 | 0 | 0 |
| giant (warning and fight) | 0 | 1 | 1 | 0.45 | 1 | 0 |
| blackout (future) | 0 | 0 | 0 | 0 | 0 | 1 |

Requirements:

- **All six or none.** The stems are used only as a complete set; if any is missing
  or fails to load, all six fall back to the placeholders (stems must share one
  timeline to stay in sync).
- **Identical length**, to the sample, and **identical tempo**. Currently 120 BPM, 4/4,
  4 bars = exactly 8.000 s. Another tempo or length is fine: set `MUSIC.bpm` and
  `MUSIC.loopBars` to match. Bar lines are where the mix changes.
- **Seamless loops**: each file starts on beat 1 and ends exactly where it loops, with no
  leading or trailing silence. Tails that ring past the end should be wrapped into the
  start when rendering.
- **Format**: Ogg Vorbis (`.ogg`) is preferred, as it loops cleanly. Add an `.m4a` with the
  same name for Safari if needed; the browser picks the format it plays. Avoid MP3: its
  encoder padding breaks the loop point. `.wav` works but is large.
- **Levels**: peaks at or below -1 dBFS per stem; the full mix (all stems but blackout)
  around -16 LUFS. Balance the stems so that each state's mix sounds right at the
  gains above; the music volume setting scales them all.
- Mono or stereo, 44.1 or 48 kHz.

Direction: original dark electronic. Aggressive synths, distorted bass, industrial
percussion, rhythmic intensity; restrained in calm, relentless in the Giant layer.

## Sound effects: `sfx/`

A file named after an effect's key replaces its synthesised recipe, for example
`sfx/sfx-shotgun.ogg`. Keys (see `SFX` in `src/audio/sfx.ts`):

- Weapons: `sfx-pistol`, `sfx-shotgun`, `sfx-rifle`, `sfx-cannon` (the mech)
- Impacts: `sfx-impact` (masonry), `sfx-ping` (metal), `sfx-hit` (a body)
- Enemies: `sfx-death`; the Giant's `sfx-warning`, `sfx-giant-arrive`, `sfx-roar` (charge),
  `sfx-rumble` (slam wind-up), `sfx-slam`, `sfx-whoosh` (throw), `sfx-crash` (rock lands)
- Player: `sfx-hurt`, `sfx-player-death`
- Mech: `sfx-mech-on`, `sfx-mech-off`, `sfx-clank` (hull hit), `sfx-stomp`, `sfx-explosion`
- Interaction: `sfx-buy`, `sfx-deny`, `sfx-gate`, `sfx-switch`, `sfx-pickup` (future pickups)
- The run: `sfx-wave` (wave starts), `sfx-victory` (sector cleared), `sfx-blackout` (future)
- World: `sfx-alarm` (car alarm), ambience `amb-wind` (loop), `amb-siren`, `amb-moan`,
  `amb-clang`, `amb-crow`

Keep effects short, trimmed tight at the start (no lead-in silence), peaks at or below
-1 dBFS. Which event plays which effect, and how loud, is in one table:
`AudioManager.listen` in `src/audio/AudioManager.ts`.

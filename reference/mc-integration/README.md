# Falix Panel — Minecraft-side integration mod (Fabric)

The web panel is only half of the integration. This directory contains the
server-side Fabric mod source that turns real in-game events into panel data
and exposes the `/panel` commands in-game.

## What the mod does

| In-game event | Sent to panel |
|---|---|
| Player joins / leaves | `player_join` / `player_leave` (+ uuid) |
| Player dies | `player_death` |
| Grave block placed (mod feature) | `grave_created` (graveKey, x/y/z, dimension, despawnAt) |
| Grave recovered / expired | `grave_removed` |
| Chat messages | `chat_message` |
| Statistics sync (every 5 min per player) | `player_statistics` |
| Server started / stopped / crashed | `server_start` / `server_stop` / `server_crash` |

Events are POSTed to `POST /api/integration/events` on the panel with the
`X-Integration-Key: $INTEGRATION_SECRET_KEY` header. Batches are queued to
survive panel downtime.

The mod also **polls `GET /api/integration/config` every 30 seconds** so admin
changes made in the panel — grave despawn timer, grave protection — apply live
in game without a restart.

## Commands registered by the mod

```text
/panel                  — show panel status + your link status
/panel help             — command help
/panel status           — server TPS, MSPT, player count, uptime (real data)
/panel graves           — list your active graves in chat
/panel chat             — chat relay info
/panel notifications    — show where panel notifications live
/panel server restart   — ADMIN ONLY (permission level 3): restart the server
```

## Grave protection (game-side authority)

Graves are a custom block with an owner UUID in the block entity. Protection
is enforced **in the game server**:

- `GraveBlock#onUse` only opens for the owner (or an admin) — other players
  get a denial message. The panel's "Grave protection" toggle switches this.
- Explosions cannot destroy the block (blast resistance + explosion hook).
- Hoppers/pistons cannot move it (`PistonBehavior.BLOCK`).
- Despawn timer is a real game-tick task; on despawn the block is removed and
  `grave_removed` is sent. The timer is set from the panel (5 min – 7 days).

## Building the jar

Requirements: **Java 21** (Temurin is fine).

```bash
cd mc-integration
gradle wrapper --gradle-version 8.10   # once, if gradlew is missing
./gradlew build                        # or gradlew.bat build on Windows
```

The jar appears at `build/libs/falix-panel-mod-1.0.0.jar` (plus a `-sources`
jar you can ignore).

## Installing on your server

1. Copy the jar into your Minecraft **Fabric** server's `mods/` folder
   (match the mod's Minecraft version — see `gradle.properties`).
2. Also install **Fabric API** in `mods/` if it isn't already there.
3. Configure the panel connection — either environment variables or
   `config/falixpanel.properties` next to the server jar:

```properties
panelUrl=https://your-panel-host
integrationSecret=<the panel's INTEGRATION_SECRET_KEY>
```

Or as env vars:

```env
PANEL_URL=https://your-panel-host
INTEGRATION_SECRET_KEY=<same value as the panel's INTEGRATION_SECRET_KEY>
```

The integration secret is shown (masked) in Panel → Settings → Server, and its
full value is whatever you entered during first-run setup. The mod is
transport-only: it stores no panel secrets besides its own key and never
accepts inbound connections from the panel.

## Files

```text
src/main/java/com/falix/panel/
├── FalixPanelMod.java          — ModInitializer: registers everything
├── config/ModConfig.java       — PANEL_URL + INTEGRATION_SECRET_KEY from env/config
├── net/PanelClient.java        — async HTTP sender with retry queue + config poller
├── event/                      — join/leave/death/chat/statistic listeners
├── grave/GraveBlock.java       — protected grave block + block entity
├── grave/GraveManager.java     — create/recover/despawn + panel-driven settings
└── command/PanelCommands.java  — /panel command tree
```

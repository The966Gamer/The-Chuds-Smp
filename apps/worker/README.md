# TheChudSmp Discord Worker

A dedicated persistent Node.js worker that maintains a live WebSocket connection to the Discord Gateway and handles slash commands for TheChudSmp Minecraft Server.

## Why a Separate Worker?

The previous version attempted to maintain a persistent Discord WebSocket connection inside Netlify Serverless Functions. Serverless functions freeze and terminate after request execution, which caused the Gateway WebSocket connection to abruptly die, trigger constant reconnect loops, and crash.

This worker runs as a standard long-lived Node.js process on any persistent hosting environment:
- Railway
- Fly.io
- Render Background Worker
- DigitalOcean / Linode / VPS
- Docker / Kubernetes

The main web application can be deployed anywhere (Netlify, Cloud Run, Vercel, Node.js) while this worker connects independently to the Discord Gateway.

## Commands Supported

- `/status` — Live status query of FalixNodes and Minecraft server (latency, players online, version)
- `/start` — Start the server via Falix API
- `/stop` — Stop the server via Falix API
- `/restart` — Restart the server via Falix API
- `/console <command>` — Run a command in Minecraft via RCON (e.g. `/console list`, `/console say Hello!`)
- `/players` — List all online players
- `/graves` — Show active player graves with coordinates, dimension, and remaining despawn countdown

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in:
   - `DISCORD_BOT_TOKEN`
   - `PANEL_API_URL`
   - `PANEL_INTEGRATION_KEY`
   - `DATABASE_URL` (optional direct DB access)

3. Install & run:
   ```bash
   npm install
   npm run start
   ```

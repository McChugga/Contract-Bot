# Guild Guide

Guild Guide extends the supplied Contract Bot source with modular command loading and persistent, per-server knowledge. Existing contract creation, review, completion, payment confirmation, role/member settings, and channels remain in `bot/index.js`.

## Requirements

- Node.js 18 or newer
- PostgreSQL
- A Discord application/bot with the `Guilds` intent and permission to use application commands

## Setup

1. Install dependencies with `npm install`.
2. Create a PostgreSQL database.
3. Set `DISCORD_TOKEN`, `DATABASE_URL`, and optionally `PORT` in your process environment or hosting provider settings. `.env.example` documents the variable names; this package does not load `.env` files automatically. Set `PGSSLMODE=require` when your database provider requires TLS.
4. Apply schema migrations with `npm run migrate`. The bot also applies pending migrations during startup.
5. Run the built-in checks with `npm test`.
6. Start Guild Guide with `npm start`.
7. Invite the bot with the `bot` and `applications.commands` scopes. Run `/contractsetup` in your server to configure the existing contract channels and permission targets.

Global Discord command updates can take time to appear. Startup registers the existing `/contract`, `/contractsetup`, and `/createcontractchannels` commands together with modular commands.

## Knowledge command

- `/knowledge search query:<words>` searches entries saved for the current server.
- `/knowledge add title:<title> content:<text>` creates or updates an entry. Requires Manage Server permission.
- `/knowledge remove title:<title>` removes an entry by exact title. Requires Manage Server permission.

Entries are scoped by Discord server. Search replies are private to the caller. This is a database-backed knowledge lookup; it does not call an AI model.

## Server information

- `/guildconfig view` privately displays saved server information.
- `/guildconfig set-description text:<text>` saves the server description.
- `/guildconfig set-welcome text:<text>` saves welcome information.
- `/guildconfig set-rules-channel channel:<channel>` saves the rules channel.
- `/guildconfig set-info-channel channel:<channel>` saves the information channel.

All changes require Manage Server permission.

## Configuration and storage

Environment parsing is centralized in `config/environment.js`, the shared PostgreSQL pool is in `database/pool.js`, and SQL migrations live in `database/migrations/`. `guild_config` stores server name, description, welcome text, and rules/info channel IDs for upcoming configuration commands. The existing contract settings tables remain managed by the original contract application code.

Add slash commands as modules under `commands/` that export `data` and `execute`. Services and repositories separate command behavior from PostgreSQL queries.

## Hosting notes

Keep the process running as a worker/service. The built-in Express health endpoint listens on `PORT` and responds at `/`. Do not commit real bot tokens or database credentials.

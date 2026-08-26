#!/usr/bin/env bash
#
# sync-d1.sh — RETIRED. DO NOT RUN.
#
# This reloads the remote D1 database's DATA from a DigitalOcean Postgres, deleting every
# existing row first. It was written when Postgres was canonical and D1 was a staging copy.
# That is no longer true: D1 is the canonical production data store, so running this would
# destroy production data and replace it with a stale snapshot.
#
# Kept only until the retired ETL scripts are deleted together — see
# docs/architecture/operations-manual.md section 6 and deployment-checklist section 10a.
#
# (Historical behaviour, for reference: schema and migration history are left intact and
# only table contents replaced; must run from a DO Postgres Trusted Source; the local dev
# D1 is stashed before the run and restored afterward, even on failure.)
#
# Requirements:
#   - DATABASE_URL — Postgres source; read from the shell env or .env. Append
#     ?sslmode=require for DigitalOcean.
#   - wrangler auth for the --remote steps: `wrangler login`, or CLOUDFLARE_API_TOKEN +
#     CLOUDFLARE_ACCOUNT_ID in the env / .env.
#   - If you've added migrations since the last deploy, run `pnpm db:migrate` first so the
#     remote schema matches before loading data.
#
# Usage:
#   pnpm db:sync             # prompts before the destructive remote reload
#   pnpm db:sync -- --yes    # skip the prompt (e.g. scripted)
set -euo pipefail

DB=corvmc-db
cd "$(dirname "$0")/.."

# --- args -----------------------------------------------------------------------------
SKIP_CONFIRM=false
for arg in "$@"; do
	case "$arg" in
	-y | --yes) SKIP_CONFIRM=true ;;
	*)
		echo "Unknown argument: $arg" >&2
		exit 2
		;;
	esac
done

# --- DATABASE_URL: shell env, else .env -----------------------------------------------
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
	DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"
	DATABASE_URL="${DATABASE_URL%[\"\']}"
	DATABASE_URL="${DATABASE_URL#[\"\']}"
	export DATABASE_URL
fi
: "${DATABASE_URL:?set DATABASE_URL (shell env or .env) to the Postgres source}"

# --- confirm: this DELETES and reloads all remote D1 data ------------------------------
if [ "$SKIP_CONFIRM" != true ]; then
	if [ ! -t 0 ]; then
		echo "Refusing to run non-interactively without --yes (this wipes remote D1 data)." >&2
		exit 1
	fi
	read -rp "Reload ALL data in remote D1 '$DB' from Postgres? Deletes current remote data. [y/N] " reply
	case "$reply" in
	[Yy]*) ;;
	*)
		echo "Aborted."
		exit 1
		;;
	esac
fi

# --- preserve local dev D1 ------------------------------------------------------------
# `wrangler d1 export --local` only reads the default state dir, so we can't isolate to a
# scratch path. Instead, stash the dev D1 and restore it on exit (success, failure, or ^C).
DEV_D1=".wrangler/state/v3/d1"
STASH=""
cleanup() {
	rm -f d1-seed.sql d1-seed-ordered.sql d1-delete.sql
	rm -rf "$DEV_D1"
	if [ -n "$STASH" ] && [ -e "$STASH" ]; then
		mkdir -p "$(dirname "$DEV_D1")"
		mv "$STASH" "$DEV_D1"
	fi
}
trap cleanup EXIT INT TERM
if [ -e "$DEV_D1" ]; then
	STASH="$(mktemp -d)/d1"
	mv "$DEV_D1" "$STASH"
fi

echo "▸ 1/5  Build a clean local D1 from migration files"
pnpm db:migrate:local >/dev/null

echo "▸ 2/5  ETL Postgres → local D1"
pnpm tsx scripts/migrate-from-postgres.ts --commit

echo "▸ 3/5  Export local data + order it (FK-safe)"
wrangler d1 export "$DB" --local --no-schema --output d1-seed.sql >/dev/null
node scripts/reorder-seed.mjs
node scripts/gen-d1-delete.mjs

echo "▸ 4/5  Clear remote data (child-first)"
wrangler d1 execute "$DB" --remote --yes --file d1-delete.sql >/dev/null

echo "▸ 5/5  Import fresh data into remote (parent-first)"
wrangler d1 execute "$DB" --remote --yes --file d1-seed-ordered.sql >/dev/null

echo "✓ D1 data sync complete."

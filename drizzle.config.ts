import { readFileSync } from 'node:fs';
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * The production database id, from `wrangler.toml` — the same declaration the Worker binds
 * `DB` to, so the migrate and the runtime cannot drift onto different databases.
 *
 * It used to come only from `CLOUDFLARE_DATABASE_ID` in the Cloudflare build environment, which
 * made a non-secret value that is already committed to this repo into a dashboard field that
 * could go missing — and it did. When the repo moved to `corvmc/corvmc.org` the build
 * configuration was recreated without it, and `pnpm build` failed with "Please provide required
 * params for D1 HTTP driver". Reading it here leaves `CLOUDFLARE_D1_TOKEN` as the only piece of
 * build config that genuinely has to be a secret.
 *
 * A regex rather than a TOML parser: this file is loaded by jiti during `db:generate`, so it is
 * kept to node builtins and relative paths (see the schema's config import for the same reason).
 */
export function databaseIdFromWrangler(): string | undefined {
	const toml = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
	return /^\s*database_id\s*=\s*["']([^"']+)["']/m.exec(toml)?.[1];
}

export default defineConfig({
	schema: './src/lib/server/db/schema/index.ts',
	out: './migrations',
	dialect: 'sqlite',
	driver: 'd1-http',
	dbCredentials: {
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
		databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? databaseIdFromWrangler()!,
		token: process.env.CLOUDFLARE_D1_TOKEN!
	},
	verbose: true,
	strict: true
});

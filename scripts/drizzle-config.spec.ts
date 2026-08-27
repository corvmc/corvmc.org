import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { databaseIdFromWrangler } from '../drizzle.config';

// `CLOUDFLARE_DATABASE_ID` was a dashboard build variable holding a value this repo already
// commits. When the repo moved to `corvmc/corvmc.org` the build configuration was recreated
// without it and `pnpm build` died on "Please provide required params for D1 HTTP driver" —
// a deploy blocked by config that never needed to be config. Reading it from wrangler.toml
// means the migrate targets whatever database the Worker binds, by construction.
describe('databaseIdFromWrangler', () => {
	it('resolves the same database the Worker binds DB to', () => {
		const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
		const bound = /^\[\[d1_databases\]\][\s\S]*?^database_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];

		expect(bound).toBeTruthy();
		expect(databaseIdFromWrangler()).toBe(bound);
	});
});

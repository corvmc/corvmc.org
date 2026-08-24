import { mdsvex } from 'mdsvex';
import adapter from '@sveltejs/adapter-cloudflare';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => {
			if (filename.split(/[/\\]/).includes('node_modules')) return undefined;
			if (/\.(md|svx)$/.test(filename)) return undefined;
			if (filename.includes('/layouts/')) return undefined;
			return true;
		},
		experimental: {
			async: true
		}
	},
	kit: {
		experimental: {
			remoteFunctions: true
		},
		// The adapter reads wrangler.adapter.toml (not wrangler.toml) because it
		// rimrafs + overwrites whatever `main` points at in the config it reads,
		// and wrangler.toml's `main` is the hand-written worker.js wrapper that
		// adds the cron `scheduled` handler. Dev-time platform emulation is
		// unaffected — getPlatformProxy still discovers wrangler.toml.
		// MINIFLARE_PERSIST_PATH points `vite dev`/`vite preview` at a state
		// directory other than wrangler's default `.wrangler/state`. Only the e2e
		// run sets it (playwright.config.ts), so that its preview server is the one
		// process holding those SQLite files; unset, the platform emulation is
		// exactly as wrangler leaves it.
		adapter: adapter({
			config: 'wrangler.adapter.toml',
			platformProxy: process.env.MINIFLARE_PERSIST_PATH
				? { persist: { path: process.env.MINIFLARE_PERSIST_PATH } }
				: undefined
		}),

		// Poll for new deploys so a stale client reloads before it tries to import a
		// chunk that no longer exists (the "error loading dynamically imported module"
		// failures seen on client-side navigation after a deploy).
		version: {
			pollInterval: 60_000
		},

		typescript: {
			config: (config) => ({
				...config,
				include: [...config.include, '../drizzle.config.ts']
			})
		}
	},
	preprocess: [
		mdsvex({
			extensions: ['.svx', '.md'],
			layout: { _: join(__dirname, 'src/lib/layouts/prose.svelte') }
		})
	],
	extensions: ['.svelte', '.svx', '.md']
};

export default config;

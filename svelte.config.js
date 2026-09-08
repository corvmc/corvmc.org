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
			if (filename.includes('/markdown/prose.svelte')) return undefined;
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

		// Content Security Policy. Kit owns this rather than the Cloudflare edge
		// because it has to nonce the inline hydration script it injects into every
		// rendered page, and only the renderer can mint a per-response nonce.
		//
		// `frame-ancestors` is enforced now — nothing in the app frames itself, and
		// it is the clickjacking defence. Everything else ships report-only first:
		// the allowlist below is derived from a sweep of the codebase, and the point
		// of report-only is to find out where that sweep was wrong before a wrong
		// entry starts breaking pages. Flipping `reportOnly` to `directives` is a
		// follow-up, once there is violation data.
		//
		// Keep 'unsafe-inline' on every style directive. Kit adds a nonce only to a
		// style directive that lacks it, and a nonce makes the browser ignore
		// 'unsafe-inline' — which would break ~97 inline style attributes, the
		// `<div style="display: contents">` in app.html, and the two places band
		// custom CSS is injected as a `<style>` element through {@html}.
		// src/csp-config.spec.ts guards that, and the Sentry endpoint below.
		csp: {
			mode: 'auto',
			directives: {
				'frame-ancestors': ['self']
			},
			reportOnly: {
				'default-src': ['self'],
				// 'wasm-unsafe-eval' is for the barcode scanner: `barcode-detector/pure`
				// is dynamically imported and its bundled zxing build instantiates wasm
				// fetched from jsdelivr, so neither the directive nor the connect-src
				// entry below is visible to a grep of src/.
				'script-src': ['self', 'wasm-unsafe-eval', 'https://challenges.cloudflare.com'],
				'style-src': [
					'self',
					'unsafe-inline',
					'https://fonts.googleapis.com',
					'https://fonts.bunny.net'
				],
				'style-src-attr': ['unsafe-inline'],
				'style-src-elem': [
					'self',
					'unsafe-inline',
					'https://fonts.googleapis.com',
					'https://fonts.bunny.net'
				],
				'font-src': ['self', 'https://fonts.gstatic.com', 'https://fonts.bunny.net'],
				// Knowingly narrower than reality: js-xss's default whitelist lets
				// user-authored content reference an <img> on any origin. Whether that
				// widens or the sanitizer tightens is a decision for the report data.
				'img-src': ['self', 'data:', 'blob:', 'https://media.corvmc.org'],
				// blob: is the upload preview and the audio duration probe.
				'media-src': ['self', 'blob:'],
				'connect-src': [
					'self',
					'https://o4510014650384384.ingest.us.sentry.io',
					'https://challenges.cloudflare.com',
					'https://fastly.jsdelivr.net'
				],
				// Turnstile, plus the four embed origins minted by link-platform.ts.
				'frame-src': [
					'https://challenges.cloudflare.com',
					'https://www.youtube.com',
					'https://w.soundcloud.com',
					'https://open.spotify.com',
					'https://embed.music.apple.com'
				],
				// Sentry's session replay compresses in a worker built from a blob.
				'worker-src': ['self', 'blob:'],
				// Stripe is never embedded — every checkout is a top-level navigation,
				// which only form-action can block.
				'form-action': [
					'self',
					'https://checkout.stripe.com',
					'https://billing.stripe.com',
					'https://connect.stripe.com'
				],
				'base-uri': ['self'],
				'object-src': ['none'],
				'frame-ancestors': ['self'],
				// Sentry's native security-header endpoint, so violations land beside
				// everything else we already watch. Derived from SENTRY_DSN: the path
				// segment is the project id and sentry_key is the DSN's public key.
				// This file is loaded by Node with no alias map, so it cannot import
				// $lib/sentry-dsn — src/csp-config.spec.ts asserts the two agree.
				'report-uri': [
					'https://o4510014650384384.ingest.us.sentry.io/api/4511504553738240/security/?sentry_key=3b421fec8a5c7c5236b673d9ac5bdd9f'
				]
			}
		},

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
			layout: { _: join(__dirname, 'src/lib/markdown/prose.svelte') }
		})
	],
	extensions: ['.svelte', '.svx', '.md']
};

export default config;

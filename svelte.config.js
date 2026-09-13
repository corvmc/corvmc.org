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
		// Enforced. The allowlist below came from a sweep of the codebase and
		// shipped report-only first, so a wrong entry would report rather than
		// break a page. Two weeks of violations named no first-party resource, so
		// it moved to `directives` unchanged. `report-uri` stays: a violation after
		// enforcement is a broken page, and it should still be visible.
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
				'default-src': ['self'],
				// 'wasm-unsafe-eval' is for the barcode scanner: `barcode-detector/pure`
				// is dynamically imported and its bundled zxing build instantiates wasm
				// fetched from jsdelivr, so neither the directive nor the connect-src
				// entry below is visible to a grep of src/.
				// js.stripe.com is Stripe.js, which the in-app checkout and the add-card
				// modal load at runtime. Stripe requires it be served from their
				// origin; self-hosting it is unsupported and breaks PCI SAQ A.
				'script-src': [
					'self',
					'wasm-unsafe-eval',
					'https://challenges.cloudflare.com',
					'https://js.stripe.com'
				],
				// Every inline-handler violation in the report-only window came from an
				// in-app browser or an extension injecting into the page; src/ has no
				// on* attribute of its own. script-src already refuses them, because a
				// nonce there makes the browser ignore 'unsafe-inline' — naming the
				// directive keeps that true if script-src ever has to allow inline.
				'script-src-attr': ['none'],
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
				// user-authored content reference an <img> on any origin. Enforcing this
				// breaks such an image rather than reporting it; no violation in the
				// report-only window named one, and media.corvmc.org is where the
				// uploader puts everything the app itself stores.
				'img-src': ['self', 'data:', 'blob:', 'https://media.corvmc.org'],
				// blob: is the upload preview and the audio duration probe.
				'media-src': ['self', 'blob:'],
				'connect-src': [
					'self',
					'https://o4510014650384384.ingest.us.sentry.io',
					'https://challenges.cloudflare.com',
					'https://fastly.jsdelivr.net',
					// The Payment Element talks to the API directly, and reads wallet
					// and Link availability from merchant-ui-api.
					'https://api.stripe.com',
					'https://merchant-ui-api.stripe.com'
				],
				// Turnstile, the four embed origins minted by link-platform.ts, and
				// Stripe: js.stripe.com is where the Payment Element's card fields
				// live, hooks.stripe.com is the 3-D Secure challenge.
				'frame-src': [
					'https://challenges.cloudflare.com',
					'https://js.stripe.com',
					'https://hooks.stripe.com',
					'https://www.youtube.com',
					'https://w.soundcloud.com',
					'https://open.spotify.com',
					'https://embed.music.apple.com'
				],
				// Sentry's session replay compresses in a worker built from a blob.
				'worker-src': ['self', 'blob:'],
				// Kept for the hosted-page fallback: `uiMode` still defaults to
				// `hosted_page`, so an un-migrated caller would navigate out to Stripe.
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

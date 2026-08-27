import { sentrySvelteKit } from '@sentry/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { devPort, previewPort } from './scripts/lib/checkout-ports';
const dirname =
	typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
	plugins: [
		sentrySvelteKit({
			org: 'corvallis-music-collective',
			project: 'javascript-sveltekit'
		}),
		tailwindcss(),
		sveltekit()
	],
	server: {
		// The main checkout keeps 5173; a worktree gets a port of its own, derived
		// from its path. See scripts/lib/checkout-ports.ts.
		port: devPort(dirname),
		// Never silently move up a port: landing on the next one up is how you end
		// up reading a sibling worktree's app and wondering where your change went.
		strictPort: true,
		fs: {
			// Worktrees under .claude/worktrees/ symlink node_modules to the main
			// checkout. Vite's allow-list is rooted at the worktree, so requests that
			// resolve through the symlink to the real path 403 and the page never
			// hydrates. Allowing the realpath covers both layouts.
			allow: [dirname, fs.realpathSync(path.resolve(dirname, 'node_modules'))]
		}
	},
	preview: {
		// Same split, and the number playwright.config.ts serves the suite on.
		port: previewPort(dirname),
		strictPort: true
	},
	test: {
		expect: {
			requireAssertions: true
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [
							{
								browser: 'chromium',
								headless: true
							}
						]
					},
					include: ['src/**/*.svelte.spec.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// Each test file gets a fresh VM context (so module + mock state stays
					// isolated), but node_modules load once per worker instead of once per
					// file. `drizzle-orm/sqlite-core` alone costs ~400ms to evaluate in a
					// cold process, which the default `forks` pool re-paid 136 times.
					pool: 'vmForks',
					include: [
						'src/**/*.spec.{js,ts}',
						'scripts/**/*.spec.{js,ts}',
						// Helpers the e2e suite runs outside Playwright. `*.e2e.ts` does not
						// match `*.{test,spec}.ts`, so the Playwright specs stay out.
						'e2e/**/*.spec.{js,ts}'
					],
					exclude: ['src/**/*.svelte.spec.{js,ts}'],
					server: {
						deps: {
							inline: ['bits-ui']
						}
					}
				}
			},
			{
				extends: true,
				plugins: [
					// The plugin will run tests for the stories defined in your Storybook config
					// See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
					storybookTest({
						configDir: path.join(dirname, '.storybook')
					})
				],
				test: {
					name: 'storybook',
					browser: {
						enabled: true,
						headless: true,
						provider: playwright({}),
						instances: [
							{
								browser: 'chromium'
							}
						]
					}
				}
			}
		]
	}
});

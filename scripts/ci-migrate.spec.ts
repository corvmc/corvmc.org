import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error -- plain .mjs script, no types
import { isProductionBranch } from './ci-migrate.mjs';

// The migrate step has to be part of `build`, not just part of the build command configured
// in the Cloudflare dashboard. That field is invisible to code review and is reset when the
// GitHub connection is recreated — which is exactly what happened when the repo moved to
// `corvmc/corvmc.org`. The `pnpm ci:migrate &&` half vanished, #267's `band` -> `group` rename
// published its code without its migration, and every route touching a band 500ed with
// `no such table: group`. Nothing in the repo could have caught it, because this script never
// ran. Wiring it into `build` is the fix; this test is what keeps it wired.
describe('the build script', () => {
	it('runs the migrate step before vite build', () => {
		const { scripts } = JSON.parse(
			readFileSync(new URL('../package.json', import.meta.url), 'utf8')
		);
		expect(scripts.build).toContain('ci-migrate.mjs');
		expect(scripts.build.indexOf('ci-migrate.mjs')).toBeLessThan(
			scripts.build.indexOf('vite build')
		);
	});
});

// Cloudflare Workers Builds is the only thing that deploys this app, and with the
// merge queue enabled it builds — and publishes to production — the queue's
// `gh-readonly-queue/main/*` branch, not `main`. It never rebuilds the identical SHA
// once the queue merges it, so a branch check that only accepts `main` skips the
// migrate for every queued PR while shipping its code. That is how #241's
// `band_member.alias` column reached production as a 500 rather than a column.
describe('isProductionBranch', () => {
	it('accepts the merge queue branch that actually deployed #241', () => {
		expect(
			isProductionBranch('gh-readonly-queue/main/pr-241-5979019840c1d301e3b96d14a4363d11771a2efb')
		).toBe(true);
	});

	it('accepts a direct push to main', () => {
		expect(isProductionBranch('main')).toBe(true);
	});

	it('skips a feature branch', () => {
		expect(isProductionBranch('claude/band-member-alias-migration-c35c74')).toBe(false);
	});

	it('skips an unknown branch, which is what an unset env var looks like', () => {
		expect(isProductionBranch('')).toBe(false);
	});

	// A queue on some other base is not production, however it is spelled.
	it('skips a merge queue targeting another base branch', () => {
		expect(isProductionBranch('gh-readonly-queue/some-other-base/pr-1-abc')).toBe(false);
	});

	it('skips a branch that merely starts with the production branch name', () => {
		expect(isProductionBranch('maintenance')).toBe(false);
		expect(isProductionBranch('gh-readonly-queue/maintenance/pr-1-abc')).toBe(false);
	});
});

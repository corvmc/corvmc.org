import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	connectionCollapse,
	failureItems,
	renderWhatFailed,
	reportedFailureCount
} from './queue-guard-failures.mjs';

/**
 * The annotations GitHub returned for check-run 101921768773 — the E2E job that ejected PR #768
 * from the queue. Twelve entries for a run whose log says 250 failed across 39 spec files: a
 * deprecation warning, the `250 failed` summary as a *notice*, and the first four numbered
 * Playwright failures, each repeated per retry.
 */
const REAL = JSON.parse(readFileSync('scripts/queue-guard-failures.fixture.json', 'utf8'));

describe('the run that reported 250 failures as four band specs', () => {
	it('reads the total out of the summary notice the old filter dropped', () => {
		expect(reportedFailureCount(REAL)).toBe(250);
	});

	it('names the four annotated specs once each, not once per retry', () => {
		expect(failureItems(REAL).map((item: string) => item.split('`')[1])).toEqual([
			'e2e/band-onboarding.e2e.ts:46',
			'e2e/band-music.e2e.ts:41',
			'e2e/band-messages.e2e.ts:62',
			'e2e/band-address.e2e.ts:22'
		]);
	});

	it('says the list is 4 of 250 rather than presenting it as the whole set', () => {
		const comment = renderWhatFailed(REAL);

		expect(comment).toContain('**4 of 250**');
		expect(comment).toContain('250');
		// The sentence that was missing is the one a triage session needed: this is a
		// beginning, not an extent. #794 records a session reading the four specs as a
		// shared-fixture bug and proposing a re-queue on that basis.
		expect(comment).toMatch(/not the extent of it/);
	});

	it('leads with the web server rather than the specs', () => {
		// All 250 were `net::ERR_CONNECTION_REFUSED` — the preview server died. The specs
		// named are simply the ones Playwright numbered 1-4.
		expect(connectionCollapse(REAL)).toEqual({ origin: 'http://localhost:4173' });
		expect(renderWhatFailed(REAL)).toContain('nothing was listening');
	});
});

/** The minimum shape of an annotation, so a case can state only what it is about. */
function annotation(overrides: Record<string, unknown> = {}) {
	return {
		path: 'src/lib/server/thing.spec.ts',
		start_line: 12,
		annotation_level: 'failure',
		title: 'thing',
		message: 'AssertionError: expected 1 to be 2\n  at thing.spec.ts:12',
		...overrides
	};
}

describe('an ordinary rejection', () => {
	it('claims nothing about scope when nothing counted the failures', () => {
		const comment = renderWhatFailed([annotation()]);

		expect(comment).toContain('- `src/lib/server/thing.spec.ts:12` — AssertionError');
		expect(comment).not.toMatch(/Showing/);
	});

	it('keeps quiet about the web server when the failures are real assertions', () => {
		const two = [annotation(), annotation({ path: 'src/lib/server/other.spec.ts' })];

		expect(connectionCollapse(two)).toBeNull();
		expect(renderWhatFailed(two)).not.toContain('nothing was listening');
	});

	it('does not call a single unreachable host a suite-wide collapse', () => {
		const one = [annotation({ message: 'Error: connect ECONNREFUSED 10.0.0.1:443' })];

		expect(connectionCollapse(one)).toBeNull();
	});

	it('drops the runner noise #719 filtered, exit code and timeout notice alike', () => {
		const noisy = [
			annotation({ path: '.github', message: 'Process completed with exit code 1.' }),
			annotation({
				path: '.github',
				message: 'The job has exceeded the maximum execution time of 30m0s'
			})
		];

		expect(failureItems(noisy)).toEqual([]);
		expect(renderWhatFailed(noisy)).toBe('');
	});

	it('still reports a total that nothing annotated', () => {
		const summary = [
			annotation({
				annotation_level: 'notice',
				path: '.github',
				message: '  17 failed\n  1 passed'
			})
		];

		expect(renderWhatFailed(summary)).toContain('**17** failures and annotated none');
	});

	it('renders nothing at all for an empty payload', () => {
		expect(renderWhatFailed([])).toBe('');
	});
});

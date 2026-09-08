import { describe, it, expect } from 'vitest';
import { createServerCrashWatcher, matchServerCrash, serverCrashReport } from './server-crash';
import { checkpointSummary } from './reset-db';

/**
 * Verbatim from run 34181645841, the failure that opened #793. The `SENTRY_DO`
 * and `NOSENTRY` tokens are workerd's Sentry redaction markers around
 * "SQLite failed" — not the name of a Durable Object, of which this app has none.
 */
const FATAL_LINES = [
	'[WebServer] *** Fatal uncaught kj::Exception: workerd/util/sqlite.c++:852: failed: ' +
		'SENTRY_DO SQLite failed; NOSENTRY database is locked: SQLITE_BUSY ' +
		'(extended: SQLITE_BUSY_RECOVERY)',
	'[WebServer] MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.'
];

describe('matchServerCrash', () => {
	it('names the fatal workerd exception', () => {
		expect(matchServerCrash(FATAL_LINES[0])?.kind).toBe('fatal-exception');
	});

	it('names the miniflare runtime failure', () => {
		expect(matchServerCrash(FATAL_LINES[1])?.kind).toBe('runtime-failure');
	});

	it("names Playwright's own report of a webServer that exited", () => {
		expect(
			matchServerCrash('Error: Process from config.webServer was not able to start. Exit code: 1')
				?.kind
		).toBe('server-exited');
	});

	it('ignores ordinary test output', () => {
		expect(matchServerCrash('  1 failed')).toBeNull();
		expect(
			matchServerCrash('[WebServer] Checkpointed 7 e2e database(s); no WAL left behind.')
		).toBe(null);
	});

	// The checkpoint's own warning names SQLITE_BUSY_RECOVERY while describing a
	// suite that has *not* died. Aborting on it would kill healthy runs.
	it('does not fire on the checkpoint warning that names the same failure', () => {
		const warning = checkpointSummary({
			checkpointed: ['/tmp/ok.sqlite'],
			busy: ['/tmp/stuck.sqlite'],
			failed: []
		});

		expect(warning).toContain('SQLITE_BUSY_RECOVERY');
		for (const line of warning.split('\n')) expect(matchServerCrash(line)).toBeNull();
	});
});

describe('createServerCrashWatcher', () => {
	it('returns nothing while the run is healthy', () => {
		const watcher = createServerCrashWatcher();

		expect(watcher.push('Running 254 tests using 2 workers\n')).toBeNull();
		expect(watcher.push('  ok 1 [chromium] > e2e/venues.e2e.ts:3:1\n')).toBeNull();
		expect(watcher.flush()).toBeNull();
	});

	it('catches a signature split across two chunks', () => {
		const watcher = createServerCrashWatcher();
		const [head, tail] = [FATAL_LINES[1].slice(0, 30), FATAL_LINES[1].slice(30)];

		expect(watcher.push(head)).toBeNull();
		expect(watcher.push(`${tail}\n`)?.kind).toBe('runtime-failure');
	});

	it('catches a final line the stream never terminated', () => {
		const watcher = createServerCrashWatcher();

		expect(watcher.push(FATAL_LINES[0])).toBeNull();
		expect(watcher.flush()?.kind).toBe('fatal-exception');
	});

	it('reports the first crash in a multi-line chunk', () => {
		const watcher = createServerCrashWatcher();
		const crash = watcher.push(`some noise\n${FATAL_LINES.join('\n')}\n`);

		expect(crash?.kind).toBe('fatal-exception');
		expect(crash?.line).toBe(FATAL_LINES[0]);
	});
});

describe('serverCrashReport', () => {
	it('leads with the failure and quotes the line that proved it', () => {
		const crash = matchServerCrash(FATAL_LINES[1]);
		const report = serverCrashReport(crash!, 4173);

		expect(report).toContain('The e2e web server did not start.');
		expect(report).toContain(FATAL_LINES[1]);
		expect(report).toContain('port 4173');
	});
});

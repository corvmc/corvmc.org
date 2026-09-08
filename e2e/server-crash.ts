/**
 * Recognise, in the runner's own output, that the preview server has died.
 *
 * Playwright races `webServer`'s exit only while waiting for the port and drops
 * it after, so a workerd that dies on its first *request* goes unreported and
 * the suite runs on against a closed port. Run 34181645841 read as 250 failures
 * across 39 spec files for one dead server (#793).
 */

/** Which signature matched, and the output line it matched on. */
export interface ServerCrash {
	kind: 'runtime-failure' | 'fatal-exception' | 'server-exited';
	line: string;
}

/**
 * Only text the *server* emits once it is already dead.
 *
 * Deliberately not `SQLITE_BUSY_RECOVERY`: `checkpointSummary` names that
 * string in a warning about a suite that has not died yet, and aborting on a
 * warning would be worse than the failure this catches.
 */
const SIGNATURES: ReadonlyArray<readonly [ServerCrash['kind'], RegExp]> = [
	['runtime-failure', /ERR_RUNTIME_FAILURE/],
	['fatal-exception', /Fatal uncaught kj::Exception/],
	['server-exited', /Process from config\.webServer (?:was not able to start|exited early)/]
];

/** The first signature this line carries, if any. */
export function matchServerCrash(line: string): ServerCrash | null {
	for (const [kind, pattern] of SIGNATURES) {
		if (pattern.test(line)) return { kind, line: line.trim() };
	}
	return null;
}

/** Feeds chunks in, gets the first crash out. */
export interface ServerCrashWatcher {
	/** A chunk of runner output; returns a crash the moment one completes. */
	push(chunk: string): ServerCrash | null;
	/** The unterminated tail, once the stream has closed. */
	flush(): ServerCrash | null;
}

/**
 * Watch a stream of runner output for a dead server.
 *
 * Line-buffered because a pipe splits wherever it likes, and the fatal workerd
 * exception is long enough to land across two chunks — matching per chunk would
 * miss exactly the failure this is for.
 */
export function createServerCrashWatcher(): ServerCrashWatcher {
	let partial = '';

	return {
		push(chunk) {
			const lines = (partial + chunk).split('\n');
			partial = lines.pop() ?? '';

			for (const line of lines) {
				const crash = matchServerCrash(line);
				if (crash) return crash;
			}
			return null;
		},

		flush() {
			const line = partial;
			partial = '';
			return line ? matchServerCrash(line) : null;
		}
	};
}

/**
 * What to print instead of 250 connection-refused failures.
 *
 * The reader of this has a red job and no reason yet to suspect the harness, so
 * it has to say what died and what that did to the run, not just quote a line.
 */
export function serverCrashReport(crash: ServerCrash, port: number): string {
	return [
		'',
		'='.repeat(72),
		'The e2e web server did not start.',
		'',
		`  ${crash.line}`,
		'',
		`Nothing is listening on port ${port} any more, so every test still to run`,
		'would have failed on ERR_CONNECTION_REFUSED with no assertion involved.',
		'This run is aborted here so the failure reads as one dead server rather',
		'than as several hundred broken tests.',
		'',
		'This is usually the SQLITE_BUSY_RECOVERY race (#793): workerd opens its',
		"SQLite lazily, on the first request, and cannot take the WAL's exclusive",
		"lock while Playwright's readers hold the file. Re-run `pnpm test:e2e`,",
		'which re-prepares and re-checkpoints the state directory first.',
		'='.repeat(72),
		''
	].join('\n');
}

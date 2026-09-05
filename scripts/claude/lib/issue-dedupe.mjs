/**
 * The matcher behind `require-issue-dedupe.sh`.
 *
 * Filing a finding is only useful if the tracker stays readable, and the way an
 * issue tracker stops being readable is duplicates. A session has no memory of
 * what it filed last week and no reason to expect the repo already knows about
 * the thing it just noticed, so "search first" is exactly the instruction that
 * gets skipped under a long task.
 *
 * The mechanism is a marker file per session: a search touches it, a create
 * requires it. Both classifications run over the same command, in that order,
 * so the one-liner that is the ideal usage —
 *
 *   gh issue list --search 'poster key' && gh issue create ...
 *
 * — passes on its own merits rather than needing an exemption.
 *
 * Two honest limits, neither worth closing:
 *
 *   1. `PreToolUse` sees the command, not its result. A session that runs a
 *      search and ignores what it returns satisfies this guard. That is the
 *      difference between a guardrail and a boundary, and this is the former —
 *      the point is to make the search happen, not to prove it was read.
 *   2. Because of (1) there is no escape hatch, and none is needed: a search
 *      that fails (offline, `gh` unauthenticated) still arms the marker, so the
 *      guard can never strand a session that cannot reach GitHub.
 */
import { existsSync, statSync, utimesSync, closeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandSegments, readCommand } from './command-segments.mjs';

/** How long a search vouches for the creates that follow it. */
export const MARKER_TTL_MS = 30 * 60 * 1000;

/**
 * `gh issue list` and `gh search issues` are the two commands that put existing
 * issues in front of the session. `gh issue view` is deliberately not one of
 * them: viewing an issue you already have the number for is not a search for
 * the one you are about to duplicate.
 */
const SEARCH = /^gh\s+(issue\s+list|search\s+issues)(\s|$)/;
const CREATE = /^gh\s+issue\s+create(\s|$)/;

/**
 * What a command does to the marker: `'search'` arms it, `'create'` requires it,
 * `null` is everything else. A command chaining both is a search — it arms the
 * marker before the create in the same segment list is checked against it.
 *
 * @param {string} command
 * @returns {'search' | 'create' | null}
 */
export function classify(command) {
	const segments = commandSegments(command);
	if (segments.some((s) => SEARCH.test(s))) return 'search';
	if (segments.some((s) => CREATE.test(s))) return 'create';
	return null;
}

/**
 * Where this session's marker lives. Not `.git/` — that is a file in a worktree.
 *
 * @param {string | undefined} sessionId
 */
export function markerPath(sessionId) {
	const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '');
	return join(tmpdir(), `claude-issue-search-${safe || 'unknown'}`);
}

/** @param {string} path @param {number} [now] */
export function armMarker(path, now = Date.now()) {
	if (!existsSync(path)) closeSync(openSync(path, 'w'));
	utimesSync(path, new Date(now), new Date(now));
}

/** @param {string} path @param {number} [now] */
export function markerIsFresh(path, now = Date.now()) {
	if (!existsSync(path)) return false;
	return now - statSync(path).mtimeMs < MARKER_TTL_MS;
}

/**
 * The whole guard over one payload. Returns `true` when the create should be
 * blocked; every other path is silent, including a payload that is not a
 * `PreToolUse` Bash call at all.
 *
 * @param {string} raw the hook payload, as JSON
 * @param {{ now?: number }} [opts]
 * @returns {boolean}
 */
export function evaluate(raw, { now = Date.now() } = {}) {
	const command = readCommand(raw);
	if (!command) return false;

	let sessionId;
	try {
		sessionId = JSON.parse(raw).session_id;
	} catch {
		sessionId = undefined;
	}
	const path = markerPath(sessionId);

	switch (classify(command)) {
		case 'search':
			armMarker(path, now);
			return false;
		case 'create':
			return !markerIsFresh(path, now);
		default:
			return false;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	let raw = '';
	for await (const chunk of process.stdin) raw += chunk;
	if (evaluate(raw)) process.stdout.write('block');
}

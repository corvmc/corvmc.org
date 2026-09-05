import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	classify,
	evaluate,
	markerPath,
	armMarker,
	markerIsFresh,
	MARKER_TTL_MS
} from './lib/issue-dedupe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SESSION = 'spec-session-issue-dedupe';

function payload(command: string, sessionId: string = SESSION) {
	return JSON.stringify({ session_id: sessionId, tool_input: { command } });
}

beforeEach(() => {
	rmSync(markerPath(SESSION), { force: true });
});

describe('classify', () => {
	it.each([
		'gh issue list',
		'gh issue list --state open --search "poster key"',
		'gh issue list --label area:events',
		'gh search issues --repo corvmc/corvmc.org sweep'
	])('reads %s as a search', (command) => {
		expect(classify(command)).toBe('search');
	});

	it.each(['gh issue create', 'gh issue create --template finding.md --title x'])(
		'reads %s as a create',
		(command) => {
			expect(classify(command)).toBe('create');
		}
	);

	// `gh issue view` puts one known issue on screen. That is not a search for
	// the one you are about to duplicate, so it must not arm the marker.
	it.each([
		'gh issue view 12',
		'gh pr list',
		'pnpm lint:changed',
		'git commit -m "gh issue create"'
	])('reads %s as neither', (command) => {
		expect(classify(command)).toBeNull();
	});

	// The trap `command-segments.mjs` exists for: a heredoc body is data. Writing
	// documentation about the guarded command must not trip the guard.
	it('ignores a create inside a heredoc body', () => {
		expect(classify("cat > doc.md <<'EOF'\nRun gh issue create to file it.\nEOF")).toBeNull();
	});

	// The ideal usage is one command. The search half has to win, or the guard
	// blocks exactly the shape it is trying to teach.
	it('treats search-then-create in one command as a search', () => {
		expect(classify("gh issue list --search 'poster' && gh issue create --title x")).toBe('search');
	});
});

describe('evaluate', () => {
	it('blocks a create with no prior search', () => {
		expect(evaluate(payload('gh issue create --title x'))).toBe(true);
	});

	it('allows a create after a search in the same session', () => {
		expect(evaluate(payload('gh issue list --search "poster"'))).toBe(false);
		expect(evaluate(payload('gh issue create --title x'))).toBe(false);
	});

	// The marker is per session: a sibling worktree's search vouches for nothing.
	it('does not let one session vouch for another', () => {
		rmSync(markerPath('other-session'), { force: true });
		expect(evaluate(payload('gh issue list', 'other-session'))).toBe(false);
		expect(evaluate(payload('gh issue create --title x', SESSION))).toBe(true);
		rmSync(markerPath('other-session'), { force: true });
	});

	it('expires a search older than the window', () => {
		const now = Date.now();
		expect(evaluate(payload('gh issue list'), { now: now - MARKER_TTL_MS - 1000 })).toBe(false);
		expect(evaluate(payload('gh issue create --title x'), { now })).toBe(true);
	});

	it('is silent on everything that is not a gh issue command', () => {
		expect(evaluate(payload('pnpm lint:changed'))).toBe(false);
		expect(evaluate('not json at all')).toBe(false);
		expect(evaluate(JSON.stringify({ session_id: SESSION }))).toBe(false);
	});
});

describe('the marker', () => {
	// A worktree's `.git` is a file, so the marker cannot live under it.
	it('lives outside the repo', () => {
		expect(markerPath(SESSION).startsWith(here)).toBe(false);
	});

	it('survives being armed twice and reports its own freshness', () => {
		const path = markerPath(SESSION);
		armMarker(path);
		armMarker(path);
		expect(existsSync(path)).toBe(true);
		expect(markerIsFresh(path)).toBe(true);
		expect(markerIsFresh(path, Date.now() + MARKER_TTL_MS + 1000)).toBe(false);
	});
});

describe('the hook script', () => {
	function run(command: string) {
		try {
			execFileSync('bash', [join(here, 'require-issue-dedupe.sh')], {
				input: payload(command),
				encoding: 'utf-8',
				stdio: ['pipe', 'pipe', 'pipe']
			});
			return { code: 0, stderr: '' };
		} catch (e: any) {
			return { code: e.status as number, stderr: String(e.stderr) };
		}
	}

	it('exits 2 and names the search to run', () => {
		const { code, stderr } = run('gh issue create --title x');
		expect(code).toBe(2);
		expect(stderr).toContain('gh issue list');
	});

	it('exits 0 once a search has run', () => {
		expect(run('gh issue list --search "poster"').code).toBe(0);
		expect(run('gh issue create --title x').code).toBe(0);
	});
});

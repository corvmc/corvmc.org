import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { redundantGate } from './lib/whole-tree-gate.mjs';
import { commandSegments } from './lib/command-segments.mjs';

// The matcher turns on one question — does the command name a path? — so the
// pairs below are what the whole guard is: the same script, blocked whole-tree
// and allowed scoped. Getting this backwards is the expensive direction: it
// would block the blast-radius run that is the only local check still worth
// paying for.
const here = dirname(fileURLToPath(import.meta.url));

function blocked(command: string) {
	return redundantGate(command)?.job;
}

describe('redundantGate', () => {
	it.each([
		['pnpm test:e2e', 'E2E'],
		['pnpm test:e2e:run', 'E2E'],
		['pnpm test:e2e:prepare', 'E2E'],
		['pnpm test', 'Unit tests and E2E'],
		['pnpm lint', 'Lint (full)'],
		['pnpm run lint', 'Lint (full)'],
		['pnpm test:unit -- --run', 'Unit tests'],
		['pnpm test:server', 'Unit tests'],
		['pnpm test:components', 'Unit tests'],
		['pnpm exec vitest --run', 'Unit tests'],
		['pnpm exec playwright test', 'E2E'],
		['eslint .', 'Lint (full)']
	])('blocks %s as the "%s" job', (command, job) => {
		expect(blocked(command)).toBe(job);
	});

	it.each([
		'pnpm lint:changed',
		'pnpm check',
		'pnpm format',
		'pnpm test:changed',
		'pnpm test:unit -- --run src/lib/server/bands',
		'pnpm test:server src/lib/server/bands',
		'pnpm exec vitest --run --project=server src/lib/server/bands',
		'eslint src/lib/remote'
	])('allows %s', (command) => {
		expect(blocked(command)).toBeUndefined();
	});

	// `--project server` is the value form. Reading `server` as a path would let
	// a whole-suite run through under the flag it is normally scoped with.
	it('does not mistake a flag value for a path', () => {
		expect(blocked('pnpm exec vitest --run --project server')).toBe('Unit tests');
		expect(blocked('pnpm exec vitest --run --project server src/lib')).toBeUndefined();
	});

	// `.` is a path that scopes nothing, and pnpm forwards `--` literally rather
	// than consuming it (scripts/lib/forwarded-args.ts) — both would otherwise
	// read as "this run is scoped".
	it('treats `.` and a bare `--` as no scope at all', () => {
		expect(blocked('eslint . --max-warnings 0')).toBe('Lint (full)');
		expect(blocked('pnpm test:unit -- --run --')).toBe('Unit tests');
	});

	it('finds a gate chained behind another command', () => {
		expect(blocked('git add -A && pnpm lint')).toBe('Lint (full)');
	});

	// The escape hatch means "a human asked for this run in this turn". It is
	// deliberately not keyed to a role: a role-keyed escape becomes the thing
	// that role types by reflex.
	it('passes a run the user explicitly asked for', () => {
		expect(blocked('CMC_FULL_GATE=1 pnpm test:e2e')).toBeUndefined();
		// An empty value is not an opt-in.
		expect(blocked('CMC_FULL_GATE= pnpm test:e2e')).toBe('E2E');
		// And it does not exempt a second command sharing the line.
		expect(blocked('CMC_FULL_GATE=1 pnpm test:e2e && pnpm lint')).toBe('Lint (full)');
	});

	it('ignores an unrelated env prefix', () => {
		expect(blocked('CI=1 pnpm lint')).toBe('Lint (full)');
	});

	// Writing the doc that explains a command must not trip the guard the doc
	// describes — the trap that `block-bare-npm.sh` found by firing on itself.
	it('ignores a gate named inside a heredoc body', () => {
		const doc = ["cat > docs/x.md <<'EOF'", 'CI runs `pnpm test:e2e` for you.', 'EOF'].join('\n');
		expect(blocked(doc)).toBeUndefined();
	});

	it('ignores a gate named in a commit message', () => {
		expect(blocked('git commit -m "defer pnpm lint to CI"')).toBeUndefined();
	});
});

// The parser these guards share. `block-bare-npm.sh` had no spec of its own;
// covering the segment splitting here covers the half of that guard that is
// easy to break from the outside.
describe('commandSegments', () => {
	it('splits on the shell separators that start a new command', () => {
		expect(commandSegments('git fetch && pnpm lint | tee log')).toEqual([
			'git fetch',
			'pnpm lint',
			'tee log'
		]);
	});

	// The opener is a real part of the command and survives; the body and its
	// terminator are not commands and do not.
	it('keeps a heredoc opener and drops its body', () => {
		expect(commandSegments(["cat <<'EOF'", 'npm install', 'EOF'].join('\n'))).toEqual([
			"cat <<'EOF'"
		]);
	});
});

function run(script: string, command: string): { code: number; stderr: string } {
	try {
		execFileSync('bash', [join(here, script)], {
			input: JSON.stringify({ tool_input: { command } }),
			// stderr defaults to the parent's, which dumps every block message into
			// the test reporter. Pipe it — the assertions read it from the error.
			stdio: ['pipe', 'pipe', 'pipe']
		});
		return { code: 0, stderr: '' };
	} catch (e) {
		const err = e as { status: number; stderr: Buffer };
		return { code: err.status, stderr: err.stderr.toString() };
	}
}

// A blocking PreToolUse hook is exit 2 plus a reason on stderr; exit 0 lets the
// command through. The matcher above proves what is matched, these prove the
// two scripts are wired to that verdict at all.
describe('the hook scripts', () => {
	it('blocks with the CI job named and the next action spelled out', () => {
		const { code, stderr } = run('block-whole-tree-gate.sh', 'pnpm test:e2e');
		expect(code).toBe(2);
		expect(stderr).toContain('"E2E" CI job');
		expect(stderr).toContain('gh pr merge --auto');
	});

	it('lets a scoped run through', () => {
		expect(run('block-whole-tree-gate.sh', 'pnpm lint:changed').code).toBe(0);
	});

	// `pnpm` ends in `npm`. This is the assertion that stopped the shared parser
	// from breaking the guard it was extracted from.
	it('still blocks npm without blocking pnpm', () => {
		expect(run('block-bare-npm.sh', 'npm install').code).toBe(2);
		expect(run('block-bare-npm.sh', 'npx prettier --check .').code).toBe(2);
		expect(run('block-bare-npm.sh', 'pnpm install').code).toBe(0);
	});
});

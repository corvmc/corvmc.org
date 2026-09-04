import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The failure this guard exists for is invisible from inside the branch: #508 and
// #510 each closed the same migration fork, in parallel, and each was clean on its
// own. The second re-forked `main` on merge and blocked `db:generate` for everybody.
// So what needs pinning is that the guard asks its question of the *merged* tree,
// only at `gh pr merge`, and gets out of the way everywhere else — a guard that
// blocks a branch it cannot evaluate would be worse than the bug it prevents.
const script = join(dirname(fileURLToPath(import.meta.url)), 'block-forked-migration-merge.sh');

// A throwaway repo, as in `block-shipped-migration-delete.spec.ts`, and for the same
// reason: reading this repo's real migrations would make the suite depend on
// `origin/main` being fetched, which CI's unit job does not do.
let repo: string;
let forkingCheck: string;
let brokenCheck: string;

function git(...args: string[]) {
	execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
}

function addMigration(name: string, sql = 'SELECT 1;') {
	mkdirSync(join(repo, 'migrations', name), { recursive: true });
	writeFileSync(join(repo, 'migrations', name, 'migration.sql'), sql);
}

/** A stand-in for `drizzle-kit check` with a fixed verdict. */
function stubCheck(name: string, exit: number, output: string): string {
	const path = join(repo, name);
	writeFileSync(path, `#!/usr/bin/env bash\ncat <<'OUT'\n${output}\nOUT\nexit ${exit}\n`);
	chmodSync(path, 0o755);
	return path;
}

beforeAll(() => {
	repo = mkdtempSync(join(tmpdir(), 'fork-merge-guard-'));
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');

	addMigration('20260101000000_on_main');
	git('add', '-A');
	git('commit', '-qm', 'main migration');
	git('update-ref', 'refs/remotes/origin/main', 'HEAD');

	// The branch adds one of its own — the ordinary shape of a schema PR.
	addMigration('20260102000000_branch_only', 'SELECT 2;');
	git('add', '-A');
	git('commit', '-qm', 'branch migration');

	forkingCheck = stubCheck(
		'forking-check.sh',
		1,
		' Non-commutative migrations detected  Found 1 conflict across 2 migrations\n' +
			'  ├── migrations/20260101000000_on_main\n' +
			'  └── migrations/20260102000000_branch_only'
	);
	// Exits non-zero for a reason that is not a fork — the shape a worktree with no
	// `node_modules` produces.
	brokenCheck = stubCheck('broken-check.sh', 1, 'ERR_MODULE_NOT_FOUND: drizzle-kit');
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

function run(command: string, checkBin?: string): { code: number; stderr: string } {
	try {
		execFileSync('bash', [script], {
			cwd: repo,
			input: JSON.stringify({ tool_input: { command } }),
			env: { ...process.env, ...(checkBin ? { DRIZZLE_KIT_BIN: checkBin } : {}) },
			stdio: ['pipe', 'pipe', 'pipe']
		});
		return { code: 0, stderr: '' };
	} catch (e) {
		const err = e as { status: number; stderr: Buffer };
		return { code: err.status, stderr: err.stderr.toString() };
	}
}

describe('block-forked-migration-merge', () => {
	it('blocks queueing a branch whose migrations fork the merged lineage', () => {
		expect(run('gh pr merge 123 --auto', forkingCheck).code).toBe(2);
	});

	it('names the offending pair, which is what a person can act on', () => {
		const { stderr } = run('gh pr merge 123 --auto', forkingCheck);
		expect(stderr).toContain('20260102000000_branch_only');
	});

	it('tells you to check whether somebody already landed the change', () => {
		// The usual cause is a duplicate fix, where reconciling afterwards is the
		// wrong move and dropping the migration is the right one.
		const { stderr } = run('gh pr merge 123 --auto', forkingCheck);
		expect(stderr).toContain('--diff-filter=A');
	});

	it('leaves every command that is not a merge alone', () => {
		expect(run('gh pr create --title x', forkingCheck).code).toBe(0);
	});

	it('lets a blocked branch stand itself down with --disable-auto', () => {
		// Found by being blocked by it: `--disable-auto` takes a PR out of the
		// queue. Refusing that leaves a branch this guard has already stopped with
		// no way to un-queue itself, which is the one thing it most needs to do.
		expect(run('gh pr merge 512 --disable-auto', forkingCheck).code).toBe(0);
	});

	it('does not trip on a command that merely mentions the phrase', () => {
		// Writing a document about the workflow is not queueing a PR.
		const quoted = `echo "run gh pr merge --auto when it is green" > notes.md`;
		expect(run(quoted, forkingCheck).code).toBe(0);
	});

	it('fails open when the check errored for a reason that is not a fork', () => {
		// A guard that blocked here would leave a finished branch unqueueable with
		// nothing about it to fix.
		expect(run('gh pr merge 123 --auto', brokenCheck).code).toBe(0);
	});

	it('says nothing about a branch that adds no migration at all', () => {
		// The stub would report a fork if it were ever consulted; the guard should
		// not get that far, because the branch and main agree on `migrations/`.
		const onMain = mkdtempSync(join(tmpdir(), 'fork-merge-guard-clean-'));
		try {
			const g = (...a: string[]) => execFileSync('git', a, { cwd: onMain, stdio: 'pipe' });
			g('init', '-q', '-b', 'main');
			g('config', 'user.email', 'test@example.com');
			g('config', 'user.name', 'Test');
			mkdirSync(join(onMain, 'migrations', '20260101000000_on_main'), { recursive: true });
			writeFileSync(
				join(onMain, 'migrations', '20260101000000_on_main', 'migration.sql'),
				'SELECT 1;'
			);
			writeFileSync(join(onMain, 'src.ts'), 'export const x = 1;');
			g('add', '-A');
			g('commit', '-qm', 'base');
			g('update-ref', 'refs/remotes/origin/main', 'HEAD');
			writeFileSync(join(onMain, 'src.ts'), 'export const x = 2;');
			g('add', '-A');
			g('commit', '-qm', 'code only');

			const out = execFileSync('bash', [script], {
				cwd: onMain,
				input: JSON.stringify({ tool_input: { command: 'gh pr merge 1 --auto' } }),
				env: { ...process.env, DRIZZLE_KIT_BIN: forkingCheck },
				stdio: ['pipe', 'pipe', 'pipe']
			});
			expect(out.toString()).toBe('');
		} finally {
			rmSync(onMain, { recursive: true, force: true });
		}
	});

	it('fails open outside a git repository', () => {
		const bare = mkdtempSync(join(tmpdir(), 'fork-merge-guard-bare-'));
		try {
			const out = execFileSync('bash', [script], {
				cwd: bare,
				input: JSON.stringify({ tool_input: { command: 'gh pr merge 1 --auto' } }),
				stdio: ['pipe', 'pipe', 'pipe']
			});
			expect(out.toString()).toBe('');
		} finally {
			rmSync(bare, { recursive: true, force: true });
		}
	});
});

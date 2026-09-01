import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This guard is the only thing between "collapse this branch's own migrations after
// merging main" — a routine step of the feature-branch workflow — and deleting one
// production has already applied, which no later migration can undo. The two commands
// differ by one directory name, so the distinction is worth pinning.
const script = join(dirname(fileURLToPath(import.meta.url)), 'block-shipped-migration-delete.sh');

const SHIPPED = 'migrations/20260101000000_on_main';
const DRAFT = 'migrations/20260102000000_branch_only';

// A throwaway repo rather than this one. Reading real migrations made the suite depend
// on `origin/main` being fetched, and CI's unit job checks out without it — the spec
// threw at import and failed all 274 files rather than its own 7.
let repo: string;

function git(...args: string[]) {
	execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
}

beforeAll(() => {
	repo = mkdtempSync(join(tmpdir(), 'migration-guard-'));
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');

	mkdirSync(join(repo, SHIPPED), { recursive: true });
	writeFileSync(join(repo, SHIPPED, 'migration.sql'), 'SELECT 1;');
	git('add', '-A');
	git('commit', '-qm', 'shipped migration');
	// The ref the guard reads. Pointing it at this commit is what makes the migration
	// above "already on main" and the one below a draft.
	git('update-ref', 'refs/remotes/origin/main', 'HEAD');

	mkdirSync(join(repo, DRAFT), { recursive: true });
	writeFileSync(join(repo, DRAFT, 'migration.sql'), 'SELECT 2;');
	git('add', '-A');
	git('commit', '-qm', 'branch-only migration');
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

function run(command: string): { code: number; stderr: string } {
	try {
		execFileSync('bash', [script], {
			cwd: repo,
			input: JSON.stringify({ tool_input: { command } }),
			// stderr defaults to the parent's, which dumps every block message into the
			// test reporter. Pipe it — the assertions read it from the thrown error.
			stdio: ['pipe', 'pipe', 'pipe']
		});
		return { code: 0, stderr: '' };
	} catch (e) {
		const err = e as { status: number; stderr: Buffer };
		return { code: err.status, stderr: err.stderr.toString() };
	}
}

describe('block-shipped-migration-delete', () => {
	it('blocks deleting a migration that exists on origin/main', () => {
		const { code, stderr } = run(`git rm -r ${SHIPPED}`);
		expect(code).toBe(2);
		expect(stderr).toContain(SHIPPED);
	});

	// The whole point of the guard: this is the legitimate command it must not obstruct.
	it('allows deleting a migration only this branch has', () => {
		expect(run(`git rm -r ${DRAFT}`).code).toBe(0);
	});

	it('blocks a mixed delete that sweeps up a shipped migration', () => {
		expect(run(`rm -rf ${DRAFT} ${SHIPPED}`).code).toBe(2);
	});

	// `rm -rf migrations/` names no child directory, so a naive path scan sees nothing
	// to protect while the command destroys every migration in the repo.
	it('blocks deleting the migrations directory itself', () => {
		const { code, stderr } = run('rm -rf migrations/');
		expect(code).toBe(2);
		expect(stderr).toMatch(/\d+ migration\(s\)/);
	});

	it('blocks a shipped delete chained behind another command', () => {
		expect(run(`git fetch origin main && git rm -r ${SHIPPED}`).code).toBe(2);
	});

	it('ignores commands that read migrations without removing them', () => {
		expect(run('ls migrations/').code).toBe(0);
		expect(run('pnpm db:generate').code).toBe(0);
	});

	// The first version scanned the whole command string for `rm` and `migrations/`
	// independently, so writing the doc that explains how to collapse migrations was
	// blocked by the guard the doc describes. Only an `rm`'s own arguments count.
	it('ignores a command that merely mentions removing migrations in its text', () => {
		const doc = [
			"cat > docs/x.md <<'EOF'",
			'Collapse the branch migrations:',
			'  git log --diff-filter=A --name-only origin/main..HEAD -- migrations/',
			'  git rm -r <only the directories that listing names>',
			'EOF'
		].join('\n');
		expect(run(doc).code).toBe(0);
	});
});

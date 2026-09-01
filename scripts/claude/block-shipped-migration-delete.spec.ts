import { describe, it, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This guard is the only thing standing between "collapse this branch's own migrations
// after merging main" — a routine step of the integration-branch workflow — and deleting
// one that production has already applied, which no later migration can undo. The two
// commands differ by one directory name, so the distinction is worth pinning.
const script = join(dirname(fileURLToPath(import.meta.url)), 'block-shipped-migration-delete.sh');

// A real migration directory on origin/main. Reading one rather than hard-coding a name
// keeps the test honest if the oldest migration is ever renamed.
const shipped = execSync('git ls-tree --name-only origin/main migrations/', { encoding: 'utf8' })
	.split('\n')
	.filter(Boolean)[0];

function run(command: string): { code: number; stderr: string } {
	try {
		// stderr defaults to the parent's, which dumps every block message into the
		// test reporter. Pipe it — the assertions read it from the thrown error.
		execFileSync('bash', [script], {
			input: JSON.stringify({ tool_input: { command } }),
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
		const { code, stderr } = run(`git rm -r ${shipped}`);
		expect(code).toBe(2);
		expect(stderr).toContain(shipped);
	});

	// The whole point of the guard: this is the legitimate command it must not obstruct.
	it('allows deleting a migration only this branch has', () => {
		expect(run('git rm -r migrations/29991231000000_branch_only').code).toBe(0);
	});

	it('blocks a mixed delete that sweeps up a shipped migration', () => {
		expect(run(`rm -rf migrations/29991231000000_branch_only ${shipped}`).code).toBe(2);
	});

	// `rm -rf migrations/` names no child directory, so a naive path scan sees nothing to
	// protect while the command destroys every migration in the repo.
	it('blocks deleting the migrations directory itself', () => {
		const { code, stderr } = run('rm -rf migrations/');
		expect(code).toBe(2);
		expect(stderr).toMatch(/\d+ migration\(s\)/);
	});

	it('ignores commands that read migrations without removing them', () => {
		expect(run('ls migrations/').code).toBe(0);
		expect(run('pnpm db:generate').code).toBe(0);
	});

	// The first version scanned the whole command string for `rm` and `migrations/`
	// independently, so writing the doc that explains how to collapse migrations was
	// blocked by the guard the doc describes. Only an `rm`'s own arguments count.
	it('ignores a command that merely mentions removing migrations elsewhere in its text', () => {
		const doc = [
			"cat > docs/x.md <<'EOF'",
			'Collapse the branch migrations:',
			'  git log --diff-filter=A --name-only origin/main..HEAD -- migrations/',
			'  git rm -r <only the directories that listing names>',
			'EOF'
		].join('\n');
		expect(run(doc).code).toBe(0);
	});

	// `git rm migrations/<dir>` split across a chained command still has to be caught.
	it('blocks a shipped delete chained behind another command', () => {
		expect(run(`git fetch origin main && git rm -r ${shipped}`).code).toBe(2);
	});
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
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

/**
 * The scenarios `drizzle-kit check` cannot see, which is #672: pruning keeps one
 * snapshot per side, so a fork of more than one migration each leaves two snapshots
 * whose parents are both absent and `check` calls that fine. Both shapes below were
 * real reconciles — `feature/uloc-rework` and `feature/band-packing-list` — where
 * `check` and `pnpm db:reset` passed and CI's `generate` step failed.
 */
const scenarios: string[] = [];

/** A repo with a real `origin`, so the guard's `git fetch` succeeds and its stderr carries only what it decided to say. */
function makeRepo(prefix: string) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	const bare = `${dir}-origin.git`;
	scenarios.push(dir, bare);
	const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });

	g('init', '-q', '-b', 'main');
	g('config', 'user.email', 'test@example.com');
	g('config', 'user.name', 'Test');
	const migration = (name: string, snapshot: boolean) => {
		mkdirSync(join(dir, 'migrations', name), { recursive: true });
		writeFileSync(join(dir, 'migrations', name, 'migration.sql'), `-- ${name}\n`);
		if (snapshot) writeFileSync(join(dir, 'migrations', name, 'snapshot.json'), '{"id":"x"}');
	};
	const commit = (message: string) => {
		g('add', '-A');
		g('commit', '-qm', message);
	};

	migration('20260101000000_ancestor', false);
	commit('base');
	execFileSync('git', ['clone', '--bare', '--quiet', dir, bare], { stdio: 'pipe' });
	g('remote', 'add', 'origin', bare);
	g('fetch', '-q', 'origin', 'main');

	/** Land a migration on `origin/main` without putting it in this branch's history. */
	const landOnMain = (name: string, snapshot = true) => {
		g('checkout', '-q', '-B', 'upstream', 'origin/main');
		migration(name, snapshot);
		commit(`main: ${name}`);
		g('push', '-q', 'origin', 'upstream:main');
		g('fetch', '-q', 'origin', 'main');
		g('checkout', '-q', '-f', 'main');
		g('branch', '-qD', 'upstream');
		execFileSync('git', ['clean', '-qfd', 'migrations'], { cwd: dir, stdio: 'pipe' });
	};

	return { dir, g, migration, commit, landOnMain };
}

/**
 * A stand-in for `drizzle-kit`, answering per subcommand. `check` is the signal that
 * used to be trusted, so every scenario here has it report a clean lineage.
 */
function stubKit(dir: string, name: string, opts: { check?: string; emits?: string }) {
	const path = join(dir, name);
	const emit = opts.emits
		? `mkdir -p "$out/${opts.emits}"\n` +
			`printf 'CREATE TABLE \`probe\` (\`id\` text PRIMARY KEY);\\n' > "$out/${opts.emits}/migration.sql"\n`
		: '';
	writeFileSync(
		path,
		`#!/usr/bin/env bash\n` +
			`sub=$1; shift\n` +
			`out=""\n` +
			`while [ $# -gt 0 ]; do case "$1" in --out) out=$2; shift 2;; *) shift;; esac; done\n` +
			`if [ "$sub" = check ]; then\n` +
			(opts.check
				? `  cat <<'OUT'\n${opts.check}\nOUT\n  exit 1\n`
				: `  echo "Everything's fine"\n  exit 0\n`) +
			`fi\n` +
			emit +
			`echo "No schema changes, nothing to migrate"\n`
	);
	chmodSync(path, 0o755);
	return path;
}

function ask(cwd: string, kit: string, env: NodeJS.ProcessEnv = {}) {
	// `spawnSync`, not `execFileSync`: what the guard says while still exiting 0 is
	// half of what is being tested here, and only the former hands back that stderr.
	const result = spawnSync('bash', [script], {
		cwd,
		input: JSON.stringify({ tool_input: { command: 'gh pr merge 1 --auto' } }),
		env: { ...process.env, DRIZZLE_KIT_BIN: kit, ...env },
		encoding: 'utf8'
	});
	return { code: result.status ?? 0, stdout: result.stdout, stderr: result.stderr };
}

afterAll(() => scenarios.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('block-forked-migration-merge, on a lineage check cannot see', () => {
	it('blocks when main and this branch have each added migrations since the merge base', () => {
		// `feature/uloc-rework`: three against three, one surviving snapshot per side.
		const repo = makeRepo('fork-both-sides-');
		repo.landOnMain('20260102000000_on_main_a', false);
		repo.landOnMain('20260102000001_on_main_b');
		repo.migration('20260103000000_branch_a', false);
		repo.migration('20260103000001_branch_b', true);
		repo.commit('branch migrations');

		const { code, stderr } = ask(repo.dir, stubKit(repo.dir, 'kit.sh', {}));
		expect(code).toBe(2);
		expect(stderr).toContain('20260102000001_on_main_b');
		expect(stderr).toContain('20260103000001_branch_b');
	});

	it('points at collapsing this branch, which is not what anybody guesses', () => {
		const repo = makeRepo('fork-remedy-');
		repo.landOnMain('20260102000000_on_main');
		repo.migration('20260103000000_branch', true);
		repo.commit('branch migration');

		const { stderr } = ask(repo.dir, stubKit(repo.dir, 'kit.sh', {}));
		expect(stderr).toContain('pnpm db:generate');
		expect(stderr).toContain('--diff-filter=A');
	});

	it('blocks when generate still has a migration to emit against the merged tree', () => {
		// `feature/band-packing-list`: main is merged in, this branch's own migrations
		// were never collapsed onto it, and the newest snapshot is main's.
		const repo = makeRepo('fork-generate-');
		repo.migration('20260103000000_branch', true);
		repo.commit('branch migration');

		const kit = stubKit(repo.dir, 'kit.sh', { emits: '20260104000000_still_missing' });
		const { code, stderr } = ask(repo.dir, kit);
		expect(code).toBe(2);
		expect(stderr).toContain('CREATE TABLE');
		expect(stderr).toContain('20260103000000_branch');
	});

	it('stays quiet on a branch whose migrations sit on top of main, with generate a no-op', () => {
		const repo = makeRepo('fork-clean-');
		repo.migration('20260103000000_branch', true);
		repo.commit('branch migration');

		const { code, stderr } = ask(repo.dir, stubKit(repo.dir, 'kit.sh', {}));
		expect(code).toBe(0);
		expect(stderr).toBe('');
	});

	it('stays quiet when only the newest migration kept its snapshot', () => {
		// What `prune-snapshots.mjs` leaves behind, which is every clean checkout.
		const repo = makeRepo('fork-pruned-');
		repo.migration('20260103000000_branch_a', false);
		repo.migration('20260103000001_branch_b', false);
		repo.migration('20260103000002_branch_c', true);
		repo.commit('branch migrations, pruned');

		const { code, stderr } = ask(repo.dir, stubKit(repo.dir, 'kit.sh', {}));
		expect(code).toBe(0);
		expect(stderr).toBe('');
	});

	it('says on stderr when it could not build the merged tree', () => {
		// #672: a transient `tar` or `mktemp` failure exited 0 with no output, so a
		// run that never evaluated anything was indistinguishable from a clean one.
		const repo = makeRepo('fork-broken-tar-');
		repo.migration('20260103000000_branch', true);
		repo.commit('branch migration');
		const shims = join(repo.dir, 'shims');
		mkdirSync(shims, { recursive: true });
		writeFileSync(join(shims, 'tar'), '#!/usr/bin/env bash\nexit 1\n');
		chmodSync(join(shims, 'tar'), 0o755);

		const { code, stderr } = ask(repo.dir, stubKit(repo.dir, 'kit.sh', {}), {
			PATH: `${shims}:${process.env.PATH}`
		});
		expect(code).toBe(0);
		expect(stderr).toContain('not evaluated');
	});

	it('says on stderr when drizzle-kit errored for a reason that is not a fork', () => {
		const repo = makeRepo('fork-broken-kit-');
		repo.migration('20260103000000_branch', true);
		repo.commit('branch migration');

		const kit = stubKit(repo.dir, 'kit.sh', { check: 'ERR_MODULE_NOT_FOUND: drizzle-kit' });
		const { code, stderr } = ask(repo.dir, kit);
		expect(code).toBe(0);
		expect(stderr).toContain('not evaluated');
	});
});

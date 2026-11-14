import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The queue ejects a PR that conflicts with one merged ahead of it, with no run to read. The
// check has to see that from the pushed heads alone, so each case builds a throwaway origin with
// `refs/pull/<n>/head` refs and hands the script the GitHub state as a fixture.
const script = join(dirname(fileURLToPath(import.meta.url)), 'pre-arm-check.mjs');

let root: string;
let origin: string;
let work: string;

function git(...args: string[]) {
	return execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: 'pipe' }).trim();
}

/** Commits `content` to `file` on a branch cut from `from`, and publishes it as PR `n`. */
function pr(n: number, from: string, file: string, content: string): string {
	git('checkout', '-q', '-B', `pr-${n}`, from);
	writeFileSync(join(work, file), content);
	git('add', '-A');
	git('commit', '-qm', `pr ${n}`);
	git('push', '-q', '-f', 'origin', `HEAD:refs/pull/${n}/head`);
	return git('rev-parse', 'HEAD');
}

type Other = { number: number; queued?: boolean; armed?: boolean; merged?: boolean; oid: string };

function run(subject: number, others: Other[], subjectOid = '') {
	const fixture = join(root, 'state.json');
	writeFileSync(
		fixture,
		JSON.stringify({
			subject: {
				number: subject,
				headRefName: `pr-${subject}`,
				headRefOid: subjectOid,
				title: 'subject'
			},
			others: others.map((o) => ({
				number: o.number,
				headRefName: `pr-${o.number}`,
				headRefOid: o.oid,
				title: `pr ${o.number}`,
				queued: o.queued ?? false,
				armed: o.armed ?? false,
				merged: o.merged ?? false
			}))
		})
	);
	const r = spawnSync('node', [script, String(subject)], {
		cwd: work,
		encoding: 'utf8',
		env: { ...process.env, PRE_ARM_FIXTURE: fixture }
	});
	return { exit: r.status, out: r.stdout + r.stderr };
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'pre-arm-'));
	origin = join(root, 'origin.git');
	work = join(root, 'work');
	execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
	execFileSync('git', ['init', '-q', '-b', 'main', work]);
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	git('remote', 'add', 'origin', origin);
	writeFileSync(join(work, 'nav.ts'), 'a\nb\nc\n');
	writeFileSync(join(work, 'other.ts'), 'x\n');
	git('add', '-A');
	git('commit', '-qm', 'base');
	git('push', '-q', 'origin', 'main');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('pre-arm-check', () => {
	it('clears a PR that merges cleanly with main and the queue', () => {
		const queued = pr(2, 'main', 'nav.ts', 'a\nb\nC\n');
		pr(1, 'main', 'other.ts', 'y\n');
		const r = run(1, [{ number: 2, queued: true, oid: queued }]);
		expect(r.exit).toBe(0);
	});

	it('sends a PR that conflicts with main to rebase', () => {
		pr(1, 'main', 'nav.ts', 'A\nb\nc\n');
		git('checkout', '-q', 'main');
		writeFileSync(join(work, 'nav.ts'), 'Z\nb\nc\n');
		git('commit', '-qam', 'main moves');
		git('push', '-q', 'origin', 'main');
		const r = run(1, []);
		expect(r.exit).toBe(1);
		expect(r.out).toContain('nav.ts');
	});

	it('stacks a PR on the one queued PR it conflicts with', () => {
		const queued = pr(2, 'main', 'nav.ts', 'Q\nb\nc\n');
		pr(1, 'main', 'nav.ts', 'S\nb\nc\n');
		const r = run(1, [{ number: 2, queued: true, oid: queued }]);
		expect(r.exit).toBe(2);
		expect(r.out).toContain('pull/2/head');
	});

	it('skips an armed PR that cannot enter the queue because it conflicts with main', () => {
		const armed = pr(2, 'main', 'nav.ts', 'Q\nb\nc\n');
		git('checkout', '-q', 'main');
		writeFileSync(join(work, 'nav.ts'), 'Z\nb\nc\n');
		git('commit', '-qam', 'main moves');
		git('push', '-q', 'origin', 'main');
		pr(1, 'main', 'nav.ts', 'Z\nb\nS\n');
		const r = run(1, [{ number: 2, armed: true, oid: armed }]);
		expect(r.exit).toBe(0);
	});

	it('accepts a stack whose base is still queued', () => {
		const base = pr(2, 'main', 'nav.ts', 'Q\nb\nc\n');
		pr(1, 'pr-2', 'nav.ts', 'Q\nb\nS\n');
		const r = run(1, [{ number: 2, queued: true, oid: base }]);
		expect(r.exit).toBe(0);
		expect(r.out).toContain('Stacked on #2');
	});

	it('reads the head GitHub reports when the pull ref has not moved yet', () => {
		pr(1, 'main', 'other.ts', 'y\n');
		const queued = pr(2, 'main', 'nav.ts', 'Q\nb\nc\n');
		git('checkout', '-q', 'pr-1');
		writeFileSync(join(work, 'nav.ts'), 'S\nb\nc\n');
		git('commit', '-qam', 'pushed, pull ref not yet moved');
		git('push', '-q', 'origin', 'HEAD:refs/heads/pr-1');
		const r = run(1, [{ number: 2, queued: true, oid: queued }], git('rev-parse', 'HEAD'));
		expect(r.exit).toBe(2);
	});

	it('sends a stack back to main when its base left the queue without merging', () => {
		const base = pr(2, 'main', 'nav.ts', 'Q\nb\nc\n');
		pr(1, 'pr-2', 'nav.ts', 'Q\nb\nS\n');
		const r = run(1, [{ number: 2, oid: base }]);
		expect(r.exit).toBe(3);
		expect(r.out).toContain(`git rebase --onto origin/main ${base}`);
	});
});

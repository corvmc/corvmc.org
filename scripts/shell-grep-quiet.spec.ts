import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// `cmd | grep -q` under pipefail answers "no match" whenever grep matches and exits
// before the writer finishes: the writer takes SIGPIPE and the pipeline fails. That
// is load-dependent, so it passes locally and flakes in CI (#3169). GitHub Actions
// runs `run:` steps with pipefail too. Feed grep a here-string or a file instead.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quietGrepInPipe = /\|\s*grep\b[^|]*?\s(-[A-Za-z]*q[A-Za-z]*|--quiet|--silent)(\s|$)/;

const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
	.split('\n')
	.filter((f) => /\.sh$|^\.husky\/[^/]+$|^\.github\/.*\.ya?ml$/.test(f));

describe('shell pipelines', () => {
	it('finds the shell and workflow files it is meant to scan', () => {
		expect(files).toContain('scripts/claude/block-forked-migration-merge.sh');
		expect(files.some((f) => f.startsWith('.github/workflows/'))).toBe(true);
	});

	it('never pipe into a quiet grep', () => {
		const offenders = files.flatMap((file) =>
			readFileSync(join(root, file), 'utf8')
				.split('\n')
				.flatMap((line, i) => (quietGrepInPipe.test(line) ? [`${file}:${i + 1}`] : []))
		);
		expect(offenders).toEqual([]);
	});

	it('recognises the shape that flaked', () => {
		expect(quietGrepInPipe.test(`if printf '%s' "$r" | grep -q 'x'; then`)).toBe(true);
		expect(quietGrepInPipe.test(`printf '%s\\n' "$s" | grep -qE 'a|b'`)).toBe(true);
		expect(quietGrepInPipe.test(`if grep -q 'x' <<<"$r"; then`)).toBe(false);
	});
});

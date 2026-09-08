/**
 * Which commands are a local re-run of a CI job, and which CI job covers them.
 *
 * Every gate in this repo has a job in `.github/workflows/ci.yml` that runs it
 * on the PR and again on the merge-queue ref, so a whole-tree run on a laptop
 * cannot change an outcome — it can only delay the push. It is also worse at
 * answering than the runner is: several worktree sessions share one machine,
 * where a starved ESLint is indistinguishable from a violation and an
 * OOM-killed vitest prints `[killed]` and no summary.
 *
 * A *scoped* run is a different thing and stays allowed — it is the only local
 * check that finds something CI would find later, so the whole matcher turns on
 * one question: does this command name a path?
 */
import { commandSegments } from './command-segments.mjs';

/**
 * Flags that swallow the token after them. Without this list `--project server`
 * would read as a path and scope a run that has none.
 */
const VALUE_FLAGS = new Set([
	'--max-warnings',
	'--project',
	'-p',
	'--reporter',
	'--config',
	'-c',
	'--outputFile',
	'--pool',
	'--workers',
	'--repeat-each',
	'--grep',
	'-g',
	'--shard'
]);

/**
 * `--` is forwarded literally by pnpm rather than consumed, so it shows up as
 * an argument (see `scripts/lib/forwarded-args.ts`). `.` is a path that scopes
 * nothing.
 *
 * A bare number is never a path either. The list above cannot be complete —
 * every runner here has its own value-taking flags — and the miss that found
 * this was `eslint . --max-warnings 0`, which is `pnpm lint` spelled out: the
 * `0` read as a scope and the whole-tree lint walked straight through. Failing
 * that way is the wrong direction, so numbers are excluded by shape rather than
 * by knowing which flag they followed.
 */
/** @param {string[]} args */
function hasPathArg(args) {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--') continue;
		if (arg.startsWith('-')) {
			if (VALUE_FLAGS.has(arg)) i++;
			continue;
		}
		if (arg === '.' || arg === './') continue;
		if (/^\d+$/.test(arg)) continue;
		return true;
	}
	return false;
}

/**
 * Leading `VAR=value` assignments, removed. `CMC_FULL_GATE=1` is the escape
 * hatch: it means a human asked for this run in this turn, so the segment
 * carrying it is not this guard's business.
 *
 * @param {string[]} tokens
 * @returns {string[] | null} null when `CMC_FULL_GATE` is set — the caller asked for the run.
 */
function withoutEnv(tokens) {
	let i = 0;
	while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
		const [name, ...value] = tokens[i].split('=');
		if (name === 'CMC_FULL_GATE' && value.join('=') !== '') return null;
		i++;
	}
	return tokens.slice(i);
}

/** The CI job that already covers a pnpm script, or `undefined` if it is fine. */
/** @param {string} script @param {string[]} args */
function pnpmScript(script, args) {
	if (script === 'test:e2e' || script === 'test:e2e:run' || script === 'test:e2e:prepare')
		return 'E2E';
	if (script === 'test') return 'Unit tests and E2E';
	if (script === 'lint') return 'Lint (full)';
	if (script === 'test:unit' && args.includes('--run') && !hasPathArg(args)) return 'Unit tests';
	if ((script === 'test:server' || script === 'test:components') && !hasPathArg(args))
		return 'Unit tests';
	return undefined;
}

/** The CI job that already covers a directly-invoked binary. */
/** @param {string} bin @param {string[]} args */
function binary(bin, args) {
	if (bin === 'vitest' && !hasPathArg(args)) return 'Unit tests';
	if (bin === 'playwright' && args[0] === 'test') return 'E2E';
	if (bin === 'eslint' && !hasPathArg(args)) return 'Lint (full)';
	return undefined;
}

/**
 * The first segment of `command` that duplicates a CI job, or `null`.
 * Returns `{ segment, job }` so the guard can name both.
 */
/** @param {string} command */
export function redundantGate(command) {
	for (const segment of commandSegments(command)) {
		const tokens = withoutEnv(segment.split(/\s+/));
		if (tokens === null || tokens.length === 0) continue;

		const [head, ...rest] = tokens;
		let job;

		if (head === 'pnpm') {
			// `pnpm run lint` and `pnpm lint` are the same invocation.
			const args = rest[0] === 'run' ? rest.slice(1) : rest;
			job =
				args[0] === 'exec' ? binary(args[1], args.slice(2)) : pnpmScript(args[0], args.slice(1));
		} else {
			job = binary(head, rest);
		}

		if (job) return { segment, job };
	}

	return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const { readPayload } = await import('./command-segments.mjs');
	const hit = redundantGate(await readPayload());
	if (hit) process.stdout.write(`${hit.job}\t${hit.segment}`);
}

#!/usr/bin/env node
/**
 * Pre-arm conflict check: run before `gh pr merge --auto`.
 *
 *   node scripts/claude/pre-arm-check.mjs <pr> [--repo owner/name]
 *
 * The queue drops a PR that conflicts with one merged ahead of it as UNMERGEABLE, with no
 * `merge_group` run and no guard comment. This merges the PR's pushed head, in memory, against
 * `main` and against every PR in the merge queue or armed for auto-merge, and names what to do.
 *
 * Exit codes, most urgent first:
 *   3  stacked on a PR that left the queue without merging: rebase back onto main
 *   1  conflicts with main: rebase onto main
 *   2  conflicts with a queued or armed PR: stack on it, or wait for it
 *   0  clear to arm
 *   4  usage or git/gh error
 *
 * `PRE_ARM_FIXTURE=<file.json>` replaces the GitHub query with a `State`, for the spec.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ number: number, headRefName: string, headRefOid: string, title: string }} PrRef
 * @typedef {PrRef & { queued: boolean, armed: boolean, merged: boolean }} Pr
 * @typedef {{ subject: PrRef & { isCrossRepository?: boolean }, others: Pr[] }} State
 * @typedef {{ pr: Pr, files: string[] }} Overlap
 * @typedef {{ exit: number, lines: string[] }} Verdict
 */

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Files that conflict when `theirs` is merged into `ours`; empty when the merge is clean.
 *
 * @param {string} cwd @param {string} ours @param {string} theirs
 * @returns {string[]}
 */
export function conflicts(cwd, ours, theirs) {
	const r = spawnSync(
		'git',
		['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs],
		{ cwd, encoding: 'utf8' }
	);
	if (r.status === 0) return [];
	if (r.status === 1) return [...new Set(r.stdout.split('\n').slice(1).filter(Boolean))];
	throw new Error(`git merge-tree ${ours} ${theirs}: ${r.stderr.trim()}`);
}

/** A missing object reads as "no": a PR head that is not in our history is not under us. */
function isAncestor(/** @type {string} */ cwd, /** @type {string} */ a, /** @type {string} */ b) {
	return spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd }).status === 0;
}

const ref = (/** @type {number} */ n) => `refs/pre-arm/${n}`;
const label = (/** @type {Pr} */ p) =>
	`#${p.number} (${p.queued ? 'queued' : p.armed ? 'armed' : p.merged ? 'merged' : 'open'})`;

/**
 * Fetches the heads the check merges: `main`, the subject, and every queued or armed PR. Pull refs
 * rather than branches, so a PR from a fork or with a renamed branch still resolves. A pull ref
 * and the head GitHub reports both lag a push by seconds; the branch does not, so the subject is
 * read from its branch when that is in this repository.
 *
 * @param {string} cwd @param {State} state
 */
export function fetchHeads(cwd, state) {
	const prs = [state.subject, ...ahead(state)];
	git(cwd, [
		'fetch',
		'-q',
		'origin',
		'+refs/heads/main:refs/remotes/origin/main',
		...prs.map((p) => `+refs/pull/${p.number}/head:${ref(p.number)}`)
	]);
	for (const p of prs) {
		if (!p.headRefOid || git(cwd, ['rev-parse', ref(p.number)]).trim() === p.headRefOid) continue;
		git(cwd, ['fetch', '-q', 'origin', p.headRefOid]);
		git(cwd, ['update-ref', ref(p.number), p.headRefOid]);
	}
	const { number, headRefName, isCrossRepository } = state.subject;
	if (isCrossRepository) return;
	try {
		git(cwd, ['fetch', '-q', 'origin', `+refs/heads/${headRefName}:${ref(number)}`]);
	} catch {
		// The branch is gone or was renamed; the pull ref stands.
	}
}

/** Files `main` has changed since `pr` branched from it. */
function movedOnMain(
	/** @type {string} */ cwd,
	/** @type {string} */ pr,
	/** @type {string} */ main
) {
	const base = git(cwd, ['merge-base', pr, main]).trim();
	return git(cwd, ['diff', '--name-only', base, main]).split('\n').filter(Boolean);
}

const ahead = (/** @type {State} */ s) => s.others.filter((p) => p.queued || p.armed);

/**
 * @param {string} cwd @param {State} state
 * @returns {Verdict}
 */
export function check(cwd, state) {
	const subject = ref(state.subject.number);
	const main = 'refs/remotes/origin/main';
	/** @type {string[]} */
	const lines = [
		`Checked #${state.subject.number} at ${git(cwd, ['rev-parse', '--short', subject]).trim()}`
	];

	// A PR whose commits sit under ours and are not in main: we are stacked on it.
	const bases = state.others.filter(
		(p) => isAncestor(cwd, p.headRefOid, subject) && !isAncestor(cwd, p.headRefOid, main)
	);
	const stale = bases.filter((p) => !p.queued && !p.armed && !p.merged);
	for (const p of bases) {
		lines.push(`Stacked on ${label(p)} ${p.title}`);
		lines.push(`  to unstack: git rebase --onto origin/main ${p.headRefOid}`);
	}

	const onMain = conflicts(cwd, subject, main);
	// An armed PR that conflicts with main cannot enter the queue, so it is not ahead of us.
	const blocked = ahead(state).filter((p) => conflicts(cwd, ref(p.number), main).length > 0);
	/** @type {Overlap[]} */
	const overlaps = ahead(state)
		.filter((p) => !blocked.includes(p))
		.map((pr) => ({ pr, files: conflicts(cwd, subject, ref(pr.number)) }))
		.filter((o) => o.files.length > 0);

	for (const p of blocked) lines.push(`Skipped ${label(p)}: it conflicts with main itself`);
	if (onMain.length) lines.push(`Conflicts with main: ${onMain.join(', ')}`);
	for (const o of overlaps) lines.push(`Conflicts with ${label(o.pr)}: ${o.files.join(', ')}`);

	if (stale.length) {
		const p = stale[0];
		lines.push(
			`Next: #${p.number} left the queue without merging, so arming would carry its commits into main.`,
			`  git rebase --onto origin/main ${p.headRefOid} && git push --force-with-lease`
		);
		return { exit: 3, lines };
	}
	if (onMain.length) {
		lines.push(
			'Next: rebase onto main, push, wait for the new checks to start, then check again.',
			'  git fetch origin main && git rebase origin/main && git push --force-with-lease'
		);
		return { exit: 1, lines };
	}
	if (overlaps.length === 1) {
		const p = overlaps[0].pr;
		// A stack on a base behind main inherits the base's distance from main in these files.
		const moved = movedOnMain(cwd, ref(p.number), main).filter((f) =>
			overlaps[0].files.includes(f)
		);
		if (moved.length) {
			lines.push(
				`Next: wait for #${p.number} to merge. main has changed ${moved.join(', ')} since it branched,`,
				'  so a stack on it would conflict with main. Rebase onto main after it merges.'
			);
			return { exit: 2, lines };
		}
		lines.push(
			`Next: stack on #${p.number}, push, wait for the new checks to start, then arm.`,
			`  git fetch origin pull/${p.number}/head && git rebase FETCH_HEAD && git push --force-with-lease`,
			`  if #${p.number} leaves the queue without merging: git rebase --onto origin/main ${p.headRefOid}`
		);
		return { exit: 2, lines };
	}
	if (overlaps.length > 1) {
		lines.push(
			`Next: wait. A stack carries one base; ${overlaps.map((o) => `#${o.pr.number}`).join(', ')} all overlap.`,
			'  Rebase onto main after they merge, then check again.'
		);
		return { exit: 2, lines };
	}
	lines.push(
		`Clear to arm: no conflict with main or the ${ahead(state).length - blocked.length} PRs ahead.`
	);
	return { exit: 0, lines };
}

const QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $n) { number headRefName headRefOid title isCrossRepository }
    mergeQueue { entries(first: 100) { nodes { pullRequest { number } } } }
    open: pullRequests(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number headRefName headRefOid title autoMergeRequest { enabledAt } }
    }
    merged: pullRequests(states: MERGED, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number headRefName headRefOid title }
    }
  }
}`;

/**
 * @param {string} repo @param {number} n
 * @returns {State}
 */
function fetchState(repo, n) {
	const [owner, name] = repo.split('/');
	const out = execFileSync(
		'gh',
		[
			'api',
			'graphql',
			'-f',
			`query=${QUERY}`,
			'-F',
			`owner=${owner}`,
			'-F',
			`name=${name}`,
			'-F',
			`n=${n}`
		],
		{ encoding: 'utf8' }
	);
	const r = JSON.parse(out).data.repository;
	const queued = new Set(
		r.mergeQueue.entries.nodes.map((/** @type {any} */ e) => e.pullRequest.number)
	);
	/** @type {Pr[]} */
	const others = [
		...r.open.nodes.map((/** @type {any} */ p) => ({
			...p,
			queued: queued.has(p.number),
			armed: p.autoMergeRequest !== null,
			merged: false
		})),
		...r.merged.nodes.map((/** @type {any} */ p) => ({
			...p,
			queued: false,
			armed: false,
			merged: true
		}))
	].filter((p) => p.number !== n);
	return { subject: r.pullRequest, others };
}

function main() {
	const args = process.argv.slice(2);
	const n = Number(args[0]);
	if (!Number.isInteger(n) || n <= 0) {
		console.error('usage: node scripts/claude/pre-arm-check.mjs <pr> [--repo owner/name]');
		process.exit(4);
	}
	const cwd = process.cwd();
	try {
		const fixture = process.env.PRE_ARM_FIXTURE;
		const i = args.indexOf('--repo');
		const repo = () =>
			i === -1
				? execFileSync(
						'gh',
						['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
						{
							encoding: 'utf8'
						}
					).trim()
				: args[i + 1];
		/** @type {State} */
		const state = fixture ? JSON.parse(readFileSync(fixture, 'utf8')) : fetchState(repo(), n);
		fetchHeads(cwd, state);
		const verdict = check(cwd, state);
		for (const line of verdict.lines) console.log(line);
		process.exit(verdict.exit);
	} catch (e) {
		console.error(String(e instanceof Error ? e.message : e));
		process.exit(4);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

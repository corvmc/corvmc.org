#!/usr/bin/env node
/**
 * Follow one PR from "armed" to an outcome a session has to act on, then exit.
 *
 *   node scripts/claude/pr-await.mjs <pr> [--interval <sec>] [--timeout <min>]
 *
 * Run it with `run_in_background` right after `gh pr merge --auto`: the session is woken when it
 * exits, so nobody has to remember to look. Exit codes are the contract:
 *
 *   0 merged · 1 rejected by the queue · 3 stuck before the queue (red required check or a
 *   conflict) · 4 closed, or auto-merge switched off · 2 timed out
 */
import { execFileSync } from 'node:child_process';
import { classify, fetchPr, requiredChecks, REPO } from './lib/pr-state.mjs';

const args = process.argv.slice(2);
const n = Number(args[0]);
/** @param {string} flag @param {number} fallback */
const opt = (flag, fallback) => {
	const i = args.indexOf(flag);
	return i === -1 ? fallback : Number(args[i + 1]);
};
if (!Number.isInteger(n) || n <= 0) {
	console.error('usage: pr-await.mjs <pr> [--interval <sec>] [--timeout <min>]');
	process.exit(64);
}
const intervalMs = opt('--interval', 60) * 1000;
const deadline = Date.now() + opt('--timeout', 120) * 60_000;

/** @type {Record<string, number>} */
const EXIT = { merged: 0, rejected: 1, stuck: 3, closed: 4, unarmed: 4 };
// Seen twice in a row before acting: GitHub drops the armed flag a moment before the queue entry
// appears, and a single reading in that gap looks exactly like a disarmed PR.
const NEEDS_CONFIRMING = new Set(['rejected', 'stuck', 'unarmed']);

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 16);

/** The guard's most recent comment, which names what failed. */
function guardComment() {
	const out = execFileSync(
		'gh',
		[
			'api',
			`repos/${REPO.owner}/${REPO.name}/issues/${n}/comments`,
			'--jq',
			'[.[] | select(.user.type == "Bot")] | last | .body // ""'
		],
		{ encoding: 'utf8' }
	);
	return out.split('\n').slice(0, 60).join('\n');
}

const required = requiredChecks();
let previous = '';
let pendingTerminal = '';

while (Date.now() < deadline) {
	let state;
	try {
		state = classify(fetchPr(n), required);
	} catch (e) {
		console.log(`${stamp()} gh failed, retrying: ${String(e).split('\n')[0]}`);
		await sleep(intervalMs);
		continue;
	}

	if (state.detail !== previous) console.log(`${stamp()} #${n} ${state.status}: ${state.detail}`);
	previous = state.detail;

	if (state.status in EXIT) {
		if (NEEDS_CONFIRMING.has(state.status) && pendingTerminal !== state.status) {
			pendingTerminal = state.status;
			await sleep(Math.min(intervalMs, 20_000));
			continue;
		}
		if (state.status === 'rejected') console.log(`\n${guardComment()}`);
		for (const c of state.failing) console.log(`  ${c.name}: ${c.url}`);
		process.exit(EXIT[state.status]);
	}
	pendingTerminal = '';
	await sleep(intervalMs);
}
console.log(`${stamp()} #${n} timed out; last: ${previous}`);
process.exit(2);

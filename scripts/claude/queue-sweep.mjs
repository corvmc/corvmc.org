#!/usr/bin/env node
/**
 * One pass over the open PRs, reporting each one that needs a person or a session.
 *
 *   node scripts/claude/queue-sweep.mjs [--notify]
 *
 * Reports PRs the queue rejected, PRs armed but stuck before the queue (a red required check or
 * a conflict — the guard never sees these), and non-bot PRs ready but never armed. `--notify` posts
 * a macOS notification for each one not already reported for the same head commit, so the launchd
 * job can run it every few minutes without repeating itself. Exit 1 when anything needs attention.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { classify, fetchPr, mainRedIssues, openPrs, requiredChecks } from './lib/pr-state.mjs';

const notify = process.argv.includes('--notify');
const SEEN = join(homedir(), 'Library/Caches/corvmc/queue-sweep.json');

const required = requiredChecks();
const red = mainRedIssues();

/** @type {{ key: string, line: string }[]} */
const attention = [];
for (const { number, isBot, isDraft } of openPrs()) {
	if (isDraft) continue;
	const pr = fetchPr(number);
	const state = classify(pr, required);
	const wanted =
		state.status === 'rejected' ||
		state.status === 'stuck' ||
		(state.status === 'unarmed' && !isBot);
	if (!wanted) continue;
	attention.push({
		key: `${number}:${state.status}:${pr.headSha}`,
		line: `#${number} ${state.status}: ${state.detail} — ${pr.title}`
	});
}

if (red.length > 0)
	console.log(
		`main is red (${red.map((/** @type {{ number: number }} */ i) => `#${i.number}`).join(', ')}): a queue rejection may not be the PR's own fault`
	);
for (const a of attention) console.log(a.line);
if (attention.length === 0) console.log('nothing stranded');

if (notify) {
	/** @type {string[]} */
	const seen = existsSync(SEEN) ? JSON.parse(readFileSync(SEEN, 'utf8')) : [];
	for (const a of attention.filter((a) => !seen.includes(a.key))) {
		// osascript takes the text as an argument, so a PR title cannot break out of the script.
		execFileSync('osascript', [
			'-e',
			'on run argv',
			'-e',
			'display notification (item 1 of argv) with title "Merge queue" sound name "Submarine"',
			'-e',
			'end run',
			a.line
		]);
	}
	mkdirSync(dirname(SEEN), { recursive: true });
	writeFileSync(SEEN, JSON.stringify(attention.map((a) => a.key)));
}

process.exit(attention.length > 0 ? 1 : 0);

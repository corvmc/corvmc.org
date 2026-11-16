// Which `merge_group` run a dequeued PR belongs to, and what its jobs say about the removal.
//
// `.github/workflows/merge-queue-guard.yml` calls this. It is a file rather than more shell for
// the reason `queue-guard-failures.mjs` is: `queue-guard-run.spec.ts` can hold it to real shapes.

/**
 * The newest run for this PR, whatever its status. The queue dequeues on the first failed required
 * job, while other jobs still run, so an overall conclusion may not exist yet. `gh run list` returns
 * newest first; an older run of the same PR belongs to an earlier time in the queue.
 *
 * @template {{ headBranch: string }} Run
 * @param {Run[]} runs
 * @param {string | number} pr
 * @returns {Run | undefined}
 */
export function selectRun(runs, pr) {
	return runs.find((run) => run.headBranch.includes(`/pr-${pr}-`));
}

/**
 * @param {{ conclusion: string, failed: string, timedout: string }} run
 *   `conclusion` is empty while the run is going; `failed` and `timedout` name jobs, or are empty.
 * @returns {'failed' | 'timeout' | 'superseded' | 'run-failed' | 'no-failure'}
 */
export function classifyRun({ conclusion, failed, timedout }) {
	if (failed) return 'failed';
	if (timedout) return 'timeout';
	if (conclusion === 'cancelled') return 'superseded';
	if (conclusion === 'failure' || conclusion === 'timed_out') return 'run-failed';
	return 'no-failure';
}

async function main() {
	const [command, ...args] = process.argv.slice(2);
	if (command === 'kind') {
		const [conclusion = '', failed = '', timedout = ''] = args;
		process.stdout.write(classifyRun({ conclusion, failed, timedout }));
		return;
	}

	/** @type {Buffer[]} */
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
	const run = selectRun(JSON.parse(Buffer.concat(chunks).toString('utf8')), args[0]);
	if (run) process.stdout.write(JSON.stringify(run));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

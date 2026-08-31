/**
 * `pnpm test:unit`, queued behind any other full suite on this machine.
 *
 * The lock and the reasoning live in `scripts/lib/unit-lock.ts`. This is the
 * wrapper that takes it, runs vitest, and gives it back.
 */
import { spawnSync } from 'node:child_process';
import {
	acquireUnitLock,
	releaseUnitLock,
	releaseUnitLockOnExit,
	unitLockFile
} from './lib/unit-lock';

/**
 * `pnpm test:unit -- --run` forwards the separator itself, so vitest is handed a
 * literal `--` alongside the flag. It tolerates it today; `playwright` did not,
 * and read it as a file filter that matched nothing — a *green*-looking failure
 * that `e2e/run.ts` now strips for the same reason. Dropping it here keeps both
 * spellings identical rather than resting on which tool happens to be lenient.
 */
const args = process.argv.slice(2).filter((arg) => arg !== '--');

/**
 * Watch mode holds the terminal for as long as somebody is working, and a
 * machine-wide lock held that long would block every other checkout for the
 * afternoon — the opposite of the point. It also idles between runs rather than
 * pinning every core, so it is not what caused this. One-shot runs are the ones
 * that saturate and then exit, and they are what agents run.
 *
 * CI is skipped because a runner has the machine to itself; that is the same
 * condition `vite.config.ts` uses to stop halving `maxWorkers`.
 */
const oneShot = args.includes('--run');
const shouldLock = oneShot && !process.env.CI;

if (shouldLock) {
	releaseUnitLockOnExit();

	const result = await acquireUnitLock({
		onWait: (holder) => {
			const where = holder.root === process.cwd() ? 'this checkout' : holder.root;
			console.error(
				`Another unit suite is running — waiting for it rather than fighting it for cores.\n` +
					`  holder:  pid ${holder.pid} in ${where}\n` +
					`  started: ${new Date(holder.startedAt).toLocaleTimeString()}\n` +
					`  (if it is gone: rm ${unitLockFile()})`
			);
		}
	});

	if (result === 'timed-out') {
		console.error(
			`Waited long enough for the other suite; starting anyway.\n` +
				`Both runs will be slow, but neither will be wrong.`
		);
	}
}

const run = spawnSync('pnpm', ['exec', 'vitest', ...args], { stdio: 'inherit' });

if (shouldLock) releaseUnitLock();

if (run.error) {
	console.error(run.error);
	process.exit(1);
}

// A signal (Ctrl-C) leaves `status` null; treat it as a failure.
process.exit(run.status ?? 1);

/**
 * Run a child process, forwarding its output, and stop it the moment that
 * output says the e2e preview server has died.
 *
 * Split out of `e2e/run.ts` so the abort path can be exercised against a fake
 * child rather than against the race that produces it — see
 * `e2e/supervise.spec.ts`. `e2e/server-crash.ts` owns what counts as a death.
 */
import { spawn } from 'node:child_process';
import { createServerCrashWatcher, serverCrashReport, type ServerCrash } from './server-crash';

/** Anywhere the child's output can be echoed to. */
export interface OutputSink {
	write(chunk: string | Uint8Array): unknown;
}

export interface SuperviseOptions {
	/** Named in the abort report, so the reader knows which port went quiet. */
	port: number;
	stdout?: OutputSink;
	stderr?: OutputSink;
	/** Grace between SIGTERM and SIGKILL, for a child that will not go. */
	killAfterMs?: number;
}

export interface SuperviseResult {
	/** The child's exit code, forced non-zero when a crash was detected. */
	status: number;
	/** What killed the run, or null if the child finished on its own terms. */
	crash: ServerCrash | null;
}

/**
 * Spawn `command`, tee its output, and abort on a dead server.
 *
 * The child gets its own process group, so an abort takes the whole tree —
 * Playwright, its workers, the preview server — not just the `pnpm` in front.
 * That also removes it from the terminal's foreground group, which is why
 * SIGINT/SIGTERM are forwarded by hand below.
 */
export function supervise(
	command: string,
	args: string[],
	{ port, stdout = process.stdout, stderr = process.stderr, killAfterMs = 10_000 }: SuperviseOptions
): Promise<SuperviseResult> {
	const child = spawn(command, args, {
		// stdin stays inherited so `--debug` and friends still have a terminal.
		stdio: ['inherit', 'pipe', 'pipe'],
		detached: true,
		env: {
			...process.env,
			// The pipe costs the child its TTY, and with it the colour it would have
			// used locally. CI has no TTY either way, so its logs are unchanged.
			...(process.stdout.isTTY ? { FORCE_COLOR: '1' } : {})
		}
	});

	const killGroup = (signal: NodeJS.Signals) => {
		if (child.pid === undefined) return;
		try {
			process.kill(-child.pid, signal);
		} catch {
			// Already gone. Nothing to do, and nothing worth saying.
		}
	};

	const forward = (signal: NodeJS.Signals) => killGroup(signal);
	const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
	for (const signal of signals) process.on(signal, forward);

	const watcher = createServerCrashWatcher();
	let crash: ServerCrash | null = null;
	let killTimer: NodeJS.Timeout | undefined;

	/** Say what died, immediately, then stop the run rather than let it grind on. */
	const abort = (found: ServerCrash) => {
		crash = found;
		stderr.write(serverCrashReport(found, port));
		killGroup('SIGTERM');
		// The child still has to tear its own web server down, so give it a moment
		// before insisting. Unref'd: this must never hold the process open.
		killTimer = setTimeout(() => killGroup('SIGKILL'), killAfterMs);
		killTimer.unref();
	};

	for (const [source, sink] of [
		[child.stdout, stdout],
		[child.stderr, stderr]
	] as const) {
		source.on('data', (chunk: Buffer) => {
			sink.write(chunk);
			if (crash) return;
			const found = watcher.push(chunk.toString());
			if (found) abort(found);
		});
	}

	return new Promise<SuperviseResult>((resolve) => {
		const done = (result: SuperviseResult) => {
			for (const signal of signals) process.off(signal, forward);
			clearTimeout(killTimer);
			resolve(result);
		};

		child.on('error', (err) => {
			stderr.write(`${err}\n`);
			done({ status: 1, crash: null });
		});

		// `close`, not `exit`: the pipes have to have drained, or the line that
		// named the crash can still be buffered when this resolves.
		child.on('close', (code) => {
			const trailing = crash ?? watcher.flush();
			if (trailing && !crash) {
				crash = trailing;
				stderr.write(serverCrashReport(trailing, port));
			}
			// A signal — Ctrl-C, or the abort above — leaves `code` null. Either way
			// that is a failure, and a crash can never report success.
			const status = code ?? 1;
			done({ status: crash ? status || 1 : status, crash });
		});
	});
}

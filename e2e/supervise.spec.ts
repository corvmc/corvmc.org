import { describe, it, expect } from 'vitest';
import { supervise, type OutputSink } from './supervise';

/**
 * The race itself is not reproducible on demand, so the abort path is proved
 * against a fake child that prints what the dying server printed in run
 * 34181645841 and then refuses to exit.
 */
const FATAL =
	'[WebServer] MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.';

/** A stand-in for `playwright test`: whatever `script` does, and nothing else. */
function fakeChild(script: string): [string, string[]] {
	return [process.execPath, ['-e', script]];
}

function collector(): OutputSink & { text(): string } {
	const chunks: string[] = [];
	return {
		write(chunk) {
			chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
			return true;
		},
		text: () => chunks.join('')
	};
}

describe('supervise', () => {
	it('forwards a healthy run and reports its exit code', async () => {
		const stdout = collector();
		const [command, args] = fakeChild(
			`process.stdout.write('Running 254 tests using 2 workers\\n  254 passed\\n')`
		);

		const result = await supervise(command, args, { port: 4173, stdout, stderr: collector() });

		expect(result).toEqual({ status: 0, crash: null });
		expect(stdout.text()).toContain('254 passed');
	});

	it('keeps a genuine test failure as a test failure', async () => {
		const [command, args] = fakeChild(`process.stdout.write('  1 failed\\n'); process.exit(1)`);

		const result = await supervise(command, args, {
			port: 4173,
			stdout: collector(),
			stderr: collector()
		});

		expect(result.crash).toBeNull();
		expect(result.status).toBe(1);
	});

	// The whole point: without this the child runs to completion against a closed
	// port. `setInterval` stands in for the 254 tests that would have followed.
	it('kills a child that keeps running after its web server died', async () => {
		const stderr = collector();
		const [command, args] = fakeChild(
			`process.stderr.write(${JSON.stringify(`${FATAL}\n`)}); setInterval(() => {}, 1000)`
		);

		const result = await supervise(command, args, { port: 4173, stdout: collector(), stderr });

		expect(result.crash?.kind).toBe('runtime-failure');
		expect(result.status).not.toBe(0);
		expect(stderr.text()).toContain('The e2e web server did not start.');
		expect(stderr.text()).toContain('port 4173');
	});

	// A child that dies mid-line still has to be diagnosed, and a zero exit code
	// from one that printed this is not a green run.
	it('catches a crash on an unterminated final line, and refuses its exit code', async () => {
		const [command, args] = fakeChild(`process.stderr.write(${JSON.stringify(FATAL)})`);

		const result = await supervise(command, args, {
			port: 4173,
			stdout: collector(),
			stderr: collector()
		});

		expect(result.crash?.kind).toBe('runtime-failure');
		expect(result.status).toBe(1);
	});

	it('reports a command that cannot be spawned at all', async () => {
		const result = await supervise('./no-such-binary-9f3c', [], {
			port: 4173,
			stdout: collector(),
			stderr: collector()
		});

		expect(result).toEqual({ status: 1, crash: null });
	});
});

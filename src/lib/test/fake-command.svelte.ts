/**
 * A stand-in for a remote `command()` that keeps the one property a bare `vi.fn`
 * loses: kit's client command does `pending_count++` on a `$state` synchronously
 * on every call. Inside an `$effect` that read subscribes the effect and the write
 * re-runs it — the loop behind #1956. Mock a command with this, not a `vi.fn`, in
 * any component spec that calls it from an effect.
 */
export function fakeCommand<A, R>(impl: (arg: A) => Promise<R>) {
	let pending = $state(0);
	const calls: A[] = [];

	function run(arg: A): Promise<R> {
		calls.push(arg);
		pending++;
		return impl(arg).finally(() => pending--);
	}

	return Object.assign(run, {
		calls,
		get pending() {
			return pending;
		}
	});
}

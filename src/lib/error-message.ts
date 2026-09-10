/**
 * The display string for a caught error, whatever shape it arrived in.
 *
 * Remote-function rejections are not `Error`s — they arrive as plain objects
 * shaped `{ status, body: { message } }`, which is where a `mapDomainError`
 * sentence lives. Reading `.message` off one of those yields `undefined`, and
 * that is how a written explanation becomes a bare "Error" on screen.
 */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
	if (err instanceof Error) return err.message;
	if (typeof err === 'string') return err;
	if (err && typeof err === 'object') {
		const e = err as { message?: unknown; body?: { message?: unknown } };
		if (typeof e.body?.message === 'string') return e.body.message;
		if (typeof e.message === 'string') return e.message;
	}
	return fallback;
}

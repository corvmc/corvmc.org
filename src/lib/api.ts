/**
 * Extract a human-readable message from a failed API Response. SvelteKit's
 * `error(status, message)` responds with a JSON `{ message }` body; fall back to
 * the provided default when the body isn't JSON or has no message.
 */
export async function responseErrorMessage(res: Response, fallback: string): Promise<string> {
	try {
		const body = (await res.json()) as { message?: unknown };
		if (typeof body?.message === 'string' && body.message) return body.message;
	} catch {
		// body wasn't JSON — use the fallback
	}
	return fallback;
}

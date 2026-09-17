import { describe, expect, it, vi } from 'vitest';
import { error, invalid } from '@sveltejs/kit';
import { DomainError } from '$lib/server/domain-error';

// The stubs return the handler they are given, so a call in this file runs the
// wrapper's own try/catch — which is the thing under test.
vi.mock('$app/server', () => ({
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) => handler,
	command: (...args: unknown[]) => (typeof args[0] === 'function' ? args[0] : args[1])
}));

const { form, command } = await import('./_remote');

class Taken extends DomainError {
	readonly httpStatus = 409;
}

const run = async (fn: (...a: unknown[]) => unknown) => {
	try {
		await fn({}, {});
	} catch (e) {
		return e as { status?: number; body?: { message?: string } };
	}
};

describe('form/command with domain-error mapping', () => {
	it('turns a DomainError into the status the class declares', async () => {
		const fn = form({} as never, async () => {
			throw new Taken('Already a member');
		}) as unknown as (...a: unknown[]) => unknown;

		const thrown = await run(fn);
		expect(thrown?.status).toBe(409);
		expect(thrown?.body?.message).toBe('Already a member');
	});

	it('does the same for command', async () => {
		const fn = command({} as never, async () => {
			throw new Taken('Already a member');
		}) as unknown as (...a: unknown[]) => unknown;

		expect((await run(fn))?.status).toBe(409);
	});

	// The three things that must pass through untouched, because the wrapper is
	// only safe to apply everywhere if it never swallows a deliberate answer.
	it('leaves a hand-written error() alone', async () => {
		const fn = form({} as never, async () => {
			error(418, 'deliberate');
		}) as unknown as (...a: unknown[]) => unknown;

		const thrown = await run(fn);
		expect(thrown?.status).toBe(418);
		expect(thrown?.body?.message).toBe('deliberate');
	});

	it('leaves invalid() alone, so a field issue stays a field issue', async () => {
		const fn = form({} as never, async (_d, issue) => {
			const field = issue as unknown as Record<string, (m: string) => never>;
			invalid(field.email('bad'));
		}) as unknown as (...a: unknown[]) => unknown;

		let thrown: unknown;
		try {
			await fn({}, { email: (m: string) => ({ path: ['email'], message: m }) });
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeDefined();
		expect((thrown as { status?: number }).status).not.toBe(500);
	});

	it('re-throws anything else, so a fault still surfaces as a 500', async () => {
		const boom = new Error('not a domain error');
		const fn = form({} as never, async () => {
			throw boom;
		}) as unknown as (...a: unknown[]) => unknown;

		await expect(fn({}, {})).rejects.toThrow(boom);
	});

	// An inner catch runs first, so the ~25 call sites that turn a specific
	// domain error into a field issue keep doing that rather than getting a status.
	it('does not pre-empt an inner catch', async () => {
		const fn = form({} as never, async () => {
			try {
				throw new Taken('Already a member');
			} catch {
				return { handled: true };
			}
		}) as unknown as (...a: unknown[]) => Promise<unknown>;

		await expect(fn({}, {})).resolves.toEqual({ handled: true });
	});

	it('passes the schema and both handler arguments through', async () => {
		const schema = { marker: true };
		const kit = await import('$app/server');
		const spy = vi.spyOn(kit, 'form');

		const fn = form(schema as never, async (data: unknown, issue: unknown) => ({
			data,
			issue
		})) as unknown as (...a: unknown[]) => Promise<unknown>;

		expect(spy.mock.calls[0][0]).toBe(schema);
		await expect(fn({ id: 'x' }, 'ISSUE')).resolves.toEqual({
			data: { id: 'x' },
			issue: 'ISSUE'
		});
	});
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { isHttpError } from '@sveltejs/kit';
import { sourceFiles } from '../../../../scripts/lib/source-files';

/**
 * What an admin viewing as a member may not do (#2847): move money, or change
 * the member's password or email. Payments are refused at the gateway, so a
 * new payment path is covered without remembering; credential changes are
 * refused per remote, and the walk below fails one that forgets.
 */

const requestEvent = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		if (!requestEvent.current) throw new Error('outside a request');
		return requestEvent.current;
	}
}));

const { stripe, initStripe } = await import('#lib/server/stripe.js');
const { createFakeGateway } = await import('#lib/server/finance/gateway/fake-gateway.js');

function viewingAsMember(on: boolean) {
	requestEvent.current = on ? { locals: { session: { impersonatedBy: 'u-admin' } } } : null;
}

async function refusal(call: () => unknown): Promise<number | null> {
	try {
		await call();
		return null;
	} catch (err) {
		return isHttpError(err) ? err.status : null;
	}
}

beforeEach(() => {
	initStripe(createFakeGateway());
	viewingAsMember(false);
});

describe('the payment gateway while viewing as a member', () => {
	it('refuses every call that could move money or change billing', async () => {
		viewingAsMember(true);
		expect(await refusal(() => stripe.checkout.sessions.create({ mode: 'payment' }))).toBe(403);
		expect(
			await refusal(() => stripe.paymentIntents.create({ amount: 500, currency: 'usd' }))
		).toBe(403);
		expect(await refusal(() => stripe.subscriptions.update('sub_1', {}))).toBe(403);
		expect(await refusal(() => stripe.setupIntents.create({}))).toBe(403);
	});

	it('still reads', async () => {
		viewingAsMember(true);
		expect(await refusal(() => stripe.paymentIntents.list({ limit: 1 }))).toBeNull();
	});

	it('is untouched for everyone else', async () => {
		expect(
			await refusal(() => stripe.paymentIntents.create({ amount: 500, currency: 'usd' }))
		).toBeNull();
	});
});

/** Calls that change a member's password or login email. */
const CREDENTIAL =
	/\bauth\.api\.(changePassword|changeEmail|setPassword|deleteUser)\(|\b(requestEmailChangeService|confirmEmailChangeService)\(/g;

describe('credential changes in remote functions', () => {
	const remotes = sourceFiles(['src/lib/remote/*.remote.ts'], new Set());

	it('are found, so an empty pass means something', () => {
		const hits = remotes.filter((f) => new RegExp(CREDENTIAL.source).test(readFileSync(f, 'utf8')));
		expect(hits).toEqual(expect.arrayContaining(['src/lib/remote/account.remote.ts']));
	});

	it.each(remotes)('%s refuses them while viewing as a member', (file) => {
		const source = readFileSync(file, 'utf8');
		const unguarded = [...source.matchAll(CREDENTIAL)]
			.filter((m) => {
				const head = source.slice(0, m.index);
				return !head
					.slice(head.lastIndexOf('\nexport const '))
					.includes('refuseWhileImpersonating()');
			})
			.map((m) => `${m[0]} at line ${source.slice(0, m.index).split('\n').length}`);
		expect(unguarded).toEqual([]);
	});
});

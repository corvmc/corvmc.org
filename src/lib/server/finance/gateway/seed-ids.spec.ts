import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('$app/env/private', async () => (await import('#lib/testing/env-mock.js')).envMock({}));

const { createFakeGateway, resetFakeGateway } = await import('./fake-gateway');

/**
 * Every Stripe payment id the dev seed writes is one the fake gateway can read,
 * so a seeded payment can be refunded locally (#2835). Walks the seed files for
 * the prefixes they put in `stripePaymentRecordId`; refund dispatches on `pi_`.
 */
const SEED_DIR = join(process.cwd(), 'scripts/seed');
const prefixes = [
	...new Set(
		readdirSync(SEED_DIR)
			.filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
			.flatMap((f) =>
				[
					...readFileSync(join(SEED_DIR, f), 'utf8').matchAll(
						/stripePaymentRecordId:[^,]*?[`'"](\w+?_seed_)/g
					)
				].map((m) => m[1])
			)
	)
].sort();

describe('seeded payment ids', () => {
	beforeEach(() => resetFakeGateway());

	it('finds the prefixes the seed writes', () => {
		expect(prefixes).toEqual(expect.arrayContaining(['pi_seed_', 'pr_seed_']));
	});

	it.each(prefixes)('%s… resolves in the fake gateway', async (prefix) => {
		const gateway = createFakeGateway();
		const id = `${prefix}0a1b2c3d`;
		const found = id.startsWith('pi_')
			? await gateway.paymentIntents.retrieve(id, { expand: ['latest_charge'] })
			: await gateway.paymentRecords.retrieve(id);
		expect(found.id).toBe(id);
	});
});

import { describe, expect, it, vi } from 'vitest';
import { goToCheckout } from './checkout-navigation';

const goto = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$app/navigation', () => ({ goto }));

describe('goToCheckout', () => {
	it('routes the checkout URL through the client-side router', async () => {
		await goToCheckout('/checkout/cs_test_123');

		expect(goto).toHaveBeenCalledWith('/checkout/cs_test_123');
	});
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { goToCheckout } from './checkout-navigation';

const goto = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$app/navigation', () => ({ goto }));

describe('goToCheckout', () => {
	beforeEach(() => {
		goto.mockClear();
		// The node project has no `window`; the helper only ever reads
		// `location.href` on the branch that leaves the app.
		vi.stubGlobal('window', { location: { href: '' } });
	});

	it('routes an in-app checkout URL through the client-side router', async () => {
		await goToCheckout('/checkout/cs_test_123');

		expect(goto).toHaveBeenCalledWith('/checkout/cs_test_123');
		expect(window.location.href).toBe('');
	});

	it('leaves the app for a hosted Stripe URL', async () => {
		await goToCheckout('https://checkout.stripe.com/c/pay/cs_test_123');

		expect(goto).not.toHaveBeenCalled();
		expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
	});

	it('treats a protocol-relative URL as another origin, not a local path', async () => {
		await goToCheckout('//evil.example/checkout');

		expect(goto).not.toHaveBeenCalled();
		expect(window.location.href).toBe('//evil.example/checkout');
	});
});

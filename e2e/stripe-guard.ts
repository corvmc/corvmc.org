/**
 * The e2e suite must not be able to reach real Stripe (#667).
 *
 * `playwright.config.ts` used to forward `process.env.STRIPE_SECRET_KEY`, so a
 * developer with a live key exported had the suite transacting for real —
 * `ensureStripeCustomer` calls `stripe.customers.create` unconditionally.
 */

/**
 * The credentials the preview server is pinned to. They must stay *set* rather
 * than deleted: SvelteKit's preview server resolves `$env/dynamic/private`
 * through vite's `loadEnv`, which layers `process.env` over the `.env` file, so
 * an unset variable falls through to `.env` — which carries a live `rk_live`
 * key in this repo.
 */
export const E2E_STRIPE_SECRET_KEY = 'sk_test_dummy_e2e';
export const E2E_STRIPE_WEBHOOK_SECRET = 'whsec_dummy_e2e';

/**
 * Can this value authenticate a Stripe API call that is not a test call?
 *
 * An allow-list, so the unknown case fails closed: a value shaped like a Stripe
 * API credential (`sk_`/`rk_`) is accepted only when it is explicitly a test
 * key. A live key, or a prefix Stripe introduces later, is refused.
 */
export function isTransactableStripeCredential(value: string): boolean {
	if (!/^(sk|rk)_/.test(value)) return false;
	return !/^(sk|rk)_test_/.test(value);
}

/**
 * The names of any variables in `env` that could transact against real Stripe.
 *
 * Names only, never values — this reaches CI logs and a failure message. Scoped
 * to the namespaces the app reads for the gateway; a credential smuggled in
 * under another name is not something a string scan can honestly catch.
 */
export function findTransactableStripeCredentials(
	env: Record<string, string | undefined>
): string[] {
	return Object.entries(env)
		.filter(([name]) => /^(STRIPE|PAYMENTS)_/.test(name))
		.filter(([, value]) => typeof value === 'string' && isTransactableStripeCredential(value))
		.map(([name]) => name)
		.sort();
}

/**
 * Refuse to serve or test the app with a credential that can move real money.
 *
 * Throws rather than warns: the failure this closes is silent by nature, so the
 * run has to stop before the first request rather than after the first charge.
 */
export function assertNoTransactableStripeCredentials(
	env: Record<string, string | undefined>,
	context: string
): void {
	const offenders = findTransactableStripeCredentials(env);
	if (offenders.length === 0) return;

	throw new Error(
		[
			`Refusing to start ${context}: a Stripe credential in scope can transact`,
			`against real Stripe.`,
			``,
			`  offending variables: ${offenders.join(', ')}`,
			``,
			`Only test credentials (sk_test_/rk_test_) may reach this server. The value`,
			`is not printed. It comes from your shell or from .env, which in this repo`,
			`carries a live restricted key.`,
			``,
			`  unset it for this command:  env -u ${offenders[0]} <command>`,
			`  or point it at a test key:  ${offenders[0]}=sk_test_... <command>`,
			``
		].join('\n')
	);
}

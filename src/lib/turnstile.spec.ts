import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

const { turnstileFailureMessage, TURNSTILE_RESPONSE_FIELD } = await import('./turnstile');

/**
 * The band contact form's Send button used to do nothing at all when the
 * Turnstile challenge had not finished loading — the field it fails on has no
 * visible input, and passing `onfailure` to reset the widget suppressed `Form`'s
 * own fallback toast. On the only route a stranger has to reach an act, that is
 * a dead button.
 *
 * These pin the two halves of the message, because the useful one is the half
 * that is easy to lose: "wait a moment" is actionable, "check the fields above"
 * is not, and collapsing them back into one string would silently take the
 * actionable one away.
 */
describe('turnstileFailureMessage', () => {
	it('tells someone to wait when verification is what failed', () => {
		const message = turnstileFailureMessage([
			{ message: 'Required', path: [TURNSTILE_RESPONSE_FIELD] }
		]);
		expect(message).toMatch(/give it a moment/i);
	});

	it('finds the issue among others rather than only at the front', () => {
		const message = turnstileFailureMessage([
			{ message: 'Required', path: ['email'] },
			{ message: 'Required', path: [TURNSTILE_RESPONSE_FIELD] }
		]);
		expect(message).toMatch(/give it a moment/i);
	});

	it('points at the fields when something else failed', () => {
		const message = turnstileFailureMessage([{ message: 'Invalid email', path: ['email'] }]);
		expect(message).toMatch(/check the fields/i);
	});

	it('says something rather than nothing when there are no issues at all', () => {
		expect(turnstileFailureMessage(null)).toMatch(/check the fields/i);
	});
});

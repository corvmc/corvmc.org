import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { PUBLIC_SITE_URL: 'https://test.corvmc.com' } }));

const { buildNotificationEmail } = await import('./build-model');

const CONTENT = { subject: 'Your reservation is confirmed', heading: 'Reservation confirmed' };

describe('buildNotificationEmail', () => {
	it('writes the greeting so no listener has to', () => {
		const model = buildNotificationEmail({ ...CONTENT, recipientName: 'Ada' });

		expect(model.greeting).toBe('Hi Ada,');
	});

	it('leaves the greeting off when there is no name to use', () => {
		// A guest receipt goes to an address, not to somebody we can name.
		expect(buildNotificationEmail(CONTENT).greeting).toBeUndefined();
	});

	it('points the button at the notification, so the bell and the mail agree', () => {
		const model = buildNotificationEmail(
			{ ...CONTENT, cta: { label: 'View my reservations' } },
			{ href: '/member/reservations' }
		);

		expect(model.cta).toEqual({
			url: 'https://test.corvmc.com/member/reservations',
			label: 'View my reservations'
		});
	});

	it('makes a site-relative CTA absolute', () => {
		// A path is a dead link in a mailbox, which is why no listener is trusted
		// to remember the origin.
		const model = buildNotificationEmail({
			...CONTENT,
			cta: { url: '/login?invite=t', label: 'Join' }
		});

		expect(model.cta?.url).toBe('https://test.corvmc.com/login?invite=t');
	});

	it('leaves a CTA that already names its own origin alone', () => {
		// Stripe's hosted invoice, a signed download link: not ours to rewrite.
		const model = buildNotificationEmail(
			{ ...CONTENT, cta: { url: 'https://stripe.test/pay', label: 'Update payment method' } },
			{ href: '/member/membership' }
		);

		expect(model.cta?.url).toBe('https://stripe.test/pay');
	});

	it('drops a button that would point nowhere', () => {
		// Only reachable on mail with no in-app row, which is why that path takes
		// a content type whose CTA has to name a URL.
		expect(buildNotificationEmail({ ...CONTENT, cta: { label: 'Somewhere' } }).cta).toBeUndefined();
	});

	it('passes the copy through untouched', () => {
		const model = buildNotificationEmail({
			...CONTENT,
			preview_text: 'May 21, 10:00 AM',
			paragraphs: [{ text: 'You have a reservation coming up.' }],
			details: [{ label: 'Date', value: 'May 21' }],
			quote: 'staff said this',
			footnote: 'Cancel a day ahead.'
		});

		expect(model).toMatchObject({
			subject: CONTENT.subject,
			heading: CONTENT.heading,
			preview_text: 'May 21, 10:00 AM',
			paragraphs: [{ text: 'You have a reservation coming up.' }],
			details: [{ label: 'Date', value: 'May 21' }],
			quote: 'staff said this',
			footnote: 'Cancel a day ahead.'
		});
		// `recipientName` is the listener's word for the reader, not a template field.
		expect(model).not.toHaveProperty('recipientName');
	});
});

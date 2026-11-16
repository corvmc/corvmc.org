import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { admitTwilioInbound } from './twilio-inbound-request';

const ORIGIN = 'https://corvmc.org';
const FORM = 'From=%2B15415550100&Body=hello';

const request = (path: string, headers: Record<string, string>, method = 'POST') =>
	new Request(`${ORIGIN}${path}`, {
		method,
		headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
		...(method === 'POST' ? { body: FORM } : {})
	});

describe('admitTwilioInbound', () => {
	it('gives a signed webhook the origin CSRF wants, with its body intact', async () => {
		const admitted = admitTwilioInbound(
			request('/api/inbox/twilio', { 'x-twilio-signature': 'sig' })
		);
		expect(admitted.headers.get('origin')).toBe(ORIGIN);
		expect(admitted.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
		expect(admitted.headers.get('x-twilio-signature')).toBe('sig');
		expect(await admitted.text()).toBe(FORM);
	});

	it.each([
		['an unsigned post to the route', request('/api/inbox/twilio', {})],
		['a signed post elsewhere', request('/api/inbox/postmark', { 'x-twilio-signature': 's' })],
		['a signed post below it', request('/api/inbox/twilio/x', { 'x-twilio-signature': 's' })],
		['a signed GET', request('/api/inbox/twilio', { 'x-twilio-signature': 's' }, 'GET')]
	])('passes %s through untouched', (_name, original) => {
		const passed = admitTwilioInbound(original);
		expect(passed).toBe(original);
		expect(passed.headers.get('origin')).toBeNull();
	});

	it('keeps the origin a cross-site browser post came with', () => {
		const original = request('/api/inbox/twilio', {
			'x-twilio-signature': 's',
			origin: 'https://elsewhere.example'
		});
		expect(admitTwilioInbound(original).headers.get('origin')).toBe('https://elsewhere.example');
	});

	// worker.js imports a build artifact, so no spec can load it.
	it('runs ahead of Kit in the Worker entry', () => {
		const entry = readFileSync('worker.js', 'utf8');
		expect(entry).toMatch(/worker\.fetch\(admitTwilioInbound\(request\), env, ctx\)/);
	});
});

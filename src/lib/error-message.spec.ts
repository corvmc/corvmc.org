import { describe, expect, it } from 'vitest';
import { errorMessage } from './error-message';

describe('errorMessage', () => {
	it('reads the remote-function rejection shape', () => {
		// The shape that matters: `.message` is undefined on one of these, so a
		// naive read turns a written explanation into a bare "Error".
		expect(
			errorMessage({ status: 422, body: { message: 'Not ready to announce: there is no poster.' } })
		).toBe('Not ready to announce: there is no poster.');
	});

	it('prefers the body message over a sibling message', () => {
		expect(
			errorMessage({ status: 500, message: 'Internal Error', body: { message: 'Real' } })
		).toBe('Real');
	});

	it('reads an Error and a string', () => {
		expect(errorMessage(new Error('boom'))).toBe('boom');
		expect(errorMessage('boom')).toBe('boom');
	});

	it('falls back when there is nothing to read', () => {
		expect(errorMessage(null)).toBe('Something went wrong');
		expect(errorMessage({ status: 500 })).toBe('Something went wrong');
		expect(errorMessage(undefined, 'Could not publish')).toBe('Could not publish');
	});
});

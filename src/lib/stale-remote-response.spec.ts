import { describe, it, expect } from 'vitest';
import { isStaleRemoteResponse } from './stale-remote-response';

describe('isStaleRemoteResponse', () => {
	// The exact messages the three engines produce when devalue.parse is handed
	// an HTML error page instead of a remote function's JSON envelope.
	it.each([
		['Firefox', 'JSON.parse: unexpected character at line 1 column 1 of the JSON data'],
		['Chrome', `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`],
		['Safari', `The string did not match the expected pattern. is not valid JSON`]
	])('matches the %s parse failure', (_engine, message) => {
		expect(isStaleRemoteResponse(new SyntaxError(message))).toBe(true);
	});

	it('ignores a SyntaxError from something other than JSON parsing', () => {
		expect(isStaleRemoteResponse(new SyntaxError('Invalid regular expression flags'))).toBe(false);
	});

	// Only SyntaxError qualifies — a server error whose message happens to
	// mention a token must still reach Sentry.
	it('ignores non-SyntaxError values', () => {
		expect(isStaleRemoteResponse(new TypeError('Unexpected token'))).toBe(false);
		expect(isStaleRemoteResponse(new Error('is not valid JSON'))).toBe(false);
		expect(isStaleRemoteResponse('Unexpected token')).toBe(false);
		expect(isStaleRemoteResponse(null)).toBe(false);
		expect(isStaleRemoteResponse(undefined)).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';
import { withQuery } from './with-query';

describe('withQuery', () => {
	it('returns the path alone when there is no query', () => {
		expect(withQuery('/staff/reports', '')).toBe('/staff/reports');
		expect(withQuery('/staff/reports', new URLSearchParams())).toBe('/staff/reports');
	});

	it('joins a query given without its question mark', () => {
		expect(withQuery('/staff/reports', 'from=2026-01-01')).toBe('/staff/reports?from=2026-01-01');
	});

	it('does not double a question mark the caller already wrote', () => {
		expect(withQuery('/login', '?register')).toBe('/login?register');
	});

	it('serialises URLSearchParams', () => {
		const q = new URLSearchParams({ tagKind: 'genre', tagValue: 'folk rock' });
		expect(withQuery('/member/classifieds', q)).toBe(
			'/member/classifieds?tagKind=genre&tagValue=folk+rock'
		);
	});
});

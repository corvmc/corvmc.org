import { describe, it, expect, vi } from 'vitest';

// Only the pure truncatePreview() is exercised; the db is never reached.
vi.mock('$lib/server/db', () => ({ db: {} }));

const { truncatePreview } = await import('./thread-service');

describe('truncatePreview', () => {
	it('returns short text unchanged', () => {
		expect(truncatePreview('hello world')).toBe('hello world');
	});

	it('returns text at the 200-char limit unchanged', () => {
		const exact = 'a'.repeat(200);
		expect(truncatePreview(exact)).toBe(exact);
	});

	it('truncates text over 200 chars and appends an ellipsis', () => {
		const long = 'a'.repeat(250);
		const result = truncatePreview(long);
		expect(result).toBe('a'.repeat(200) + '…');
		expect(result.length).toBe(201);
	});
});

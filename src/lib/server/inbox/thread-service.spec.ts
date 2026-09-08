import { describe, it, expect, vi } from 'vitest';

// thread-service imports the db, drizzle, and schema at module scope. Stub those
// so the module loads in isolation — we only exercise the pure truncatePreview().
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/db/schema/inbox', () => ({
	inboxThread: { channel: 'thread.channel', id: 'thread.id' },
	inboxMessage: {},
	inboxNote: {},
	inboxParticipant: {}
}));
vi.mock('$lib/server/db/schema/authentication', () => ({ user: {} }));
vi.mock('$lib/server/db/paginate', () => ({ paginate: vi.fn() }));
vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	ne: vi.fn(),
	and: vi.fn(),
	asc: vi.fn(),
	desc: vi.fn(),
	count: vi.fn(),
	like: vi.fn(),
	or: vi.fn(),
	inArray: vi.fn(),
	notInArray: vi.fn(),
	isNull: vi.fn(),
	isNotNull: vi.fn(),
	lte: vi.fn(),
	sql: vi.fn()
}));

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

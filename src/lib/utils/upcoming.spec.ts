import { describe, it, expect } from 'vitest';
import { splitUpcoming } from './upcoming';

const now = new Date('2026-11-16T12:00:00Z');
const at = (iso: string) => new Date(iso);

describe('splitUpcoming', () => {
	const rows = [
		{ id: 'later', startsAt: at('2026-12-08T03:00:00Z'), endsAt: null },
		{ id: 'soon', startsAt: at('2026-12-06T03:00:00Z'), endsAt: at('2026-12-06T05:00:00Z') },
		{ id: 'on-now', startsAt: at('2026-11-16T11:00:00Z'), endsAt: at('2026-11-16T13:00:00Z') },
		{ id: 'old', startsAt: at('2026-10-01T03:00:00Z'), endsAt: null },
		{ id: 'last-week', startsAt: at('2026-11-12T03:00:00Z'), endsAt: at('2026-11-12T05:00:00Z') }
	];

	it('puts what has not ended in upcoming, nearest first', () => {
		expect(splitUpcoming(rows, now).upcoming.map((r) => r.id)).toEqual(['on-now', 'soon', 'later']);
	});

	it('puts what has ended in past, newest first', () => {
		expect(splitUpcoming(rows, now).past.map((r) => r.id)).toEqual(['last-week', 'old']);
	});
});

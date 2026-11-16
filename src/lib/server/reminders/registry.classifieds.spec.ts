import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { surfaces, CLASSIFIED_EXPIRY_REMINDER_DAYS } from '#lib/config.js';

/**
 * The classified expiry reminder: its window, its subject, and the surface
 * switch. The query's predicate is pinned against SQLite in the service spec.
 */

const listPostsExpiringBetween = vi.fn(async (_from: Date, _to: Date) => [] as unknown[]);

vi.mock('#lib/server/classified/classified-service.js', () => ({ listPostsExpiringBetween }));
vi.mock('#lib/server/db/index.js', () => ({ db: {} }));

const { reminders } = await import('./registry');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-15T12:00:00Z');
const expiresAt = new Date('2026-06-17T09:00:00Z');
const row = {
	id: 'post-1',
	title: 'Drummer wanted',
	expiresAt,
	userId: 'u-1',
	userName: 'Robin',
	userEmail: 'robin@example.com'
};

const reminder = () => reminders.find((r) => r.key === 'classified_expiring')!;

beforeEach(() => {
	vi.clearAllMocks();
	listPostsExpiringBetween.mockResolvedValue([row]);
	surfaces.classifieds = true;
});

afterEach(() => {
	surfaces.classifieds = false;
});

describe('classified expiry reminder', () => {
	it('asks for posts leaving the board in the reminder window', async () => {
		const due = await reminder().due(NOW);

		expect(listPostsExpiringBetween).toHaveBeenCalledWith(
			NOW,
			new Date(NOW.getTime() + CLASSIFIED_EXPIRY_REMINDER_DAYS * DAY)
		);
		expect(due).toHaveLength(1);
		expect(due[0].payload).toMatchObject({ postId: 'post-1', userId: 'u-1' });
	});

	// A renewal moves the expiry, so the renewed post is owed a fresh reminder.
	it('keys the subject on the expiry, not the post alone', async () => {
		const [due] = await reminder().due(NOW);

		expect(due.subjectId).toBe(`post-1:${expiresAt.toISOString()}`);
	});

	it('sends nothing while the classifieds surface is off', async () => {
		surfaces.classifieds = false;

		expect(await reminder().due(NOW)).toEqual([]);
		expect(listPostsExpiringBetween).not.toHaveBeenCalled();
	});
});

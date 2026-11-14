import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * A staff-only notification switch is offered to, and saved for, holders of the
 * capability its fan-out names, not to anyone holding a position (#2985).
 */
vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	const query = (...a: unknown[]) => {
		const handler = a.at(-1) as (raw?: unknown) => unknown;
		return mark(
			(raw?: unknown) =>
				Object.assign(
					Promise.resolve().then(() => handler(raw)),
					{ refresh: async () => {} }
				),
			'query'
		);
	};
	const command = (schema: z.ZodType, handler: (d: unknown) => unknown) =>
		mark(async (raw: unknown) => handler(schema.parse(raw)), 'command');
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'u-1' } } }),
		query,
		command,
		form: command
	};
});

const held = vi.hoisted(() => ({ caps: new Set<string>() }));
vi.mock('#lib/server/authorization.js', () => ({
	can: async (cap: string) => held.caps.has(cap),
	requireCapability: async () => ({ id: 'u-1' })
}));
const setPreference = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('#lib/server/notification/preference-service.js', () => ({
	getAllPreferences: async () => ({}),
	setPreference
}));
vi.mock('#lib/server/notification/in-app-service.js', () => ({}));
vi.mock('./account.remote', () => ({ getMemberAccount: () => ({ refresh: async () => {} }) }));

const remote = (await import('./notifications.remote')) as unknown as {
	getNotificationPreferences: () => Promise<{ key: string }[]>;
	setNotificationPreference: (d: unknown) => Promise<unknown>;
};

const save = (notificationType: string) =>
	remote.setNotificationPreference({ notificationType, email: false, inApp: true });

beforeEach(() => {
	held.caps = new Set();
	setPreference.mockClear();
});

describe('staff-only notification switches', () => {
	it('offers a holder the types their capability receives, and no others', async () => {
		held.caps = new Set(['moderation.reviewFlags']);
		const keys = (await remote.getNotificationPreferences()).map((t) => t.key);
		expect(keys).toContain('content_flagged');
		expect(keys).not.toContain('volunteer_hours_submitted');
	});

	it('refuses a type the caller cannot receive, and writes nothing', async () => {
		held.caps = new Set(['audit.read']);
		await expect(save('content_flagged')).rejects.toMatchObject({ status: 403 });
		expect(setPreference).not.toHaveBeenCalled();
	});

	it('saves it for a holder', async () => {
		held.caps = new Set(['moderation.reviewFlags']);
		await save('content_flagged');
		expect(setPreference).toHaveBeenCalledWith('u-1', 'content_flagged', {
			email: false,
			inApp: true,
			sms: false
		});
	});
});

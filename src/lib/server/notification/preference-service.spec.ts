import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { getPreference, getAllPreferences, setPreference } = await import('./preference-service');

function pref(userId: string, type: string, email: boolean, inApp: boolean, sms = false) {
	sqlite
		.prepare(
			`insert into notification_preference (id, user_id, notification_type, email_enabled, in_app_enabled, sms_enabled)
			 values (?, ?, ?, ?, ?, ?)`
		)
		.run(`${userId}-${type}`, userId, type, email ? 1 : 0, inApp ? 1 : 0, sms ? 1 : 0);
}

const rows = () =>
	sqlite
		.prepare(
			`select user_id, notification_type, email_enabled, in_app_enabled, sms_enabled
			 from notification_preference order by user_id, notification_type`
		)
		.all();

beforeEach(() => {
	sqlite.exec(`delete from notification_preference`);
});

describe('getPreference', () => {
	it('returns a mandatory type its defaults even over a stored opt-out', async () => {
		pref('user-1', 'membership_receipt', false, false);

		expect(await getPreference('user-1', 'membership_receipt')).toEqual({
			email: true,
			inApp: true,
			sms: false
		});
	});

	it("returns the member's stored row for a non-mandatory type", async () => {
		pref('user-1', 'check_in_reminder', false, true, true);

		expect(await getPreference('user-1', 'check_in_reminder')).toEqual({
			email: false,
			inApp: true,
			sms: true
		});
	});

	it("ignores another member's row and another type's row", async () => {
		pref('user-2', 'inbox_message_received', true, false);
		pref('user-1', 'check_in_reminder', true, false);

		expect(await getPreference('user-1', 'inbox_message_received')).toEqual({
			email: false,
			inApp: true,
			sms: false
		});
	});

	it('falls back to email + in-app for an unknown type', async () => {
		expect(await getPreference('user-1', 'unknown_type')).toEqual({
			email: true,
			inApp: true,
			sms: false
		});
	});
});

describe('getAllPreferences', () => {
	it('returns an empty object when the member has no rows', async () => {
		pref('user-2', 'band_invitation', false, false);

		expect(await getAllPreferences('user-1')).toEqual({});
	});

	it("keys only the member's own rows by type", async () => {
		pref('user-1', 'check_in_reminder', false, true);
		pref('user-1', 'band_invitation', true, false);
		pref('user-2', 'contact_form', false, false);

		expect(await getAllPreferences('user-1')).toEqual({
			check_in_reminder: { email: false, inApp: true, sms: false },
			band_invitation: { email: true, inApp: false, sms: false }
		});
	});
});

describe('setPreference', () => {
	it('inserts a row, then overwrites the same row on a second call', async () => {
		await setPreference('user-1', 'band_invitation', { email: true, inApp: false, sms: false });
		await setPreference('user-1', 'band_invitation', { email: false, inApp: true, sms: true });
		await setPreference('user-2', 'band_invitation', { email: true, inApp: true, sms: false });

		expect(rows()).toEqual([
			{
				user_id: 'user-1',
				notification_type: 'band_invitation',
				email_enabled: 0,
				in_app_enabled: 1,
				sms_enabled: 1
			},
			{
				user_id: 'user-2',
				notification_type: 'band_invitation',
				email_enabled: 1,
				in_app_enabled: 1,
				sms_enabled: 0
			}
		]);
	});
});

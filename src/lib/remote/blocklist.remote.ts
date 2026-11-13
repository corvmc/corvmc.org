import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '#lib/server/authorization.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { BLOCKLIST_NOTE_MAX } from '#lib/config.js';
import {
	blockEmail,
	listBlocklist,
	normalizeBlocklistEmail,
	unblockEmail
} from '#lib/server/moderation/blocklist-service.js';

/**
 * The email blocklist: addresses refused at sign-up. Behind `user.ban`, the
 * capability that already decides who may remove an account.
 */
export const getBlocklist = query(async () => {
	await requireCapability('user.ban');
	return listBlocklist();
});

export const addToBlocklist = form(
	z.object({
		email: z.string().trim().email().max(254),
		note: z.string().trim().max(BLOCKLIST_NOTE_MAX).optional()
	}),
	async (data) => {
		const me = await requireCapability('user.ban');
		const email = normalizeBlocklistEmail(data.email);
		const id = await blockEmail({
			email,
			source: 'staff',
			addedByUserId: me.id,
			note: data.note || null
		});
		await recordAuditEntry({
			action: 'blocklist.added',
			subject: { type: 'email_blocklist', id, label: email },
			details: {}
		});
		void getBlocklist().refresh();
		return { success: true };
	}
);

export const removeFromBlocklist = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('user.ban');
	const email = await unblockEmail(data.id);
	await recordAuditEntry({
		action: 'blocklist.removed',
		subject: { type: 'email_blocklist', id: data.id, label: email },
		details: {}
	});
	void getBlocklist().refresh();
	return { success: true };
});

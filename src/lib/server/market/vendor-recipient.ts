import { db } from '#lib/server/db/index.js';
import { eq, inArray } from 'drizzle-orm';
import { inboxThread } from '#lib/server/db/schema/inbox.js';
import { primaryContactsUnguarded } from '#lib/server/directory/contact-service.js';

/**
 * Where mail to a market vendor goes (#2830): the vendor organization's
 * primary contact in Contacts. The address typed on the application is the
 * fallback, used only when the organization has no contact with an email.
 * `scripts/vendor-mail-recipient.spec.ts` fails a market sender that reads the
 * application's address any other way.
 */
export type VendorRecipient = {
	name: string | null;
	email: string | null;
	phone: string | null;
	source: 'contact' | 'application';
};

type VendorRef = { id: string; organizationId: string | null; threadId: string | null };

export async function vendorRecipients(
	vendors: VendorRef[]
): Promise<Map<string, VendorRecipient>> {
	const orgIds = [...new Set(vendors.map((v) => v.organizationId).filter((o): o is string => !!o))];
	const threadIds = [...new Set(vendors.map((v) => v.threadId).filter((t): t is string => !!t))];
	const [people, threads] = await Promise.all([
		primaryContactsUnguarded(orgIds),
		threadIds.length === 0
			? []
			: db
					.select({
						id: inboxThread.id,
						name: inboxThread.contactName,
						email: inboxThread.contactEmail,
						phone: inboxThread.contactPhone
					})
					.from(inboxThread)
					.where(inArray(inboxThread.id, threadIds))
	]);
	const byThread = new Map(threads.map((t) => [t.id, t]));
	const out = new Map<string, VendorRecipient>();
	for (const v of vendors) {
		const person = v.organizationId ? people.get(v.organizationId) : undefined;
		if (person?.email) {
			out.set(v.id, {
				name: person.name,
				email: person.email,
				phone: person.phone,
				source: 'contact'
			});
			continue;
		}
		const typed = v.threadId ? byThread.get(v.threadId) : undefined;
		out.set(v.id, {
			name: typed?.name ?? null,
			email: typed?.email ?? null,
			phone: typed?.phone ?? null,
			source: 'application'
		});
	}
	return out;
}

export async function vendorRecipient(vendor: VendorRef): Promise<VendorRecipient> {
	return (await vendorRecipients([vendor])).get(vendor.id)!;
}

/**
 * Point the vendor's thread at its recipient, so the outbox sends there and a
 * reply from that address lands on the same thread. The thread's messages stay
 * as history. Returns batch statements, wrapped in an array because an async
 * function would run a bare query builder it returned. Empty when there is no
 * thread, or no contact to point it at.
 */
export async function addressVendorThread(vendor: VendorRef) {
	if (!vendor.threadId) return [];
	const to = await vendorRecipient(vendor);
	if (to.source !== 'contact') return [];
	return [
		db
			.update(inboxThread)
			.set({
				...(to.name && { contactName: to.name }),
				contactEmail: to.email,
				updatedAt: new Date()
			})
			.where(eq(inboxThread.id, vendor.threadId))
	];
}

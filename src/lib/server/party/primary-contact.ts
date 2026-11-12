import { can } from '#lib/server/authorization.js';
import { primaryContacts, setPrimaryContact } from '#lib/server/directory/contact-service.js';

/**
 * The main person at an organization, for the Sponsors, Funders and
 * Contractors forms that still carry one name, email and phone.
 *
 * Contact fields need `contact.read` to see and `contact.manage` to change,
 * on top of the record's own capability. A viewer without them gets blanks,
 * and their save leaves the person as it was.
 */

export type ContactFields = {
	contactName: string | null;
	contactEmail: string | null;
	contactPhone: string | null;
};

const BLANK: ContactFields = { contactName: null, contactEmail: null, contactPhone: null };

export async function withPrimaryContact<T extends { id: string }>(
	rows: T[]
): Promise<(T & ContactFields)[]> {
	if (rows.length === 0 || !(await can('contact.read'))) {
		return rows.map((r) => ({ ...r, ...BLANK }));
	}
	const people = await primaryContacts(rows.map((r) => r.id));
	return rows.map((r) => {
		const p = people.get(r.id);
		return p
			? { ...r, contactName: p.name, contactEmail: p.email, contactPhone: p.phone }
			: { ...r, ...BLANK };
	});
}

export async function savePrimaryContact(
	organizationId: string,
	fields: Partial<ContactFields>
): Promise<void> {
	if (!(await can('contact.manage'))) return;
	await setPrimaryContact(organizationId, {
		name: fields.contactName,
		email: fields.contactEmail,
		phone: fields.contactPhone
	});
}

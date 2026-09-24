import { db } from '$lib/server/db';
import { localResource, localResourceCategory } from '$lib/server/db/schema/local-resource';
import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import type { LocalResourceStatus } from '$lib/config';
import { domainEvents, type DomainEvents } from '$lib/server/event-bus';
import { captureException } from '$lib/server/sentry';

/**
 * The local resources directory: a public, staff-curated list of music
 * businesses and services. docs/specs/shipped/local-resources-spec.md
 */

export const LOCAL_RESOURCE_NAME_MAX = 120;
export const LOCAL_RESOURCE_DESCRIPTION_MAX = 400;
export const LOCAL_RESOURCE_FIELD_MAX = 200;

export class LocalResourceNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('That listing no longer exists');
		this.name = 'LocalResourceNotFoundError';
	}
}

export class LocalResourceValidationError extends DomainError {
	readonly httpStatus = 422;
	constructor(message: string) {
		super(message);
		this.name = 'LocalResourceValidationError';
	}
}

export class LocalResourceCategoryInUseError extends DomainError {
	readonly httpStatus = 409;
	constructor(n: number) {
		super(`${n} ${n === 1 ? 'listing uses' : 'listings use'} this category. Move them first.`);
		this.name = 'LocalResourceCategoryInUseError';
	}
}

export interface LocalResourceInput {
	categoryId: string;
	name: string;
	description?: string | null;
	website?: string | null;
	phone?: string | null;
	addressLine?: string | null;
	displayOrder?: number;
}

function optional(value: string | null | undefined, max: number, what: string) {
	const trimmed = value?.trim() ?? '';
	if (trimmed.length > max) {
		throw new LocalResourceValidationError(`Keep the ${what} under ${max} characters.`);
	}
	return trimmed || null;
}

/** Rendered as a public link, so only a web address is allowed through. */
function website(value: string | null | undefined) {
	const trimmed = optional(value, LOCAL_RESOURCE_FIELD_MAX, 'website');
	if (!trimmed) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw new LocalResourceValidationError('That website is not a web address.');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new LocalResourceValidationError('That website is not a web address.');
	}
	return url.toString();
}

function clean(input: LocalResourceInput) {
	const name = input.name.trim();
	if (!name) throw new LocalResourceValidationError('Give it a name.');
	if (name.length > LOCAL_RESOURCE_NAME_MAX) {
		throw new LocalResourceValidationError(
			`Keep the name under ${LOCAL_RESOURCE_NAME_MAX} characters.`
		);
	}
	return {
		categoryId: input.categoryId,
		name,
		description: optional(input.description, LOCAL_RESOURCE_DESCRIPTION_MAX, 'description'),
		website: website(input.website),
		phone: optional(input.phone, 40, 'phone number'),
		addressLine: optional(input.addressLine, LOCAL_RESOURCE_FIELD_MAX, 'address'),
		displayOrder: input.displayOrder ?? 0
	};
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** The public page's one query: published listings grouped by category, in order. */
export async function listPublishedByCategory() {
	const rows = await db
		.select({
			categoryId: localResourceCategory.id,
			categoryName: localResourceCategory.name,
			resource: {
				id: localResource.id,
				name: localResource.name,
				description: localResource.description,
				website: localResource.website,
				phone: localResource.phone,
				addressLine: localResource.addressLine
			}
		})
		.from(localResource)
		.innerJoin(localResourceCategory, eq(localResourceCategory.id, localResource.categoryId))
		.where(and(eq(localResource.status, 'published'), isNull(localResource.deletedAt)))
		.orderBy(
			asc(localResourceCategory.displayOrder),
			asc(localResourceCategory.name),
			asc(localResource.displayOrder),
			asc(localResource.name),
			asc(localResource.id)
		);

	const groups: {
		id: string;
		name: string;
		resources: (typeof rows)[number]['resource'][];
	}[] = [];
	for (const row of rows) {
		let group = groups.at(-1);
		if (group?.id !== row.categoryId) {
			group = { id: row.categoryId, name: row.categoryName, resources: [] };
			groups.push(group);
		}
		group.resources.push(row.resource);
	}
	return groups;
}

// ---------------------------------------------------------------------------
// Staff: listings
// ---------------------------------------------------------------------------

/** Pending first — the review queue — then everything else by name. */
export async function listResourcesForStaff(filters: { status?: LocalResourceStatus } = {}) {
	return db
		.select({
			id: localResource.id,
			name: localResource.name,
			status: localResource.status,
			website: localResource.website,
			categoryName: localResourceCategory.name,
			createdAt: localResource.createdAt
		})
		.from(localResource)
		.innerJoin(localResourceCategory, eq(localResourceCategory.id, localResource.categoryId))
		.where(
			and(
				isNull(localResource.deletedAt),
				filters.status ? eq(localResource.status, filters.status) : undefined
			)
		)
		.orderBy(
			sql`case ${localResource.status} when 'pending' then 0 when 'rejected' then 1 else 2 end`,
			asc(localResource.name),
			asc(localResource.id)
		);
}

/** Only a public tip is ever `pending`: staff listings publish as they save. */
const pendingTip = () => and(eq(localResource.status, 'pending'), isNull(localResource.deletedAt));

/** The tips queue (#1566): oldest first, so nothing waits behind newer tips. */
export async function listTips() {
	return db
		.select({
			id: localResource.id,
			name: localResource.name,
			categoryName: localResourceCategory.name,
			website: localResource.website,
			submitterEmail: localResource.submitterEmail,
			createdAt: localResource.createdAt
		})
		.from(localResource)
		.innerJoin(localResourceCategory, eq(localResourceCategory.id, localResource.categoryId))
		.where(pendingTip())
		.orderBy(asc(localResource.createdAt), asc(localResource.id));
}

export async function countPendingTips(): Promise<number> {
	const [row] = await db.select({ value: count() }).from(localResource).where(pendingTip());
	return row?.value ?? 0;
}

export async function getResource(id: string) {
	const [row] = await db
		.select()
		.from(localResource)
		.where(and(eq(localResource.id, id), isNull(localResource.deletedAt)))
		.limit(1);
	if (!row) throw new LocalResourceNotFoundError();
	return row;
}

/** Fire-and-forget: a listener failing must not fail the write that raised it. */
function announce<K extends 'local_resource.submitted' | 'local_resource.reviewed'>(
	name: K,
	payload: DomainEvents[K]
) {
	void domainEvents.emit(name, payload).catch((err) => captureException(err, { event: name }));
}

/** A public tip (#1498): pending until staff publish or return it. */
export async function submitTip(
	input: Omit<LocalResourceInput, 'displayOrder'>,
	from: { submitterEmail: string; submittedByUserId?: string | null }
) {
	const [category] = await db
		.select({ id: localResourceCategory.id })
		.from(localResourceCategory)
		.where(eq(localResourceCategory.id, input.categoryId))
		.limit(1);
	if (!category) throw new LocalResourceValidationError('Pick one of the categories listed.');

	const [row] = await db
		.insert(localResource)
		.values({
			...clean(input),
			status: 'pending',
			submitterEmail: from.submitterEmail.trim().toLowerCase(),
			submittedByUserId: from.submittedByUserId ?? null
		})
		.returning();
	announce('local_resource.submitted', { resourceId: row.id, name: row.name });
	return row;
}

function announceReview(
	before: { id: string; name: string; submitterEmail: string | null },
	published: boolean,
	staffNote: string | null
) {
	if (!before.submitterEmail) return;
	announce('local_resource.reviewed', {
		resourceId: before.id,
		name: before.name,
		submitterEmail: before.submitterEmail,
		published,
		staffNote
	});
}

/** Staff write the list themselves, so their listings are reviewed as they are saved. */
export async function createResource(input: LocalResourceInput, staffUserId: string) {
	const now = new Date();
	const [row] = await db
		.insert(localResource)
		.values({
			...clean(input),
			status: 'published',
			reviewedByUserId: staffUserId,
			reviewedAt: now,
			createdAt: now,
			updatedAt: now
		})
		.returning();
	return row;
}

export async function updateResource(id: string, input: LocalResourceInput) {
	await getResource(id);
	const [row] = await db
		.update(localResource)
		.set({ ...clean(input), updatedAt: new Date() })
		.where(eq(localResource.id, id))
		.returning();
	return row;
}

export async function publishResource(id: string, staffUserId: string) {
	const before = await getResource(id);
	const now = new Date();
	const [row] = await db
		.update(localResource)
		.set({
			status: 'published',
			staffNote: null,
			reviewedByUserId: staffUserId,
			reviewedAt: now,
			updatedAt: now
		})
		.where(eq(localResource.id, id))
		.returning();
	if (before.status !== 'published') announceReview(before, true, null);
	return row;
}

/** A return state: the note says what to change, and the listing can come back. */
export async function rejectResource(id: string, note: string, staffUserId: string) {
	const reason = note.trim();
	if (!reason) throw new LocalResourceValidationError('Say why, so it can be fixed.');
	const before = await getResource(id);
	const now = new Date();
	const staffNote = optional(reason, LOCAL_RESOURCE_DESCRIPTION_MAX, 'reason');
	const [row] = await db
		.update(localResource)
		.set({
			status: 'rejected',
			staffNote,
			reviewedByUserId: staffUserId,
			reviewedAt: now,
			updatedAt: now
		})
		.where(eq(localResource.id, id))
		.returning();
	announceReview(before, false, staffNote);
	return row;
}

export async function removeResource(id: string) {
	await getResource(id);
	const now = new Date();
	await db
		.update(localResource)
		.set({ deletedAt: now, updatedAt: now })
		.where(eq(localResource.id, id));
}

// ---------------------------------------------------------------------------
// Staff: categories
// ---------------------------------------------------------------------------

/** `listings` counts removed ones too — they still hold the category (see deleteCategory). */
export async function listCategories() {
	return db
		.select({
			id: localResourceCategory.id,
			name: localResourceCategory.name,
			displayOrder: localResourceCategory.displayOrder,
			listings: sql<number>`(select count(*) from ${localResource} where ${localResource.categoryId} = ${localResourceCategory.id})`
		})
		.from(localResourceCategory)
		.orderBy(asc(localResourceCategory.displayOrder), asc(localResourceCategory.name));
}

function categoryName(name: string) {
	const trimmed = name.trim();
	if (!trimmed) throw new LocalResourceValidationError('Give the category a name.');
	if (trimmed.length > 60) {
		throw new LocalResourceValidationError('Keep the category name under 60 characters.');
	}
	return trimmed;
}

/** The column is unique; saying so beats a constraint error surfacing as a 500. */
async function assertNameFree(name: string, exceptId?: string) {
	const [taken] = await db
		.select({ id: localResourceCategory.id })
		.from(localResourceCategory)
		.where(
			and(
				eq(localResourceCategory.name, name),
				exceptId ? ne(localResourceCategory.id, exceptId) : undefined
			)
		)
		.limit(1);
	if (taken) throw new LocalResourceValidationError('A category with that name already exists.');
}

export async function createCategory(input: { name: string; displayOrder?: number }) {
	const name = categoryName(input.name);
	await assertNameFree(name);
	const [row] = await db
		.insert(localResourceCategory)
		.values({ name, displayOrder: input.displayOrder ?? 0 })
		.returning();
	return row;
}

export async function updateCategory(id: string, input: { name: string; displayOrder?: number }) {
	const name = categoryName(input.name);
	await assertNameFree(name, id);
	const [row] = await db
		.update(localResourceCategory)
		.set({
			name,
			displayOrder: input.displayOrder ?? 0,
			updatedAt: new Date()
		})
		.where(eq(localResourceCategory.id, id))
		.returning();
	if (!row) throw new LocalResourceValidationError('That category no longer exists.');
	return row;
}

/**
 * Counts removed listings too: the foreign key restricts on them as well, and
 * failing here says why where the constraint would only say no.
 */
export async function deleteCategory(id: string) {
	const [{ n }] = await db
		.select({ n: count() })
		.from(localResource)
		.where(eq(localResource.categoryId, id));
	if (Number(n) > 0) throw new LocalResourceCategoryInUseError(Number(n));
	await db.delete(localResourceCategory).where(eq(localResourceCategory.id, id));
}

import { db } from '$lib/server/db';
import { helpCategory, helpArticle } from '$lib/server/db/schema/help';
import { eq, and, like, or, sql, inArray, asc, exists } from 'drizzle-orm';
import { SEARCH_LIMIT, helpAudiences, type HelpAudience } from '$lib/config';
import { getUserRoles } from '$lib/server/authorization';
import { isSustainingMember } from '$lib/server/finance/subscription-service';

/**
 * Role names that are *not* an elevated position.
 *
 * The elevated test is open-ended by exclusion, and that is deliberate. The
 * previous implementation ranked role names against a closed `ROLE_LEVEL`
 * table, so any name it had never heard of scored below `member`: the moment a
 * position like `treasurer` exists, its holder resolves to `member` and the
 * whole Staff Guide disappears for them. Naming the three non-elevated rows
 * instead means a new position widens access by default, which is the failure
 * direction you want. See docs/specs/admin-vs-staff-spec.md.
 *
 * `sustaining` and `volunteer` are legacy seeded rows that grant nothing;
 * sustaining status comes from the subscription, not the role (below).
 */
const NON_ELEVATED_ROLES = new Set(['member', 'sustaining', 'volunteer']);

/**
 * Stored `min_role` values that predate the audience ladder.
 *
 * `admin` was offered by the article editor, so production rows may carry it.
 * Mapping it to `staff` keeps those articles readable; without an entry here a
 * legacy value matches no audience and the article silently vanishes for
 * everyone. Writes are normalised (`normalizeAudience`) so nothing new lands
 * outside the ladder.
 */
const LEGACY_AUDIENCE: Record<string, HelpAudience> = { admin: 'staff' };

/** Coerce a stored or submitted value onto the ladder. Unknown ⇒ most restrictive. */
export function normalizeAudience(value: string | null | undefined): HelpAudience {
	if (value && (helpAudiences as readonly string[]).includes(value)) return value as HelpAudience;
	return LEGACY_AUDIENCE[value ?? ''] ?? 'staff';
}

/**
 * Every audience value a reader at `audience` may see: their own tier, every
 * tier below it, and any legacy value that maps into those.
 *
 * Returned as a flat string list so the six call sites keep their
 * `inArray(minRole, …)` shape and the `(published, min_role)` index still
 * applies.
 */
function accessibleAudiences(audience: HelpAudience): string[] {
	const ceiling = helpAudiences.indexOf(audience);
	const allowed = helpAudiences.slice(0, ceiling + 1) as readonly string[];
	const legacy = Object.entries(LEGACY_AUDIENCE)
		.filter(([, tier]) => allowed.includes(tier))
		.map(([stored]) => stored);
	return [...allowed, ...legacy];
}

/**
 * Which tier of the help centre this person reads at.
 *
 * Anyone holding a position reads at `staff`; otherwise an active subscription
 * lifts them to `sustaining`. The legacy `sustaining` role is not consulted —
 * `user.subscription` is the source of truth (see subscription-service).
 */
export async function resolveHelpAudience(userId: string): Promise<HelpAudience> {
	const roles = await getUserRoles(userId);
	if (roles.some((r) => !NON_ELEVATED_ROLES.has(r))) return 'staff';
	if (await isSustainingMember(userId)) return 'sustaining';
	return 'member';
}

// ---------------------------------------------------------------------------
// Category Queries
// ---------------------------------------------------------------------------

/**
 * Every category the caller's tier allows, regardless of contents. This is the
 * authoring view — staff need empty and draft-only categories so they have
 * somewhere to file new articles. Reader-facing callers want
 * `listNonEmptyCategories` instead.
 */
export async function listCategories(audience: HelpAudience) {
	const audiences = accessibleAudiences(audience);
	return db
		.select()
		.from(helpCategory)
		.where(inArray(helpCategory.minRole, audiences))
		.orderBy(asc(helpCategory.sortOrder), asc(helpCategory.name));
}

/**
 * Reader-facing categories: as above, but only those holding at least one
 * article the caller can actually open. A category whose articles are all
 * drafts or all above the caller's tier would otherwise render as a card
 * reading "No articles yet" — which looks broken mid-review, and advertises
 * categories (like Staff Guide) the caller can't read.
 */
export async function listNonEmptyCategories(audience: HelpAudience) {
	const audiences = accessibleAudiences(audience);
	return db
		.select()
		.from(helpCategory)
		.where(
			and(
				inArray(helpCategory.minRole, audiences),
				exists(
					db
						.select({ one: sql`1` })
						.from(helpArticle)
						.where(
							and(
								eq(helpArticle.categoryId, helpCategory.id),
								eq(helpArticle.published, true),
								inArray(helpArticle.minRole, audiences)
							)
						)
				)
			)
		)
		.orderBy(asc(helpCategory.sortOrder), asc(helpCategory.name));
}

export async function getCategoryBySlug(slug: string) {
	const [cat] = await db.select().from(helpCategory).where(eq(helpCategory.slug, slug)).limit(1);
	return cat ?? null;
}

// ---------------------------------------------------------------------------
// Article Queries
// ---------------------------------------------------------------------------

export async function listArticlesByCategory(categoryId: string, audience: HelpAudience) {
	const audiences = accessibleAudiences(audience);
	return db
		.select({
			id: helpArticle.id,
			title: helpArticle.title,
			slug: helpArticle.slug,
			summary: helpArticle.summary,
			sortOrder: helpArticle.sortOrder
		})
		.from(helpArticle)
		.where(
			and(
				eq(helpArticle.categoryId, categoryId),
				eq(helpArticle.published, true),
				inArray(helpArticle.minRole, audiences)
			)
		)
		.orderBy(asc(helpArticle.sortOrder), asc(helpArticle.title));
}

export async function getArticleBySlug(slug: string, audience: HelpAudience) {
	const audiences = accessibleAudiences(audience);
	const [article] = await db
		.select()
		.from(helpArticle)
		.where(
			and(
				eq(helpArticle.slug, slug),
				eq(helpArticle.published, true),
				inArray(helpArticle.minRole, audiences)
			)
		)
		.limit(1);
	return article ?? null;
}

export async function searchArticles(query: string, audience: HelpAudience) {
	const audiences = accessibleAudiences(audience);
	const pattern = `%${query}%`;
	return db
		.select({
			id: helpArticle.id,
			title: helpArticle.title,
			slug: helpArticle.slug,
			summary: helpArticle.summary,
			categoryId: helpArticle.categoryId
		})
		.from(helpArticle)
		.where(
			and(
				eq(helpArticle.published, true),
				inArray(helpArticle.minRole, audiences),
				or(
					like(helpArticle.title, pattern),
					like(helpArticle.summary, pattern),
					like(helpArticle.content, pattern)
				)
			)
		)
		.orderBy(
			sql`case when ${helpArticle.title} like ${pattern} then 0 else 1 end`,
			asc(helpArticle.title)
		)
		.limit(SEARCH_LIMIT);
}

// ---------------------------------------------------------------------------
// Staff: list all articles (including unpublished)
// ---------------------------------------------------------------------------

export async function listAllArticles() {
	return db
		.select({
			id: helpArticle.id,
			title: helpArticle.title,
			slug: helpArticle.slug,
			summary: helpArticle.summary,
			categoryId: helpArticle.categoryId,
			source: helpArticle.source,
			minRole: helpArticle.minRole,
			published: helpArticle.published,
			sortOrder: helpArticle.sortOrder,
			createdAt: helpArticle.createdAt,
			updatedAt: helpArticle.updatedAt
		})
		.from(helpArticle)
		.orderBy(asc(helpArticle.sortOrder), asc(helpArticle.title));
}

export async function getArticleById(id: string) {
	const [article] = await db.select().from(helpArticle).where(eq(helpArticle.id, id)).limit(1);
	return article ?? null;
}

// ---------------------------------------------------------------------------
// Category Mutations
// ---------------------------------------------------------------------------

export interface CreateCategoryData {
	name: string;
	slug: string;
	description?: string;
	icon?: string;
	sortOrder?: number;
	minRole?: string;
}

export async function createCategory(data: CreateCategoryData) {
	const [cat] = await db
		.insert(helpCategory)
		.values({
			name: data.name,
			slug: data.slug,
			description: data.description ?? null,
			icon: data.icon ?? null,
			sortOrder: data.sortOrder ?? 0,
			minRole: normalizeAudience(data.minRole ?? 'member')
		})
		.returning();
	return cat;
}

export async function updateCategory(id: string, data: Partial<CreateCategoryData>) {
	const [cat] = await db
		.update(helpCategory)
		.set({
			...data,
			// Normalised on the way in so a legacy or hand-posted value can never
			// land outside the ladder and make the row invisible to everyone.
			...(data.minRole === undefined ? {} : { minRole: normalizeAudience(data.minRole) }),
			updatedAt: new Date()
		})
		.where(eq(helpCategory.id, id))
		.returning();
	return cat;
}

export async function deleteCategory(id: string) {
	await db.delete(helpCategory).where(eq(helpCategory.id, id));
}

// ---------------------------------------------------------------------------
// Article Mutations
// ---------------------------------------------------------------------------

export interface CreateArticleData {
	categoryId: string;
	title: string;
	slug: string;
	summary?: string;
	content: string;
	source?: string;
	minRole?: string;
	published?: boolean;
	sortOrder?: number;
	createdByUserId?: string;
}

export async function createArticle(data: CreateArticleData) {
	const [article] = await db
		.insert(helpArticle)
		.values({
			categoryId: data.categoryId,
			title: data.title,
			slug: data.slug,
			summary: data.summary ?? null,
			content: data.content,
			source: data.source ?? 'dynamic',
			minRole: normalizeAudience(data.minRole ?? 'member'),
			published: data.published ?? false,
			sortOrder: data.sortOrder ?? 0,
			createdByUserId: data.createdByUserId ?? null
		})
		.returning();
	return article;
}

export async function updateArticle(id: string, data: Partial<CreateArticleData>) {
	const [article] = await db
		.update(helpArticle)
		.set({
			...data,
			// Normalised on the way in so a legacy or hand-posted value can never
			// land outside the ladder and make the row invisible to everyone.
			...(data.minRole === undefined ? {} : { minRole: normalizeAudience(data.minRole) }),
			updatedAt: new Date()
		})
		.where(eq(helpArticle.id, id))
		.returning();
	return article;
}

/**
 * Bulk publish/unpublish. `pnpm help:sync` deliberately lands the ~67 markdown
 * articles as drafts for staff review, and one-at-a-time publishing is the
 * thing that keeps the help centre empty after a sync.
 */
export async function setArticlesPublished(ids: string[], published: boolean) {
	if (ids.length === 0) return 0;
	await db
		.update(helpArticle)
		.set({ published, updatedAt: new Date() })
		.where(inArray(helpArticle.id, ids));
	return ids.length;
}

export async function deleteArticle(id: string) {
	await db.delete(helpArticle).where(eq(helpArticle.id, id));
}

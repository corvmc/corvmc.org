import { z } from 'zod';
import { toGenericRef } from '$lib/server/entity/refs';
import { BLURB_MAX, SHORT_TEXT_MAX } from '$lib/config';
import { error } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { requireStaff } from '$lib/server/authorization';
import { generateSlug } from '$lib/server/utils/slug';
import { requireFeature } from '$lib/server/feature-flags';
import {
	listCategories,
	listNonEmptyCategories,
	listArticlesByCategory,
	getArticleBySlug,
	searchArticles,
	listAllArticles,
	resolveUserHelpRole,
	createArticle as createArticleSvc,
	updateArticle as updateArticleSvc,
	deleteArticle as deleteArticleSvc,
	setArticlesPublished,
	createCategory as createCategorySvc,
	updateCategory as updateCategorySvc,
	deleteCategory as deleteCategorySvc,
	getArticleById
} from '$lib/server/help/help-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Slug derivation is `generateSlug` everywhere — one rule, which drops spaces
// rather than hyphenating them. Only affects records created without an explicit
// slug; the static article sync carries its own slugs in frontmatter.
const slugify = generateSlug;

async function requireUserWithRole() {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');
	const role = await resolveUserHelpRole(locals.user.id);
	return { user: locals.user, role };
}

// ---------------------------------------------------------------------------
// Member Queries
// ---------------------------------------------------------------------------

export const getMemberCategories = query(z.void(), async () => {
	await requireFeature('helpArticles');
	const { role } = await requireUserWithRole();
	const categories = await listNonEmptyCategories(role);

	const categoriesWithArticles = await Promise.all(
		categories.map(async (cat) => ({
			...cat,
			articles: await listArticlesByCategory(cat.id, role)
		}))
	);

	return categoriesWithArticles;
});

export const getMemberArticle = query(z.string(), async (slug) => {
	await requireFeature('helpArticles');
	const { role } = await requireUserWithRole();
	const article = await getArticleBySlug(slug, role);
	if (!article) throw error(404, 'Article not found');
	return article;
});

/**
 * The member article page's one load-bearing query.
 *
 * The article and the category list either side of it are both first paint — the list backs the
 * sidebar — and awaiting them side by side is the shape that stops a page rendering past kit
 * 2.64. `getMemberCategories` stays exported: `/member/help` reads it on its own, and a page with
 * one query is not the problem.
 */
export const getMemberArticlePage = query(z.string(), async (slug) => {
	const [article, categories] = await Promise.all([getMemberArticle(slug), getMemberCategories()]);
	return { article, categories };
});

export const searchHelp = query(z.string(), async (q) => {
	const { role } = await requireUserWithRole();
	if (q.trim().length < 2) return [];
	return searchArticles(q.trim(), role);
});

// ---------------------------------------------------------------------------
// Staff Queries
// ---------------------------------------------------------------------------

export const getStaffArticles = query(z.void(), async () => {
	await requireStaff();
	const rows = await listAllArticles();
	// The published/draft state is the row's status column, so the ref carries
	// none. `slug` matters: the staff editor is keyed by id but the member-facing
	// article is addressed by slug, and the ref has to reach both.
	return rows.map((a) => ({
		...a,
		ref: toGenericRef('help', { id: a.id, title: a.title, slug: a.slug })
	}));
});

export const getStaffCategories = query(z.void(), async () => {
	await requireStaff();
	return listCategories('admin');
});

export const getStaffArticle = query(z.string(), async (id) => {
	await requireStaff();
	return getArticleById(id);
});

// ---------------------------------------------------------------------------
// Article Forms
// ---------------------------------------------------------------------------

const createArticleSchema = z.object({
	categoryId: z.string().min(1),
	title: z.string().trim().min(1).max(SHORT_TEXT_MAX),
	slug: z.string().trim().max(SHORT_TEXT_MAX).optional().default(''),
	summary: z.string().trim().max(BLURB_MAX).optional(),
	content: z.string().min(1),
	minRole: z.string().default('member'),
	published: z.boolean().default(false)
});

export const createArticle = form(createArticleSchema, async (data) => {
	const staff = await requireStaff();
	const article = await createArticleSvc({
		...data,
		slug: data.slug || slugify(data.title),
		createdByUserId: staff.id
	});
	return { id: article.id };
});

const updateArticleSchema = z.object({
	id: z.string().min(1),
	categoryId: z.string().min(1),
	title: z.string().trim().min(1).max(SHORT_TEXT_MAX),
	slug: z.string().trim().min(1).max(SHORT_TEXT_MAX),
	summary: z.string().trim().max(BLURB_MAX).optional(),
	content: z.string().min(1),
	minRole: z.string(),
	published: z.boolean().default(false)
});

export const updateArticle = form(updateArticleSchema, async (data) => {
	await requireStaff();
	const { id, ...rest } = data;
	await updateArticleSvc(id, rest);
	return { success: true };
});

/** Bulk publish/unpublish from the staff list — the counterpart to `help:sync`. */
export const setArticlesPublishedForm = form(
	z.object({
		ids: z.array(z.string().min(1)).min(1).max(200),
		// Both call sites post this as a hidden input, so a value always arrives
		// and the default never fires. It has to be optional regardless: kit
		// rejects a required boolean in a form schema, because an unchecked
		// checkbox sends nothing at all.
		published: z.boolean().optional().default(false)
	}),
	async (data) => {
		await requireStaff();
		const count = await setArticlesPublished(data.ids, data.published);
		// The wrapper, not `getStaffArticles`: `/staff/help` is the only thing that read the list
		// and it reads it through `getStaffHelpPage` now, so refreshing the constituent would
		// repaint nothing. See `custom/refresh-the-composed-query`.
		void getStaffHelpPage().refresh();
		return { count };
	}
);

export const deleteArticle = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireStaff();
	await deleteArticleSvc(data.id);
	return { success: true };
});

// ---------------------------------------------------------------------------
// Category Forms
// ---------------------------------------------------------------------------

const createCategorySchema = z.object({
	name: z.string().trim().min(1).max(100),
	slug: z.string().trim().max(100).optional().default(''),
	description: z.string().trim().max(500).optional(),
	icon: z.string().max(50).optional(),
	sortOrder: z
		.string()
		.optional()
		.default('0')
		.transform((v) => parseInt(v, 10)),
	minRole: z.string().default('member')
});

export const createCategory = form(createCategorySchema, async (data) => {
	await requireStaff();
	const cat = await createCategorySvc({
		...data,
		slug: data.slug || slugify(data.name)
	});
	return { id: cat.id };
});

const updateCategorySchema = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(100).optional(),
	slug: z.string().trim().min(1).max(100).optional(),
	description: z.string().trim().max(500).optional(),
	icon: z.string().max(50).optional(),
	sortOrder: z
		.string()
		.optional()
		.transform((v) => (v != null ? parseInt(v, 10) : undefined)),
	minRole: z.string().optional()
});

export const updateCategory = form(updateCategorySchema, async (data) => {
	await requireStaff();
	const { id, ...rest } = data;
	await updateCategorySvc(id, rest);
	return { success: true };
});

export const deleteCategory = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireStaff();
	await deleteCategorySvc(data.id);
	return { success: true };
});

/** The staff help list's one load-bearing query. See `getMemberArticlePage`. */
export const getStaffHelpPage = query(z.void(), async () => {
	const [articles, categories] = await Promise.all([getStaffArticles(), getStaffCategories()]);
	return { articles, categories };
});

/** The staff article editor's one load-bearing query. See `getMemberArticlePage`. */
export const getStaffArticlePage = query(z.string(), async (id) => {
	const [article, categories] = await Promise.all([getStaffArticle(id), getStaffCategories()]);
	return { article, categories };
});

import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { localResourceStatuses } from '$lib/config';
import {
	createCategory,
	createResource,
	deleteCategory,
	getResource,
	listCategories,
	listPublishedByCategory,
	listResourcesForStaff,
	publishResource,
	rejectResource,
	removeResource,
	updateCategory,
	updateResource,
	LOCAL_RESOURCE_DESCRIPTION_MAX,
	LOCAL_RESOURCE_FIELD_MAX,
	LOCAL_RESOURCE_NAME_MAX
} from '$lib/server/local-resource/local-resource-service';

/**
 * The local resources directory. The public list is unguarded — the service
 * filters to published listings in the query. Everything else is staff-only.
 */

export const getLocalResourceDirectory = query(async () => listPublishedByCategory());

export const getStaffLocalResources = query(
	z.object({ status: z.enum(localResourceStatuses).optional() }),
	async (filters) => {
		await requireCapability('localResource.manage');
		const [resources, categories] = await Promise.all([
			listResourcesForStaff(filters),
			listCategories()
		]);
		return { resources, categories };
	}
);

export const getStaffLocalResource = query(z.string(), async (id) => {
	await requireCapability('localResource.manage');
	try {
		const [resource, categories] = await Promise.all([getResource(id), listCategories()]);
		return { resource, categories };
	} catch (err) {
		mapDomainError(err);
	}
});

export const getLocalResourceCategories = query(async () => {
	await requireCapability('localResource.manage');
	return listCategories();
});

const resourceFields = {
	categoryId: z.string().min(1, 'Pick a category'),
	name: z.string().trim().min(1).max(LOCAL_RESOURCE_NAME_MAX),
	description: z.string().max(LOCAL_RESOURCE_DESCRIPTION_MAX).optional(),
	website: z.string().max(LOCAL_RESOURCE_FIELD_MAX).optional(),
	phone: z.string().max(40).optional(),
	addressLine: z.string().max(LOCAL_RESOURCE_FIELD_MAX).optional()
};

export const createLocalResourceForm = form(z.object(resourceFields), async (data) => {
	const staff = await requireCapability('localResource.manage');
	const row = await createResource(data, staff.id);
	void getLocalResourceDirectory().refresh();
	return { success: true, id: row.id };
});

export const updateLocalResourceForm = form(
	z.object({ id: z.string().min(1), ...resourceFields }),
	async ({ id, ...data }) => {
		await requireCapability('localResource.manage');
		await updateResource(id, data);
		void getStaffLocalResource(id).refresh();
		void getLocalResourceDirectory().refresh();
		return { success: true };
	}
);

export const publishLocalResourceForm = form(z.object({ id: z.string().min(1) }), async (data) => {
	const staff = await requireCapability('localResource.manage');
	await publishResource(data.id, staff.id);
	void getStaffLocalResource(data.id).refresh();
	void getLocalResourceDirectory().refresh();
	return { success: true };
});

export const rejectLocalResourceForm = form(
	z.object({
		id: z.string().min(1),
		note: z.string().trim().min(1, 'Say why, so it can be fixed').max(400)
	}),
	async (data) => {
		const staff = await requireCapability('localResource.manage');
		await rejectResource(data.id, data.note, staff.id);
		void getStaffLocalResource(data.id).refresh();
		void getLocalResourceDirectory().refresh();
		return { success: true };
	}
);

export const removeLocalResourceForm = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('localResource.manage');
	await removeResource(data.id);
	void getLocalResourceDirectory().refresh();
	return { success: true };
});

const categoryFields = {
	name: z.string().trim().min(1).max(60),
	displayOrder: z.number().int().min(0).max(999).optional()
};

export const createLocalResourceCategoryForm = form(z.object(categoryFields), async (data) => {
	await requireCapability('localResource.manage');
	await createCategory(data);
	void getLocalResourceCategories().refresh();
	return { success: true };
});

export const updateLocalResourceCategoryForm = form(
	z.object({ id: z.string().min(1), ...categoryFields }),
	async ({ id, ...data }) => {
		await requireCapability('localResource.manage');
		await updateCategory(id, data);
		void getLocalResourceCategories().refresh();
		void getLocalResourceDirectory().refresh();
		return { success: true };
	}
);

export const deleteLocalResourceCategoryForm = form(
	z.object({ id: z.string().min(1) }),
	async (data) => {
		await requireCapability('localResource.manage');
		await deleteCategory(data.id);
		void getLocalResourceCategories().refresh();
		return { success: true };
	}
);

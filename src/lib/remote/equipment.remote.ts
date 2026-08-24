import { z } from 'zod';
import { toGenericRef } from '$lib/server/entity/refs';
import { error } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { requireStaff, requireStaffOrOwner, requireUser } from '$lib/server/authorization';
import { requireFeature } from '$lib/server/feature-flags';
import {
	createEquipment as createEquipmentService,
	updateEquipment,
	getEquipmentById,
	listCategories,
	listEquipment,
	createCategory,
	updateCategory,
	deleteCategory,
	softDeleteEquipment,
	restoreEquipment
} from '$lib/server/equipment/equipment-service';
import {
	getLoanById,
	getLoanHistory,
	scheduleLoan,
	checkoutLoan,
	requestLoan,
	cancelLoan as cancelLoanService,
	returnLoan as returnLoanService,
	listLoans,
	listUserLoans
} from '$lib/server/equipment/loan-service';
import { scheduleLoanSchema, checkoutLoanSchema } from '$lib/server/db/schema/equipment';
import { LONG_TEXT_MAX, SHORT_TEXT_MAX, equipmentConditions, equipmentStatuses } from '$lib/config';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getEquipment = query(z.string(), async (id) => {
	await requireStaff();
	// Staff see deactivated gear too — that page is where Reactivate lives.
	const item = await getEquipmentById(id, { includeDeleted: true });
	if (!item) error(404, 'Equipment not found');
	return item;
});

export const getEquipmentCategories = query(z.void(), async () => {
	await requireStaff();
	return listCategories();
});

export const getEquipmentLoanHistory = query(z.string(), async (equipmentId) => {
	await requireStaff();
	return getLoanHistory(equipmentId);
});

export const getLoan = query(z.string(), async (id) => {
	await requireStaff();
	const loan = await getLoanById(id);
	if (!loan) error(404, 'Loan not found');
	return loan;
});

export const getAvailableEquipment = query(z.void(), async () => {
	await requireStaff();
	const { rows } = await listEquipment({ status: 'available' });
	return rows;
});

const staffEquipmentFilters = z.object({
	search: z.string().optional(),
	categoryId: z.string().optional(),
	status: z.string().optional(),
	includeDeleted: z.boolean().optional(),
	page: z.number().optional()
});

export const getStaffEquipmentList = query(staffEquipmentFilters, async (filters) => {
	await requireStaff();
	const { rows, pagination } = await listEquipment(
		{
			search: filters.search || undefined,
			categoryId: filters.categoryId || undefined,
			status: (filters.status || undefined) as
				| import('$lib/server/db/schema/equipment').EquipmentStatus
				| undefined,
			includeDeleted: filters.includeDeleted
		},
		{ page: filters.page ?? 1, pageSize: 50 }
	);
	return {
		rows: rows.map((e) => ({
			...e,
			// A retired item reports as deactivated rather than by its last
			// condition — the row's own status column already says the same thing,
			// so the ref carries none.
			ref: toGenericRef('equipment', {
				id: e.id,
				title: e.name,
				subtitle: e.category.name
			})
		})),
		pagination
	};
});

const staffLoansFilters = z.object({
	search: z.string().optional(),
	status: z.string().optional(),
	page: z.number().optional()
});

export const getStaffLoans = query(staffLoansFilters, async (filters) => {
	await requireStaff();
	return listLoans(
		{
			search: filters.search || undefined,
			status: (filters.status || undefined) as
				| import('$lib/server/db/schema/equipment').LoanStatus
				| undefined
		},
		{ page: filters.page ?? 1, pageSize: 50 }
	);
});

// ---------------------------------------------------------------------------
// Queries — Member
// ---------------------------------------------------------------------------

const memberEquipmentFilters = z.object({
	search: z.string().optional(),
	categoryId: z.string().optional()
});

export const getMemberEquipment = query(memberEquipmentFilters, async (filters) => {
	await requireFeature('equipment');
	requireUser();
	const { rows } = await listEquipment({
		search: filters.search || undefined,
		categoryId: filters.categoryId || undefined,
		status: 'available'
	});
	return rows.map((e) => ({
		id: e.id,
		name: e.name,
		description: e.description,
		categoryId: e.categoryId,
		categoryName: e.category.name,
		pricingTier: e.category.pricingTier,
		condition: e.condition,
		totalQuantity: e.totalQuantity,
		availableQuantity: e.availableQuantity
	}));
});

export const getMemberEquipmentMeta = query(z.void(), async () => {
	await requireFeature('equipment');
	const currentUser = requireUser();
	const { getBalance } = await import('$lib/server/finance/credit-service');
	const { getSubscription } = await import('$lib/server/finance/subscription-service');

	const [categories, creditBalance] = await Promise.all([
		listCategories(),
		getBalance(currentUser.id, 'equipment_credits')
	]);

	let isSustainingMember = false;
	if (currentUser.stripeId) {
		const sub = await getSubscription(currentUser.stripeId);
		isSustainingMember = sub !== null;
	}

	return {
		categories: categories.map((c) => ({ id: c.id, name: c.name, pricingTier: c.pricingTier })),
		creditBalance,
		isSustainingMember
	};
});

export const getMemberEquipmentLoans = query(async () => {
	await requireFeature('equipment');
	const currentUser = requireUser();
	const loans = await listUserLoans(currentUser.id);

	return {
		active: loans.filter((l) => ['requested', 'scheduled', 'checked_out'].includes(l.status)),
		past: loans.filter((l) => ['returned', 'cancelled'].includes(l.status))
	};
});

// ---------------------------------------------------------------------------
// Forms — Equipment
// ---------------------------------------------------------------------------

const editEquipmentSchema = z.object({
	name: z.string().min(1).max(SHORT_TEXT_MAX).optional(),
	description: z.string().max(LONG_TEXT_MAX).optional(),
	categoryId: z.string().uuid().optional(),
	// `<Field type="number">` submits through `field.as('number')`, so SvelteKit
	// hands the handler a number (or `undefined` for an empty input) — never a string.
	totalQuantity: z.number().int().min(0).optional(),
	outOfOrderQuantity: z.number().int().min(0).optional(),
	serialNumber: z.string().max(100).optional(),
	resourceId: z.string().max(100).optional(),
	condition: z.enum(equipmentConditions).optional(),
	status: z.enum(equipmentStatuses).optional(),
	notes: z.string().max(2000).optional()
});

export const editEquipment = form(editEquipmentSchema.extend({ id: z.string() }), async (raw) => {
	await requireStaff();
	const data = raw as z.infer<typeof editEquipmentSchema> & { id: string };
	const id = data.id;
	await updateEquipment(id, data);
	void getEquipment(id).refresh();
	return { success: true };
});

export const createEquipment = form(
	z.object({
		name: z.string().min(1).max(SHORT_TEXT_MAX),
		description: z.string().max(LONG_TEXT_MAX).optional(),
		categoryId: z.string(),
		totalQuantity: z.number().int().min(0).optional(),
		outOfOrderQuantity: z.number().int().min(0).optional(),
		serialNumber: z.string().max(100).optional(),
		resourceId: z.string().max(100).optional(),
		condition: z.string(),
		notes: z.string().max(2000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as {
			name: string;
			description?: string;
			categoryId: string;
			totalQuantity?: number;
			outOfOrderQuantity?: number;
			serialNumber?: string;
			resourceId?: string;
			condition: string;
			notes?: string;
		};
		const item = await createEquipmentService({
			name: data.name,
			description: data.description,
			categoryId: data.categoryId,
			condition: data.condition as (typeof equipmentConditions)[number],
			totalQuantity: data.totalQuantity ?? 1,
			outOfOrderQuantity: data.outOfOrderQuantity ?? 0,
			serialNumber: data.serialNumber,
			resourceId: data.resourceId,
			notes: data.notes
		});
		return { equipmentId: item.id };
	}
);

export const deactivateEquipment = form(z.object({ id: z.string() }), async (data) => {
	await requireStaff();
	await softDeleteEquipment(data.id as string);
	void getEquipment(data.id as string).refresh();
	return { success: true };
});

export const reactivateEquipment = form(z.object({ id: z.string() }), async (data) => {
	await requireStaff();
	await restoreEquipment(data.id as string);
	void getEquipment(data.id as string).refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Forms — Categories
// ---------------------------------------------------------------------------

export const addCategory = form(
	z.object({
		name: z.string().min(1).max(100),
		displayOrder: z.string().optional(),
		pricingTier: z.string()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as { name: string; displayOrder?: string; pricingTier: string };
		const cat = await createCategory({
			name: data.name,
			displayOrder: data.displayOrder ? parseInt(data.displayOrder, 10) : 0,
			pricingTier: data.pricingTier as 'major' | 'accessory'
		});
		void getEquipmentCategories().refresh();
		return { categoryId: cat.id };
	}
);

export const editCategory = form(
	z.object({
		id: z.string(),
		name: z.string().min(1).max(100).optional(),
		displayOrder: z.string().optional(),
		pricingTier: z.string().optional()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as {
			id: string;
			name?: string;
			displayOrder?: string;
			pricingTier?: string;
		};
		const { id, ...rest } = data;
		await updateCategory(id, {
			name: rest.name,
			displayOrder: rest.displayOrder ? parseInt(rest.displayOrder, 10) : undefined,
			pricingTier: rest.pricingTier as 'major' | 'accessory' | undefined
		});
		void getEquipmentCategories().refresh();
		return { success: true };
	}
);

export const removeCategory = form(z.object({ id: z.string() }), async (data) => {
	await requireStaff();
	await deleteCategory(data.id as string);
	void getEquipmentCategories().refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Forms — Loans
// ---------------------------------------------------------------------------

export const scheduleLoanForm = form('unchecked', async (data, issue) => {
	await requireStaff();
	const result = scheduleLoanSchema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.map((err: any) => {
				const key = String(err.path[0] ?? '');
				return (issue as any)[key]?.(err.message);
			})
			.filter(Boolean);
		(await import('@sveltejs/kit')).invalid(...issues);
	}
	const loanId = (data as { loanId: string }).loanId;
	await scheduleLoan(loanId, {
		equipmentId: result.data!.equipmentId,
		scheduledPickupDate: result.data!.scheduledPickupDate
	});
	void getLoan(loanId).refresh();
	return { success: true };
});

export const checkoutLoanForm = form('unchecked', async (data, issue) => {
	await requireStaff();
	const result = checkoutLoanSchema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.map((err: any) => {
				const key = String(err.path[0] ?? '');
				return (issue as any)[key]?.(err.message);
			})
			.filter(Boolean);
		(await import('@sveltejs/kit')).invalid(...issues);
	}
	const loanId = (data as { loanId: string }).loanId;
	await checkoutLoan(loanId, { dueDate: result.data!.dueDate });
	void getLoan(loanId).refresh();
	return { success: true };
});

export const createLoan = form(
	z.object({
		userId: z.string(),
		equipmentId: z.string().optional(),
		// Staff's Create Loan modal binds this with `field=`, so it arrives as a
		// number. The member-facing `submitLoanRequest` below uses a bare `name=`
		// and still gets a string.
		quantity: z.number().int().min(1).optional(),
		requestedPickupDate: z.string().min(1),
		estimatedReturnDate: z.string().min(1),
		memberNotes: z.string().max(1000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as {
			userId: string;
			equipmentId?: string;
			quantity?: number;
			requestedPickupDate: string;
			estimatedReturnDate: string;
			memberNotes?: string;
		};
		await requestLoan(data.userId, {
			equipmentId: data.equipmentId || undefined,
			quantity: data.quantity ?? 1,
			requestedPickupDate: new Date(data.requestedPickupDate),
			estimatedReturnDate: new Date(data.estimatedReturnDate),
			memberNotes: data.memberNotes
		});
		return { success: true };
	}
);

export const submitLoanRequest = form(
	z.object({
		equipmentId: z.string().optional(),
		quantity: z.string().optional(),
		requestedPickupDate: z.string().min(1),
		estimatedReturnDate: z.string().min(1),
		memberNotes: z.string().max(1000).optional()
	}),
	async (raw) => {
		const data = raw as {
			equipmentId?: string;
			quantity?: string;
			requestedPickupDate: string;
			estimatedReturnDate: string;
			memberNotes?: string;
		};
		const currentUser = requireUser();

		const loan = await requestLoan(currentUser.id, {
			equipmentId: data.equipmentId || undefined,
			quantity: data.quantity ? parseInt(data.quantity, 10) : 1,
			requestedPickupDate: new Date(data.requestedPickupDate),
			estimatedReturnDate: new Date(data.estimatedReturnDate),
			memberNotes: data.memberNotes
		});

		return { success: true, loanId: loan.id };
	}
);

export const cancelLoan = form(z.object({ id: z.string() }), async (data) => {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');

	const loanId = data.id as string;
	const loan = await getLoanById(loanId);
	if (!loan) throw error(404, 'Loan not found');

	// Staff may cancel at any point; the borrower only before pickup.
	const role = await requireStaffOrOwner(locals.user.id, loan.userId);
	if (role === 'owner') {
		if (loan.status !== 'requested' && loan.status !== 'scheduled') {
			throw error(400, 'Cannot cancel a loan that has been checked out');
		}
	}

	await cancelLoanService(loanId);
	void getLoan(loanId).refresh();
	return { success: true };
});

export const returnLoan = form(
	z.object({
		id: z.string(),
		staffNotes: z.string().max(2000).optional()
	}),
	async (data) => {
		await requireStaff();
		await returnLoanService(data.id as string, (data.staffNotes as string) || undefined);
		void getLoan(data.id as string).refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserLoans = query(z.string(), async (userId) => {
	await requireStaff();
	return listUserLoans(userId);
});

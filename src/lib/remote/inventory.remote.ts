import { z } from 'zod';
import { toGenericRef } from '$lib/server/entity/refs';
import { error, invalid } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { requireStaff, requireStaffOrOwner, requireUser } from '$lib/server/authorization';
import {
	createCategory,
	createItem as createItemService,
	createLocation,
	deleteCategory,
	getItemById,
	listCategories,
	listItems,
	listLocations,
	listLocationsWithCounts,
	restoreItem,
	softDeleteItem,
	updateCategory,
	updateItem
} from '$lib/server/inventory/item-service';
import {
	bindAssetTag,
	createAsset as createAssetService,
	getAssetById,
	listAssets,
	listAvailableAssets,
	listUntaggedAssets,
	listForm8282Obligations,
	resolveForm8282,
	setAssetStatus,
	updateAsset
} from '$lib/server/inventory/asset-service';
import { listLowStock, listMovements } from '$lib/server/inventory/stock-service';
import { contractorSpend, jobsForAsset } from '$lib/server/contractor/contractor-job-service';
import {
	acknowledgeForm8283,
	adjustStock,
	consumeStock,
	getAcquisitionById,
	listAcquisitions,
	markReimbursed,
	recordAcquisition,
	recordAcquisitionBulk,
	spendByCategory,
	updateAcquisition
} from '$lib/server/inventory/acquisition-service';
import {
	applyReceipt,
	cancelOrder,
	closeOrderShort,
	createOrder,
	getOrderById,
	listOrders,
	placeOrder
} from '$lib/server/inventory/order-service';
import { form8282Status } from '$lib/server/inventory/form-8282';
import {
	linkArticle,
	listItemResources,
	listLinkableArticles,
	listMemberItemResources,
	reportDamage,
	unlinkArticle
} from '$lib/server/inventory/resources-service';
import { mapDomainError } from '$lib/server/errors';
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
} from '$lib/server/inventory/loan-service';
import { scheduleLoanSchema, checkoutLoanSchema } from '$lib/server/db/schema/inventory';
import {
	LONG_TEXT_MAX,
	SHORT_TEXT_MAX,
	acquisitionKinds,
	assetStatuses,
	equipmentConditions,
	itemKinds,
	unitsOfMeasure,
	type AssetStatus,
	type AcquisitionKind,
	type ItemKind,
	type LoanStatus,
	DEFAULT_TIMEZONE
} from '$lib/config';
import { buildDateInTz } from '$lib/server/reservation/timezone';

/**
 * A calendar date the operator typed, as an instant.
 *
 * Noon in venue time, which is the house convention — the reasoning is written
 * out at `schema/volunteer.ts`. Midnight UTC would land the previous evening
 * locally, so a stocktake entered on the 1st would file itself on the 31st.
 * Absent means today, because "when did this arrive" is answered by the form
 * only when the answer is not now.
 */
function calendarDate(value: string | undefined): Date {
	return value ? buildDateInTz(value, '12:00', DEFAULT_TIMEZONE) : new Date();
}

// ---------------------------------------------------------------------------
// Queries — Staff
// ---------------------------------------------------------------------------

export const getItem = query(z.string(), async (id) => {
	await requireStaff();
	// Staff see deactivated items too — that page is where Reactivate lives.
	const item = await getItemById(id, { includeDeleted: true });
	if (!item) error(404, 'Item not found');
	return item;
});

export const getEquipmentCategories = query(z.void(), async () => {
	await requireStaff();
	return listCategories();
});

export const getLocations = query(z.void(), async () => {
	await requireStaff();
	return listLocations();
});

/** The locations page's one load-bearing query: the tree plus what sits in each. */
export const getLocationsWithCounts = query(z.void(), async () => {
	await requireStaff();
	return listLocationsWithCounts();
});

export const getItemLoanHistory = query(z.string(), async (itemId) => {
	await requireStaff();
	return getLoanHistory(itemId);
});

export const getItemMovements = query(z.string(), async (itemId) => {
	await requireStaff();
	return listMovements({ itemId });
});

export const getItemAssets = query(z.string(), async (itemId) => {
	await requireStaff();
	return listAssets({ itemId });
});

export const getLoan = query(z.string(), async (id) => {
	await requireStaff();
	const loan = await getLoanById(id);
	if (!loan) error(404, 'Loan not found');
	return loan;
});

export const getAvailableItems = query(z.void(), async () => {
	await requireStaff();
	const { rows } = await listItems({ loanableOnly: true });
	return rows;
});

export const getAvailableAssets = query(z.string(), async (itemId) => {
	await requireStaff();
	return listAvailableAssets(itemId);
});

const staffItemFilters = z.object({
	search: z.string().optional(),
	categoryId: z.string().optional(),
	kind: z.string().optional(),
	includeDeleted: z.boolean().optional(),
	page: z.number().optional()
});

export const getStaffItemList = query(staffItemFilters, async (filters) => {
	await requireStaff();
	const { rows, pagination } = await listItems(
		{
			search: filters.search || undefined,
			categoryId: filters.categoryId || undefined,
			kind: (filters.kind || undefined) as ItemKind | undefined,
			includeDeleted: filters.includeDeleted
		},
		{ page: filters.page ?? 1, pageSize: 50 }
	);
	return {
		rows: rows.map((e) => ({
			...e,
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
			status: (filters.status || undefined) as LoanStatus | undefined
		},
		{ page: filters.page ?? 1, pageSize: 50 }
	);
});

/**
 * The tagging backlog — every unit with no tag bound.
 *
 * Derived, never stored: "needs tagging" is `asset_tag IS NULL`, so binding a
 * tag removes a row here with nothing to keep in sync. One query for the whole
 * page, per `no-concurrent-remote-queries`.
 */
export const getUntaggedAssets = query(z.void(), async () => {
	await requireStaff();
	return listUntaggedAssets();
});

export const getAsset = query(z.string(), async (id) => {
	await requireStaff();
	const asset = await getAssetById(id);
	if (!asset) error(404, 'Asset not found');
	return asset;
});

export const getAssetMovements = query(z.string(), async (assetId) => {
	await requireStaff();
	return listMovements({ assetId });
});

// ---------------------------------------------------------------------------
// Queries — Member
// ---------------------------------------------------------------------------

const memberEquipmentFilters = z.object({
	search: z.string().optional(),
	categoryId: z.string().optional()
});

export const getMemberEquipment = query(memberEquipmentFilters, async (filters) => {
	requireUser();
	const { rows } = await listItems({
		search: filters.search || undefined,
		categoryId: filters.categoryId || undefined,
		loanableOnly: true
	});
	return rows.map((e) => ({
		id: e.id,
		name: e.name,
		description: e.description,
		categoryId: e.categoryId,
		categoryName: e.category.name,
		pricingTier: e.category.pricingTier,
		kind: e.kind,
		onHand: e.onHand,
		availableQuantity: e.availableQuantity
	}));
});

export const getMemberEquipmentMeta = query(z.void(), async () => {
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
	const currentUser = requireUser();
	const loans = await listUserLoans(currentUser.id);

	return {
		active: loans.filter((l) => ['requested', 'scheduled', 'checked_out'].includes(l.status)),
		past: loans.filter((l) => ['returned', 'cancelled'].includes(l.status))
	};
});

/**
 * What a member sees after scanning the sticker on a piece of gear.
 *
 * Deliberately narrower than the staff record: what this is, what shape it is
 * in, and whether it can be borrowed. Not who has it, not what it cost, not who
 * gave it. Phase 4 adds the manual and the report-damage button here.
 */
export const getMemberAsset = query(z.string(), async (id) => {
	requireUser();
	const asset = await getAssetById(id);
	if (!asset) error(404, 'Not found');

	return {
		id: asset.id,
		assetTag: asset.assetTag,
		name: asset.item.name,
		description: asset.item.description,
		categoryName: asset.category.name,
		pricingTier: asset.category.pricingTier,
		condition: asset.condition,
		status: asset.status,
		locationName: asset.location?.name ?? null,
		itemId: asset.itemId,
		isAvailable: asset.status === 'in_service',
		// Already in the shop or gone: the form would change nothing, so the page
		// says what is happening instead of offering it.
		canReportDamage: asset.status === 'in_service' || asset.status === 'on_loan',
		// Assembled here rather than fetched by the component. Both halves are
		// first paint and keyed by the same id, so a second query from the page
		// would be a fan-out — which the custom lint rule rejects and which kit
		// renders as `effect_update_depth_exceeded` past 2.64.
		resources: await listMemberItemResources(asset.itemId)
	};
});

// ---------------------------------------------------------------------------
// Forms — Items
// ---------------------------------------------------------------------------

const editItemSchema = z.object({
	name: z.string().min(1).max(SHORT_TEXT_MAX).optional(),
	description: z.string().max(LONG_TEXT_MAX).optional(),
	categoryId: z.string().uuid().optional(),
	unitOfMeasure: z.enum(unitsOfMeasure).optional(),
	gtin: z.string().max(14).optional(),
	isLoanable: z.boolean().optional().default(false),
	// `<Field type="number">` submits through `field.as('number')`, so SvelteKit
	// hands the handler a number (or `undefined` for an empty input) — never a string.
	reorderPoint: z.number().int().min(0).optional(),
	reorderQuantity: z.number().int().min(1).optional(),
	resourceId: z.string().max(100).optional(),
	notes: z.string().max(2000).optional()
});

export const editItem = form(editItemSchema.extend({ id: z.string() }), async (raw) => {
	await requireStaff();
	const data = raw as z.infer<typeof editItemSchema> & { id: string };
	const id = data.id;
	await updateItem(id, data);
	void getStaffItemDetail(id).refresh();
	return { success: true };
});

export const createItem = form(
	z.object({
		name: z.string().min(1).max(SHORT_TEXT_MAX),
		description: z.string().max(LONG_TEXT_MAX).optional(),
		categoryId: z.string(),
		kind: z.enum(itemKinds),
		unitOfMeasure: z.enum(unitsOfMeasure).optional(),
		gtin: z.string().max(14).optional(),
		isLoanable: z.boolean().optional().default(false),
		reorderPoint: z.number().int().min(0).optional(),
		reorderQuantity: z.number().int().min(1).optional(),
		resourceId: z.string().max(100).optional(),
		notes: z.string().max(2000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as {
			name: string;
			description?: string;
			categoryId: string;
			kind: ItemKind;
			unitOfMeasure?: (typeof unitsOfMeasure)[number];
			gtin?: string;
			isLoanable?: boolean;
			reorderPoint?: number;
			reorderQuantity?: number;
			resourceId?: string;
			notes?: string;
		};
		const item = await createItemService({
			name: data.name,
			description: data.description,
			categoryId: data.categoryId,
			kind: data.kind,
			unitOfMeasure: data.unitOfMeasure,
			gtin: data.gtin,
			isLoanable: data.isLoanable ?? false,
			reorderPoint: data.reorderPoint,
			reorderQuantity: data.reorderQuantity,
			resourceId: data.resourceId,
			notes: data.notes
		});
		return { itemId: item.id };
	}
);

export const deactivateItem = form(z.object({ id: z.string() }), async (data) => {
	await requireStaff();
	await softDeleteItem(data.id as string);
	void getStaffItemDetail(data.id as string).refresh();
	return { success: true };
});

export const reactivateItem = form(z.object({ id: z.string() }), async (data) => {
	await requireStaff();
	await restoreItem(data.id as string);
	void getStaffItemDetail(data.id as string).refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Forms — Assets
// ---------------------------------------------------------------------------

export const createAsset = form(
	z.object({
		itemId: z.string(),
		assetTag: z.string().max(64).optional(),
		serialNumber: z.string().max(100).optional(),
		condition: z.enum(equipmentConditions),
		locationId: z.string().optional(),
		notes: z.string().max(2000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as {
			itemId: string;
			assetTag?: string;
			serialNumber?: string;
			condition: (typeof equipmentConditions)[number];
			locationId?: string;
			notes?: string;
		};
		const currentUser = requireUser();
		const asset = await createAssetService({
			itemId: data.itemId,
			assetTag: data.assetTag || undefined,
			serialNumber: data.serialNumber || undefined,
			condition: data.condition,
			locationId: data.locationId || undefined,
			notes: data.notes,
			actorId: currentUser.id
		});
		void getStaffItemDetail(data.itemId).refresh();
		return { assetId: asset.id };
	}
);

/**
 * Bind a printed tag to a unit — the everyday counterpart to buying a roll of
 * pre-numbered stickers. Rebinding is normal, not an error state.
 */
export const bindTag = form(
	z.object({ assetId: z.string(), assetTag: z.string().min(1).max(64) }),
	async (raw) => {
		await requireStaff();
		const data = raw as { assetId: string; assetTag: string };
		try {
			await bindAssetTag(data.assetId, data.assetTag);
		} catch (err) {
			mapDomainError(err);
		}
		void getStaffAssetDetail(data.assetId).refresh();
		// The tagging page is a list of exactly the units this call removes from
		// it, so it has to be refreshed by name — the page has no id to key on.
		void getUntaggedAssets().refresh();
		return { success: true };
	}
);

export const editAsset = form(
	z.object({
		id: z.string(),
		serialNumber: z.string().max(100).optional(),
		condition: z.enum(equipmentConditions).optional(),
		locationId: z.string().optional(),
		notes: z.string().max(2000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as {
			id: string;
			serialNumber?: string;
			condition?: (typeof equipmentConditions)[number];
			locationId?: string;
			notes?: string;
		};
		await updateAsset(data.id, {
			serialNumber: data.serialNumber,
			condition: data.condition,
			// Absent and empty mean different things, and collapsing them erased
			// data: the unit form did not carry a location field, so every Save
			// sent no `locationId`, this coerced that to `null`, and `updateAsset`
			// — which skips `undefined` but writes `null` — filed the unit under
			// Unassigned. Typing a serial number silently moved gear out of the
			// room it was in.
			//
			// `undefined` is "the form did not ask", `''` is "the operator chose
			// Unassigned". Only the second may clear the column.
			locationId: data.locationId === undefined ? undefined : data.locationId || null,
			notes: data.notes
		});
		void getStaffAssetDetail(data.id).refresh();
		return { success: true };
	}
);

export const changeAssetStatus = form(
	z.object({
		id: z.string(),
		status: z.enum(assetStatuses),
		condition: z.enum(equipmentConditions).optional(),
		notes: z.string().max(2000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as {
			id: string;
			status: AssetStatus;
			condition?: (typeof equipmentConditions)[number];
			notes?: string;
		};
		const currentUser = requireUser();
		await setAssetStatus(data.id, data.status, {
			condition: data.condition,
			notes: data.notes,
			actorId: currentUser.id
		});
		void getStaffAssetDetail(data.id).refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Forms — Stock
// ---------------------------------------------------------------------------

/**
 * Receiving. Every arrival goes through an acquisition, including a $4 pack of
 * strings — a receipt with no cost or source attached is a row nothing can
 * improve later, because by then the receipt itself is gone.
 */
export const receiveStock = form(
	z.object({
		itemId: z.string(),
		quantity: z.number().int().min(1),
		kind: z.enum(acquisitionKinds),
		sourceName: z.string().max(255).optional(),
		donorUserId: z.string().optional(),
		reference: z.string().max(100).optional(),
		unitValueCents: z.number().int().min(0).optional(),
		fairValueCents: z.number().int().min(0).optional(),
		fairValueBasis: z.string().max(1000).optional(),
		intendedUse: z.string().max(1000).optional(),
		monetized: z.boolean().optional().default(false),
		paidByUserId: z.string().optional(),
		locationId: z.string().optional(),
		/**
		 * When it actually arrived. Absent means today.
		 *
		 * A stocktake records gear bought years ago, and the arrival date was
		 * hardcoded to `new Date()` — so every one of ~200 units would have
		 * claimed to arrive on the day it was typed in, which is the one date it
		 * certainly did not arrive.
		 */
		occurredAt: z.string().optional(),
		notes: z.string().max(2000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const currentUser = requireUser();
		const data = raw as {
			itemId: string;
			quantity: number;
			kind: AcquisitionKind;
			sourceName?: string;
			donorUserId?: string;
			reference?: string;
			unitValueCents?: number;
			fairValueCents?: number;
			fairValueBasis?: string;
			intendedUse?: string;
			monetized?: boolean;
			paidByUserId?: string;
			locationId?: string;
			occurredAt?: string;
			notes?: string;
		};

		await recordAcquisition({
			kind: data.kind,
			occurredAt: calendarDate(data.occurredAt),
			sourceName: data.sourceName || undefined,
			donorUserId: data.donorUserId || undefined,
			reference: data.reference || undefined,
			fairValueCents: data.fairValueCents,
			fairValueBasis: data.fairValueBasis || undefined,
			intendedUse: data.intendedUse || undefined,
			monetized: data.monetized ?? false,
			paidByUserId: data.paidByUserId || undefined,
			locationId: data.locationId || undefined,
			notes: data.notes,
			recordedByUserId: currentUser.id,
			lines: [
				{
					itemId: data.itemId,
					quantity: data.quantity,
					unitValueCents: data.unitValueCents
				}
			]
		});

		void getStaffItemDetail(data.itemId).refresh();
		return { success: true };
	}
);

/**
 * Everything the intake page needs, in one query.
 *
 * One load-bearing query per page (`no-concurrent-remote-queries`): the item
 * picker and the running totals both read this. `LocationField` still owns its
 * own `getLocations()`, the same way `CategoryOptions` does — it is
 * unparameterized and refreshed by name, so folding it in here would leave it
 * stale after somebody adds a location mid-session.
 */
export const getIntakePage = query(z.object({ orderId: z.string().optional() }), async (input) => {
	await requireStaff();
	// Unpaginated on purpose: the picker filters in the browser, and a stocktake
	// jumps between categories constantly — a paged picker would put a round
	// trip between the operator and every second row they enter.
	//
	// The order is fetched here rather than by the page, because two remote
	// queries in flight from one component is what `no-concurrent-remote-queries`
	// forbids — and past kit 2.64 it renders the error boundary instead of the
	// page. Composed on the server, these are two local database hops.
	const [{ rows }, order] = await Promise.all([
		listItems({}, { pageSize: 1000 }),
		input.orderId ? getOrderById(input.orderId) : Promise.resolve(null)
	]);

	return {
		items: rows.map((i) => ({
			id: i.id,
			name: i.name,
			kind: i.kind,
			unitOfMeasure: i.unitOfMeasure,
			categoryName: i.category?.name ?? null
		})),
		order: order && {
			id: order.id,
			supplierName: order.supplierName,
			lines: order.lines.map((l) => ({
				itemId: l.itemId,
				outstanding: l.outstanding,
				unitCostCents: l.unitCostCents
			}))
		}
	};
});

/**
 * Caps, enforced here as well as in the editor.
 *
 * The editor is a convenience; this is the boundary. A stocktake of the whole
 * building is a few hundred units, so these are set well above a real session
 * and exist to stop a malformed or hostile payload asking D1 for tens of
 * thousands of rows in one request.
 */
const INTAKE_MAX_LINES = 250;
const INTAKE_MAX_UNITS_PER_LINE = 500;

const intakeUnitSchema = z.object({
	assetTag: z.string().max(64).optional(),
	serialNumber: z.string().max(100).optional(),
	condition: z.enum(equipmentConditions).optional()
});

const intakeLineSchema = z.object({
	itemId: z.string().min(1),
	quantity: z.number().int().min(1).max(9999),
	unitValueCents: z.number().int().min(0).optional(),
	units: z.array(intakeUnitSchema).max(INTAKE_MAX_UNITS_PER_LINE).optional()
});

const intakeLinesSchema = z.array(intakeLineSchema).min(1).max(INTAKE_MAX_LINES);

/**
 * The whole arrival, in one POST.
 *
 * Lines ride as a hidden JSON field, the same shape `LineupEditor` uses for a
 * bill — a remote form's `FormData` cannot express an array of objects, and the
 * alternative (a request per line) is the round-trip explosion this phase
 * exists to avoid.
 *
 * `recordAcquisitionBulk`, not `recordAcquisition`: the sequential path costs
 * a select per line and four round trips per unit, which two hundred units
 * turns into a Worker timeout.
 */
export const recordIntake = form(
	z.object({
		kind: z.enum(acquisitionKinds),
		occurredAt: z.string().optional(),
		sourceName: z.string().max(255).optional(),
		reference: z.string().max(100).optional(),
		donorUserId: z.string().optional(),
		paidByUserId: z.string().optional(),
		locationId: z.string().optional(),
		notes: z.string().max(2000).optional(),
		/** Set when this arrival is being received against an order. */
		purchaseOrderId: z.string().optional(),
		/** JSON, written by the line editor. */
		lines: z.string().min(1)
	}),
	async (raw, issue) => {
		await requireStaff();
		const currentUser = requireUser();
		const data = raw as {
			kind: AcquisitionKind;
			occurredAt?: string;
			sourceName?: string;
			reference?: string;
			donorUserId?: string;
			paidByUserId?: string;
			locationId?: string;
			notes?: string;
			purchaseOrderId?: string;
			lines: string;
		};

		let lines: z.infer<typeof intakeLinesSchema>;
		try {
			lines = intakeLinesSchema.parse(JSON.parse(data.lines));
		} catch {
			// A field issue rather than a 400: the editor is on screen, and this
			// is the only thing on the form the operator cannot see or correct.
			invalid(
				issue.lines('That list of arrivals could not be read. Remove the last row and try again.')
			);
		}

		try {
			const result = await recordAcquisitionBulk({
				kind: data.kind,
				occurredAt: calendarDate(data.occurredAt),
				sourceName: data.sourceName || undefined,
				reference: data.reference || undefined,
				donorUserId: data.donorUserId || undefined,
				paidByUserId: data.paidByUserId || undefined,
				locationId: data.locationId || undefined,
				notes: data.notes || undefined,
				recordedByUserId: currentUser.id,
				lines: lines.map((l) => ({
					itemId: l.itemId,
					quantity: l.quantity,
					unitValueCents: l.unitValueCents,
					units: l.units
				}))
			});

			// Receiving *is* intake, prefilled — so an arrival against an order
			// links back to it and bumps what has been received, partially or in
			// full. The acquisition is written first either way, so the ledger
			// never forks on whether something was ordered.
			if (data.purchaseOrderId) {
				await applyReceipt({
					orderId: data.purchaseOrderId,
					acquisitionId: result.acquisitionId,
					received: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity }))
				});
				void getOrder(data.purchaseOrderId).refresh();
				void getOrders().refresh();
			}

			// Everything this touched: the catalog's on-hand numbers, the tagging
			// backlog it just added to, and the register the receipt now appears in.
			void getUntaggedAssets().refresh();
			void getRestockList().refresh();

			return { success: true, ...result };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export const getOrders = query(z.void(), async () => {
	await requireStaff();
	return listOrders();
});

export const getOrder = query(z.string(), async (id) => {
	await requireStaff();
	const order = await getOrderById(id);
	if (!order) error(404, 'Order not found');
	return order;
});

/**
 * Turn a restock selection into an order.
 *
 * The lines ride as JSON for the same reason intake's do — a remote form's
 * `FormData` cannot express an array of objects.
 */
const orderLinesSchema = z
	.array(
		z.object({
			itemId: z.string().min(1),
			quantityOrdered: z.number().int().min(1).max(9999),
			unitCostCents: z.number().int().min(0).optional()
		})
	)
	.min(1)
	.max(250);

export const startOrder = form(
	z.object({
		supplierName: z.string().max(255).optional(),
		reference: z.string().max(100).optional(),
		expectedAt: z.string().optional(),
		notes: z.string().max(2000).optional(),
		lines: z.string().min(1)
	}),
	async (raw, issue) => {
		await requireStaff();
		const currentUser = requireUser();
		const data = raw as {
			supplierName?: string;
			reference?: string;
			expectedAt?: string;
			notes?: string;
			lines: string;
		};

		let lines: z.infer<typeof orderLinesSchema>;
		try {
			lines = orderLinesSchema.parse(JSON.parse(data.lines));
		} catch {
			invalid(issue.lines('Pick at least one thing to order.'));
		}

		try {
			const orderId = await createOrder({
				supplierName: data.supplierName || undefined,
				reference: data.reference || undefined,
				expectedAt: data.expectedAt ? calendarDate(data.expectedAt) : undefined,
				notes: data.notes || undefined,
				createdByUserId: currentUser.id,
				lines
			});
			void getOrders().refresh();
			return { success: true, orderId };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const markOrderPlaced = form(z.object({ id: z.string() }), async (raw) => {
	await requireStaff();
	const data = raw as { id: string };
	try {
		await placeOrder(data.id);
	} catch (err) {
		mapDomainError(err);
	}
	// Placing is what removes an item from the restock list, so that list has to
	// be refreshed by name — it has no id to key on.
	void getOrder(data.id).refresh();
	void getOrders().refresh();
	void getRestockList().refresh();
	return { success: true };
});

export const dropOrder = form(z.object({ id: z.string() }), async (raw) => {
	await requireStaff();
	const data = raw as { id: string };
	try {
		await cancelOrder(data.id);
	} catch (err) {
		mapDomainError(err);
	}
	void getOrder(data.id).refresh();
	void getOrders().refresh();
	// Cancelling puts the shortfall back on the shopping list.
	void getRestockList().refresh();
	return { success: true };
});

export const closeOrder = form(z.object({ id: z.string() }), async (raw) => {
	await requireStaff();
	const data = raw as { id: string };
	try {
		await closeOrderShort(data.id);
	} catch (err) {
		mapDomainError(err);
	}
	void getOrder(data.id).refresh();
	void getOrders().refresh();
	void getRestockList().refresh();
	return { success: true };
});

export const useStock = form(
	z.object({
		itemId: z.string(),
		quantity: z.number().int().min(1),
		notes: z.string().max(1000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const currentUser = requireUser();
		const data = raw as { itemId: string; quantity: number; notes?: string };
		await consumeStock({
			itemId: data.itemId,
			quantity: data.quantity,
			actorId: currentUser.id,
			notes: data.notes
		});
		void getStaffItemDetail(data.itemId).refresh();
		return { success: true };
	}
);

/** A stocktake correction — the honest way to change a count. */
export const correctStock = form(
	z.object({
		itemId: z.string(),
		delta: z.number().int(),
		notes: z.string().max(1000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const currentUser = requireUser();
		const data = raw as { itemId: string; delta: number; notes?: string };
		if (data.delta === 0) error(400, 'An adjustment of zero changes nothing');
		await adjustStock({
			itemId: data.itemId,
			delta: data.delta,
			actorId: currentUser.id,
			notes: data.notes
		});
		void getStaffItemDetail(data.itemId).refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Forms — Categories & locations
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

export const addLocation = form(
	z.object({
		name: z.string().min(1).max(100),
		parentId: z.string().optional(),
		notes: z.string().max(2000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as { name: string; parentId?: string; notes?: string };
		const loc = await createLocation({
			name: data.name,
			parentId: data.parentId || undefined,
			notes: data.notes
		});
		void getLocations().refresh();
		void getLocationsWithCounts().refresh();
		return { locationId: loc.id };
	}
);

// ---------------------------------------------------------------------------
// Forms — Loans
// ---------------------------------------------------------------------------

export const scheduleLoanForm = form('unchecked', async (data, issue) => {
	await requireStaff();
	const result = scheduleLoanSchema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.map((err) => {
				const key = String(err.path[0] ?? '');
				// `issue` is the form() helper's per-field bag, keyed by field name;
				// the field being reported comes from Zod at runtime, so the lookup
				// is a string index rather than a known property.
				// `issue` is kit's per-field bag, whose members are
				// `(message: string) => Issue`. The field name comes from Zod at
				// runtime, so this is a string index; the value type is taken from
				// `issue` itself rather than from `@standard-schema/spec`, which kit
				// pulls in transitively and this package does not depend on.
				type IssueFn = Extract<(typeof issue)[keyof typeof issue], (message: string) => unknown>;
				return (issue as Record<string, IssueFn | undefined>)[key]?.(err.message);
			})
			.filter(Boolean);
		(await import('@sveltejs/kit')).invalid(...issues);
	}
	const loanId = (data as { loanId: string }).loanId;
	await scheduleLoan(loanId, {
		itemId: result.data!.itemId,
		scheduledPickupDate: result.data!.scheduledPickupDate
	});
	void getStaffLoanDetail(loanId).refresh();
	return { success: true };
});

export const checkoutLoanForm = form('unchecked', async (data, issue) => {
	await requireStaff();
	const currentUser = requireUser();
	const result = checkoutLoanSchema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.map((err) => {
				const key = String(err.path[0] ?? '');
				// `issue` is the form() helper's per-field bag, keyed by field name;
				// the field being reported comes from Zod at runtime, so the lookup
				// is a string index rather than a known property.
				// `issue` is kit's per-field bag, whose members are
				// `(message: string) => Issue`. The field name comes from Zod at
				// runtime, so this is a string index; the value type is taken from
				// `issue` itself rather than from `@standard-schema/spec`, which kit
				// pulls in transitively and this package does not depend on.
				type IssueFn = Extract<(typeof issue)[keyof typeof issue], (message: string) => unknown>;
				return (issue as Record<string, IssueFn | undefined>)[key]?.(err.message);
			})
			.filter(Boolean);
		(await import('@sveltejs/kit')).invalid(...issues);
	}
	const loanId = (data as { loanId: string }).loanId;
	await checkoutLoan(loanId, {
		dueDate: result.data!.dueDate,
		assetId: result.data!.assetId,
		actorId: currentUser.id
	});
	void getStaffLoanDetail(loanId).refresh();
	return { success: true };
});

export const createLoan = form(
	z.object({
		userId: z.string(),
		itemId: z.string().optional(),
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
			itemId?: string;
			quantity?: number;
			requestedPickupDate: string;
			estimatedReturnDate: string;
			memberNotes?: string;
		};
		await requestLoan(data.userId, {
			itemId: data.itemId || undefined,
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
		itemId: z.string().optional(),
		quantity: z.string().optional(),
		requestedPickupDate: z.string().min(1),
		estimatedReturnDate: z.string().min(1),
		memberNotes: z.string().max(1000).optional()
	}),
	async (raw) => {
		const data = raw as {
			itemId?: string;
			quantity?: string;
			requestedPickupDate: string;
			estimatedReturnDate: string;
			memberNotes?: string;
		};
		const currentUser = requireUser();

		const loan = await requestLoan(currentUser.id, {
			itemId: data.itemId || undefined,
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
	void getStaffLoanDetail(loanId).refresh();
	return { success: true };
});

export const returnLoan = form(
	z.object({
		id: z.string(),
		staffNotes: z.string().max(2000).optional()
	}),
	async (data) => {
		await requireStaff();
		const currentUser = requireUser();
		await returnLoanService(data.id as string, (data.staffNotes as string) || undefined, {
			actorId: currentUser.id
		});
		void getStaffLoanDetail(data.id as string).refresh();
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

// ---------------------------------------------------------------------------
// Replenishment & spend
// ---------------------------------------------------------------------------

/**
 * Everything at or below its reorder point — the list you take to the shop.
 *
 * Deliberately the whole list, not a page of it: it is bounded by how many
 * things the collective stocks, and a paginated shopping list is a worse
 * shopping list.
 */
export const getRestockList = query(z.void(), async () => {
	await requireStaff();
	const rows = await listLowStock();
	return {
		rows,
		outCount: rows.filter((r) => r.isOut).length
	};
});

const spendRange = z.object({
	from: z.string().optional(),
	to: z.string().optional()
});

/**
 * Purchase spend per category over a window.
 *
 * Defaults to the current calendar year, because that is the window the board
 * and the funders ask about. Donations and grants are excluded by
 * `spendByCategory` itself — counting a gift as spend would overstate the
 * budget by exactly what the collective was given.
 */
export const getSpendReport = query(spendRange, async (range) => {
	await requireStaff();

	const now = new Date();
	const from = range.from ? new Date(range.from) : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
	const to = range.to ? new Date(range.to) : now;

	// Two sources, deliberately not one. `spendByCategory` counts acquisition
	// lines, and an acquisition means goods arrived and entered stock — a labor
	// invoice arrives as nothing, has no line and belongs to no equipment
	// category. Two blocks on one page is honest; one source that has quietly
	// learned to mean two things is not.
	const [rows, services] = await Promise.all([
		spendByCategory(from, to),
		contractorSpend(from, to)
	]);
	const totalCents = rows.reduce((sum, r) => sum + Number(r.totalCents), 0);
	const servicesCents = services.reduce((sum, r) => sum + Number(r.totalCents), 0);

	return {
		from: from.toISOString().slice(0, 10),
		to: to.toISOString().slice(0, 10),
		rows: rows.map((r) => ({
			categoryId: r.categoryId,
			categoryName: r.categoryName,
			totalCents: Number(r.totalCents),
			units: Number(r.units),
			// Share of the window's spend, so the table reads without arithmetic.
			share: totalCents > 0 ? Number(r.totalCents) / totalCents : 0
		})),
		totalCents,
		services: services.map((r) => ({
			trade: r.trade,
			jobCount: Number(r.jobCount),
			totalCents: Number(r.totalCents)
		})),
		servicesCents
	};
});

// ---------------------------------------------------------------------------
// Form 8282
// ---------------------------------------------------------------------------

/**
 * Donated units disposed of within three years, where nobody has yet recorded
 * what happened about Form 8282.
 *
 * Only gifts CMC signed a Form 8283 for can owe a filing — that signature is
 * what makes something "charitable deduction property" — so the rest come back
 * as `noFormOnRecord`, a count rather than a queue.
 *
 * Still a flag for a human rather than a determination: the remaining facts
 * (what was claimed, whether the disposal counts) live on paper.
 */
export const getForm8282Obligations = query(z.void(), async () => {
	await requireStaff();
	const { obligations, noFormOnRecord } = await listForm8282Obligations();
	return {
		noFormOnRecord,
		rows: obligations.map((r) => ({
			id: r.id,
			assetTag: r.assetTag,
			itemName: r.item.name,
			donor: r.donor,
			acquiredAt: r.acquiredAt,
			disposedAt: r.retiredAt,
			retiredReason: r.retiredReason,
			acknowledged: r.acknowledgedAt !== null,
			fairValueCents: r.fairValueCents,
			state: r.status.state,
			dueBy: r.status.dueBy,
			daysRemaining: r.status.daysRemaining
		})),
		overdueCount: obligations.filter((r) => r.status.state === 'overdue').length
	};
});

export const recordForm8282 = form(
	z.object({ id: z.string(), note: z.string().min(1).max(1000) }),
	async (raw) => {
		await requireStaff();
		const data = raw as { id: string; note: string };
		await resolveForm8282(data.id, data.note);
		void getForm8282Obligations().refresh();
		void getStaffAssetDetail(data.id).refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Acquisitions
// ---------------------------------------------------------------------------

/**
 * What arrived, from whom, for how much.
 *
 * Receiving has always written these rows; nothing has ever been able to read
 * them back. That is why the disclosure columns sat empty in production — a
 * Form 8283 is signed weeks after the gift walks in, and there was no acquisition
 * to come back to.
 */
export const getAcquisitions = query(
	z.object({
		kind: z.enum(acquisitionKinds).optional(),
		from: z.string().optional(),
		to: z.string().optional(),
		awaitingReimbursement: z.boolean().optional()
	}),
	async (opts) => {
		await requireStaff();

		const rows = await listAcquisitions({
			kind: opts.kind,
			from: opts.from ? new Date(opts.from) : undefined,
			to: opts.to ? new Date(opts.to) : undefined,
			awaitingReimbursement: opts.awaitingReimbursement
		});

		return {
			rows: rows.map((r) => ({
				id: r.id,
				kind: r.kind,
				occurredAt: r.occurredAt,
				donorName: r.donorName,
				reference: r.reference,
				totalCents: r.totalCents ?? r.linesTotalCents,
				lineCount: r.lineCount,
				paidByName: r.paidByName,
				awaitingReimbursement: r.paidByUserId !== null && r.reimbursedAt === null,
				reimbursedAt: r.reimbursedAt,
				acknowledgedAt: r.acknowledgedAt
			})),
			owedCount: rows.filter((r) => r.paidByUserId !== null && r.reimbursedAt === null).length
		};
	}
);

/**
 * One acquisition, everything about it.
 *
 * Composed rather than fanned out: the page reads this once and nothing else.
 * `getAcquisitionById` already gathers lines, movements and receipts in one
 * round trip, so this only shapes the DTO. The payer picker searches through
 * the existing `/api/users/search`, the way `CreateLoanAction` does, rather
 * than shipping a member list nobody has asked for yet.
 */
export const getStaffAcquisitionDetail = query(z.string(), async (id) => {
	await requireStaff();

	const acq = await getAcquisitionById(id);
	if (!acq) error(404, 'Acquisition not found');

	return {
		...acq,
		linesTotalCents: acq.lines.reduce((sum, l) => sum + l.quantity * (l.unitValueCents ?? 0), 0),
		awaitingReimbursement: acq.paidByUserId !== null && acq.reimbursedAt === null
	};
});

/**
 * Amending an acquisition.
 *
 * A cleared number field is *dropped* from a remote `form()` payload rather than
 * sent as null, so an absent key here means untouched. Clearing a value that is
 * already set therefore needs its own signal, which the text fields carry as an
 * empty string.
 */
export const editAcquisition = form(
	z.object({
		id: z.string(),
		sourceName: z.string().max(255).optional(),
		reference: z.string().max(100).optional(),
		fairValueCents: z.number().int().min(0).optional(),
		fairValueBasis: z.string().max(1000).optional(),
		intendedUse: z.string().max(1000).optional(),
		monetized: z.boolean().optional().default(false),
		paidByUserId: z.string().optional(),
		/**
		 * Date and kind are editable because both are now *guessed* at entry.
		 * Two hundred rows typed in one sitting will contain wrong ones, and a
		 * mistyped kind is the expensive kind of wrong: it decides whether the
		 * row lands in this year's spend, in the gifts-in-kind report, or in
		 * neither. Without this the only fix was to delete and re-enter.
		 */
		occurredAt: z.string().optional(),
		kind: z.enum(acquisitionKinds).optional(),
		notes: z.string().max(2000).optional()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as {
			id: string;
			sourceName?: string;
			reference?: string;
			fairValueCents?: number;
			fairValueBasis?: string;
			intendedUse?: string;
			monetized?: boolean;
			paidByUserId?: string;
			occurredAt?: string;
			kind?: AcquisitionKind;
			notes?: string;
		};

		try {
			await updateAcquisition(data.id, {
				// Absent means "the form did not ask", not "clear it" — the same
				// distinction that made saving a unit erase its location.
				...(data.occurredAt ? { occurredAt: calendarDate(data.occurredAt) } : {}),
				...(data.kind ? { kind: data.kind } : {}),
				sourceName: data.sourceName || null,
				reference: data.reference || null,
				fairValueCents: data.fairValueCents ?? null,
				fairValueBasis: data.fairValueBasis || null,
				intendedUse: data.intendedUse || null,
				monetized: data.monetized ?? false,
				paidByUserId: data.paidByUserId || null,
				notes: data.notes || null
			});
		} catch (err) {
			mapDomainError(err);
		}

		void getStaffAcquisitionDetail(data.id).refresh();
		return { success: true };
	}
);

/**
 * Recording that CMC signed the donor's Form 8283.
 *
 * **This is the switch that arms Form 8282.** Until it is set, a donated unit
 * can be disposed of and `/staff/inventory/compliance` stays silent, because a
 * gift with no signed 8283 is not "charitable deduction property" and owes
 * nothing. The rule shipped in #302/#309 with no way to reach it.
 */
export const recordForm8283 = form(
	z.object({
		id: z.string(),
		signedOn: z.string().min(1),
		appraisalRef: z.string().max(255).optional()
	}),
	async (raw) => {
		await requireStaff();
		const data = raw as { id: string; signedOn: string; appraisalRef?: string };

		const signedOn = new Date(data.signedOn);
		if (Number.isNaN(signedOn.getTime())) error(400, 'That is not a date');

		try {
			await acknowledgeForm8283(data.id, {
				acknowledgedAt: signedOn,
				appraisalRef: data.appraisalRef || null
			});
		} catch (err) {
			mapDomainError(err);
		}

		void getStaffAcquisitionDetail(data.id).refresh();
		// A newly-signed 8283 can make an already-disposed unit reportable, so the
		// compliance queue has to be re-read rather than left to go stale.
		void getForm8282Obligations().refresh();
		return { success: true };
	}
);

export const markAcquisitionReimbursed = form(z.object({ id: z.string() }), async (raw) => {
	await requireStaff();
	const data = raw as { id: string };

	try {
		await markReimbursed(data.id);
	} catch (err) {
		mapDomainError(err);
	}

	void getStaffAcquisitionDetail(data.id).refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Attached resources
// ---------------------------------------------------------------------------

export const getItemResources = query(z.string(), async (itemId) => {
	await requireStaff();
	const [resources, linkable] = await Promise.all([
		listItemResources(itemId),
		listLinkableArticles(itemId)
	]);
	return { ...resources, linkable };
});

export const linkItemArticle = form(
	z.object({ itemId: z.string(), articleId: z.string() }),
	async (raw) => {
		await requireStaff();
		const data = raw as { itemId: string; articleId: string };
		await linkArticle(data.itemId, data.articleId);
		void getItemResources(data.itemId).refresh();
		return { success: true };
	}
);

export const unlinkItemArticle = form(
	z.object({ itemId: z.string(), linkId: z.string() }),
	async (raw) => {
		await requireStaff();
		const data = raw as { itemId: string; linkId: string };
		await unlinkArticle(data.linkId);
		void getItemResources(data.itemId).refresh();
		return { success: true };
	}
);

/**
 * A member reporting a broken unit.
 *
 * `requireUser` and not `requireStaff` deliberately — whoever finds a cracked
 * cabinet is usually the person who just picked it up. The service takes the
 * unit out of service on their say-so; the trade is argued there.
 */
export const reportAssetDamage = form(
	z.object({
		assetId: z.string(),
		note: z.string().min(1).max(1000),
		// `''` is in the enum because the "Not sure" option submits one, and a
		// bare `.optional()` rejects an empty string rather than ignoring it —
		// which silently failed the whole submit, so the unit never went out of
		// service and the note was never recorded. Not `.transform()`: that breaks
		// `fields` inference on a remote `form()`.
		condition: z.enum(['', 'fair', 'poor']).optional()
	}),
	async (raw) => {
		const currentUser = requireUser();
		const data = raw as { assetId: string; note: string; condition?: '' | 'fair' | 'poor' };
		try {
			await reportDamage({
				assetId: data.assetId,
				note: data.note,
				condition: data.condition || undefined,
				reportedByUserId: currentUser.id
			});
		} catch (err) {
			mapDomainError(err);
		}
		void getMemberAsset(data.assetId).refresh();
		void getStaffAssetDetail(data.assetId).refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Composed page queries — one load-bearing query per page
// ---------------------------------------------------------------------------

/**
 * The staff item detail page's one load-bearing query.
 *
 * The item, its units, its ledger and its loan history are all keyed by the same
 * id and all first paint, so they assemble here rather than racing each other
 * out of the component — the shape that stops a page rendering past kit 2.64.
 *
 * The category list is deliberately *not* here. It is unparameterized and its
 * own mutations refresh it by name, with no item id to key a wrapper with, so it
 * lives in `CategoryOptions` instead.
 */
export const getStaffItemDetail = query(z.string(), async (id) => {
	const [item, assets, movements, loanHistory] = await Promise.all([
		getItem(id),
		getItemAssets(id),
		getItemMovements(id),
		getItemLoanHistory(id)
	]);
	return { item, assets, movements, loanHistory };
});

/** The staff asset detail page's one load-bearing query. */
export const getStaffAssetDetail = query(z.string(), async (id) => {
	// `serviceHistory` rides along rather than being its own query in the
	// component: what a contractor was paid to do to this unit is part of its
	// record, and a second awaited query out of the page is a serial round trip
	// on first paint.
	const [asset, movements, serviceHistory] = await Promise.all([
		getAsset(id),
		getAssetMovements(id),
		jobsForAsset(id)
	]);

	// Computed here rather than in the component: the rule is server-side and
	// depends on the acquisition this unit arrived on, which the asset row only
	// points at.
	const acq = asset.acquisitionId ? await getAcquisitionById(asset.acquisitionId) : null;
	const form8282 = form8282Status(
		{
			acquiredAt: acq?.occurredAt ?? null,
			wasDonated: acq?.kind === 'donation',
			acknowledged: acq?.acknowledgedAt != null,
			disposedAt: asset.retiredAt,
			resolvedAt: asset.form8282ResolvedAt
		},
		new Date()
	);

	return { asset, movements, serviceHistory, form8282, donor: acq?.donorName ?? null };
});

/**
 * The staff loan detail page's one load-bearing query.
 *
 * `getAvailableItems` has no mutations refreshing it, so unlike the category
 * list it composes cleanly. It stays exported for `CreateLoanAction`, which
 * loads it in its own markup.
 */
export const getStaffLoanDetail = query(z.string(), async (id) => {
	const [loan, availableItems] = await Promise.all([getLoan(id), getAvailableItems()]);
	const availableAssets = loan.itemId ? await getAvailableAssets(loan.itemId) : [];
	return { loan, availableItems, availableAssets };
});

/** The member equipment page's one load-bearing query. */
export const getMemberEquipmentPage = query(memberEquipmentFilters, async (filters) => {
	const [equipment, meta] = await Promise.all([
		getMemberEquipment(filters),
		getMemberEquipmentMeta()
	]);
	return { equipment, meta };
});

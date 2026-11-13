import { db } from '#lib/server/db/index.js';
import {
	inventoryAsset,
	inventoryItem,
	inventoryKitLoan,
	inventoryLoan,
	inventoryLocation
} from '#lib/server/db/schema/inventory.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { memberRefColumns, toMemberRef } from '#lib/server/entity/refs.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { DomainError } from '#lib/server/domain-error.js';
import { chunk, chunkInsert } from '#lib/server/utils/chunk.js';
import { movementStatement } from './stock-service';
import { assetStatusChange, settleTerminalUnit } from './asset-service';
import { hasBlockingFlag } from './work-request-service';
import { closeKitIfComplete } from './loan-service';

export class KitLocationNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Location not found');
	}
}

export class KitLoanNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Kit loan not found');
	}
}

export class EmptyKitError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('Nothing in this location can go out');
	}
}

export class KitAlreadyReturnedError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('This kit has already come back');
	}
}

/** Ids per `IN (...)`: under D1's 100-parameter cap with room for the rest of the statement. */
const IDS_PER_STATEMENT = 90;

/** A location and every location nested in it. `parentId` has no FK, so cycles are possible. */
async function locationSubtree(rootId: string): Promise<string[]> {
	const all = await db
		.select({ id: inventoryLocation.id, parentId: inventoryLocation.parentId })
		.from(inventoryLocation);
	const children = new Map<string, string[]>();
	for (const l of all) {
		if (!l.parentId) continue;
		children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.id]);
	}
	const seen = new Set<string>([rootId]);
	const queue = [rootId];
	while (queue.length) {
		for (const child of children.get(queue.shift()!) ?? []) {
			if (seen.has(child)) continue;
			seen.add(child);
			queue.push(child);
		}
	}
	return [...seen];
}

export interface KitContentsRow {
	assetId: string;
	itemId: string;
	itemName: string;
	assetTag: string | null;
	status: string;
	locationId: string;
	locationName: string;
	/** Only `in_service` units go out; the rest are listed as left behind. */
	lendable: boolean;
}

/** What a kit checkout of this location would lend, nested locations included. */
export async function listKitContents(locationId: string) {
	const [location] = await db
		.select({ id: inventoryLocation.id, name: inventoryLocation.name })
		.from(inventoryLocation)
		.where(eq(inventoryLocation.id, locationId))
		.limit(1);
	if (!location) throw new KitLocationNotFoundError();

	const ids = await locationSubtree(locationId);
	const rows: KitContentsRow[] = [];
	for (const group of chunk(ids, IDS_PER_STATEMENT)) {
		const found = await db
			.select({
				assetId: inventoryAsset.id,
				itemId: inventoryAsset.itemId,
				itemName: inventoryItem.name,
				assetTag: inventoryAsset.assetTag,
				status: inventoryAsset.status,
				locationId: inventoryLocation.id,
				locationName: inventoryLocation.name
			})
			.from(inventoryAsset)
			.innerJoin(inventoryItem, eq(inventoryAsset.itemId, inventoryItem.id))
			.innerJoin(inventoryLocation, eq(inventoryAsset.locationId, inventoryLocation.id))
			.where(inArray(inventoryAsset.locationId, group));
		// Retired and lost units are history, not contents.
		for (const r of found) {
			if (r.status === 'retired' || r.status === 'lost') continue;
			rows.push({ ...r, lendable: r.status === 'in_service' });
		}
	}
	rows.sort(
		(a, b) =>
			a.itemName.localeCompare(b.itemName) || (a.assetTag ?? '').localeCompare(b.assetTag ?? '')
	);
	return { location, rows };
}

export interface CheckoutKitData {
	locationId: string;
	userId: string;
	dueDate: Date | null;
	actorId?: string | null;
	notes?: string | null;
}

/**
 * Lend a location and everything in it as one kit.
 *
 * Each in-service unit gets its own `inventory_loan` row, so custody, the
 * ledger and the unit's history work exactly as a single loan does. A unit on
 * another loan or in the shop is left behind and recorded, not refused.
 */
export async function checkoutKit(data: CheckoutKitData) {
	const { location, rows } = await listKitContents(data.locationId);
	const lent = rows.filter((r) => r.lendable);
	const leftBehind = rows.filter((r) => !r.lendable);
	if (lent.length === 0) throw new EmptyKitError();

	const now = new Date();
	const kitId = crypto.randomUUID();
	const loans = lent.map((r) => ({
		id: crypto.randomUUID(),
		kitLoanId: kitId,
		itemId: r.itemId,
		assetId: r.assetId,
		userId: data.userId,
		quantity: 1,
		requestedPickupDate: now,
		checkedOutAt: now,
		dueDate: data.dueDate,
		// Kit loans are the collective's own use: nothing to charge on return.
		dailyRateCents: 0,
		status: 'checked_out' as const,
		createdAt: now,
		updatedAt: now
	}));

	const kitInsert = db.insert(inventoryKitLoan).values({
		id: kitId,
		locationId: location.id,
		locationName: location.name,
		userId: data.userId,
		checkedOutById: data.actorId ?? null,
		checkedOutAt: now,
		dueDate: data.dueDate,
		notes: data.notes?.trim() || null,
		createdAt: now,
		updatedAt: now
	});
	const loanInserts = chunkInsert(loans, (group) => db.insert(inventoryLoan).values(group));
	const custody = chunk(
		lent.map((r) => r.assetId),
		IDS_PER_STATEMENT
	).map((ids) =>
		db
			.update(inventoryAsset)
			.set({ status: 'on_loan', updatedAt: now })
			.where(and(inArray(inventoryAsset.id, ids), eq(inventoryAsset.status, 'in_service')))
	);
	const ledger = loans.map((l) =>
		movementStatement({
			itemId: l.itemId,
			assetId: l.assetId,
			quantity: 1,
			reason: 'loan_out',
			loanId: l.id,
			actorId: data.actorId ?? null,
			occurredAt: now
		})
	);

	// The kit, its loans, custody and the ledger are one handover.
	// db.batch, never db.transaction — the latter is broken on D1.
	await db.batch([kitInsert, ...loanInserts, ...custody, ...ledger]);

	if (leftBehind.length > 0) {
		const [member] = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, data.userId))
			.limit(1);
		await recordAuditEntry({
			action: 'kit_loan.checked_out_incomplete',
			subject: { type: 'user', id: data.userId, label: member?.name ?? null },
			details: {
				kitLoanId: kitId,
				locationName: location.name,
				leftBehind: leftBehind.map((r) => kitLine(r.itemName, r.assetTag, r.status)).slice(0, 50)
			}
		});
	}

	return { id: kitId, lent: lent.length, leftBehind };
}

function kitLine(itemName: string, assetTag: string | null, status?: string) {
	const name = assetTag ? `${itemName} (${assetTag})` : itemName;
	return status ? `${name}: ${status.replace('_', ' ')}` : name;
}

export interface ReturnKitData {
	/** The kit's loan rows that came back. Any still-out row not named stays out. */
	returnedLoanIds: string[];
	actorId?: string | null;
}

/**
 * Check a kit back in. What came back is returned the way a single loan is;
 * what did not stays on loan to the same person, and the kit stays open.
 */
export async function returnKit(kitLoanId: string, data: ReturnKitData) {
	const kit = await getKitLoanRaw(kitLoanId);
	if (!kit) throw new KitLoanNotFoundError();
	if (kit.returnedAt) throw new KitAlreadyReturnedError();

	const out = await db
		.select({
			loanId: inventoryLoan.id,
			itemId: inventoryLoan.itemId,
			assetId: inventoryLoan.assetId,
			itemName: inventoryItem.name,
			assetTag: inventoryAsset.assetTag,
			assetStatus: inventoryAsset.status
		})
		.from(inventoryLoan)
		.leftJoin(inventoryItem, eq(inventoryLoan.itemId, inventoryItem.id))
		.leftJoin(inventoryAsset, eq(inventoryLoan.assetId, inventoryAsset.id))
		.where(and(eq(inventoryLoan.kitLoanId, kitLoanId), eq(inventoryLoan.status, 'checked_out')));

	const wanted = new Set(data.returnedLoanIds);
	const back = out.filter((l) => wanted.has(l.loanId));
	const missing = out.filter((l) => !wanted.has(l.loanId));

	if (back.length > 0) {
		const now = new Date();
		const actorId = data.actorId ?? null;
		const loanUpdates = chunk(
			back.map((l) => l.loanId),
			IDS_PER_STATEMENT
		).map((ids) =>
			db
				.update(inventoryLoan)
				.set({
					status: 'returned',
					returnedAt: now,
					totalChargeCents: 0,
					creditsCents: 0,
					cashCents: 0,
					updatedAt: now
				})
				.where(and(inArray(inventoryLoan.id, ids), eq(inventoryLoan.status, 'checked_out')))
		);
		const ledger = back
			.filter((l) => l.itemId)
			.map((l) =>
				movementStatement({
					itemId: l.itemId!,
					assetId: l.assetId,
					quantity: 1,
					reason: 'loan_return',
					loanId: l.loanId,
					actorId,
					occurredAt: now
				})
			);

		// Same rule as a single return: an open blocking report sends the unit
		// to the shop; a unit retired or lost while out stays that way.
		const statusChanges = [];
		const terminal: string[] = [];
		for (const l of back) {
			if (!l.assetId) continue;
			if (l.assetStatus !== 'on_loan') {
				terminal.push(l.assetId);
				continue;
			}
			const needsService = await hasBlockingFlag(l.assetId);
			const change = await assetStatusChange(
				l.assetId,
				needsService ? 'maintenance' : 'in_service',
				{
					actorId: actorId ?? undefined,
					notes: needsService ? 'Open report on return' : undefined
				}
			);
			if (change.statements) statusChanges.push(...change.statements);
		}

		// db.batch, never db.transaction — the latter is broken on D1.
		await db.batch([loanUpdates[0], ...loanUpdates.slice(1), ...ledger, ...statusChanges]);
		for (const assetId of terminal) await settleTerminalUnit(assetId, actorId);
	}

	const closed = await closeKitIfComplete(kitLoanId);

	if (missing.length > 0) {
		const [member] = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, kit.userId))
			.limit(1);
		await recordAuditEntry({
			action: 'kit_loan.returned_incomplete',
			subject: { type: 'user', id: kit.userId, label: member?.name ?? null },
			details: {
				kitLoanId,
				locationName: kit.locationName,
				missing: missing.map((l) => kitLine(l.itemName ?? 'Unknown', l.assetTag)).slice(0, 50)
			}
		});
	}

	const line = (l: (typeof out)[number]) => ({
		loanId: l.loanId,
		assetId: l.assetId,
		itemName: l.itemName,
		assetTag: l.assetTag
	});
	return { closed, returned: back.map(line), missing: missing.map(line) };
}

async function getKitLoanRaw(id: string) {
	const [row] = await db
		.select()
		.from(inventoryKitLoan)
		.where(eq(inventoryKitLoan.id, id))
		.limit(1);
	return row ?? null;
}

/** One kit loan with every unit that went out in it, still out first. */
export async function getKitLoan(id: string) {
	const [row] = await db
		.select({ kit: inventoryKitLoan, member: memberRefColumns() })
		.from(inventoryKitLoan)
		.innerJoin(user, eq(inventoryKitLoan.userId, user.id))
		.where(eq(inventoryKitLoan.id, id))
		.limit(1);
	if (!row) return null;

	const lines = await db
		.select({
			loanId: inventoryLoan.id,
			status: inventoryLoan.status,
			returnedAt: inventoryLoan.returnedAt,
			assetId: inventoryLoan.assetId,
			itemName: inventoryItem.name,
			assetTag: inventoryAsset.assetTag
		})
		.from(inventoryLoan)
		.leftJoin(inventoryItem, eq(inventoryLoan.itemId, inventoryItem.id))
		.leftJoin(inventoryAsset, eq(inventoryLoan.assetId, inventoryAsset.id))
		.where(eq(inventoryLoan.kitLoanId, id))
		.orderBy(asc(inventoryItem.name), asc(inventoryAsset.assetTag));

	return {
		...row.kit,
		member: toMemberRef(row.member),
		lines: lines.map((l) => ({ ...l, out: l.status === 'checked_out' })),
		isOverdue: !row.kit.returnedAt && row.kit.dueDate != null && row.kit.dueDate < new Date()
	};
}

/** Kit loans, open ones first. */
export async function listKitLoans(opts: { openOnly?: boolean } = {}) {
	const rows = await db
		.select({ kit: inventoryKitLoan, member: memberRefColumns() })
		.from(inventoryKitLoan)
		.innerJoin(user, eq(inventoryKitLoan.userId, user.id))
		.where(opts.openOnly ? isNull(inventoryKitLoan.returnedAt) : undefined)
		.orderBy(desc(inventoryKitLoan.checkedOutAt))
		.limit(100);
	return rows.map((r) => ({ ...r.kit, member: toMemberRef(r.member) }));
}

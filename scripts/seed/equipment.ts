import { helpArticle } from '../../src/lib/server/db/schema/help';
import {
	acquisition,
	acquisitionLine,
	equipmentCategory,
	inventoryAsset,
	inventoryItem,
	inventoryItemArticle,
	inventoryLoan,
	inventoryLocation,
	purchaseOrder,
	purchaseOrderLine,
	stockMovement
} from '../../src/lib/server/db/schema/inventory';
import { batchInsert, db } from './db';
import { type SeedUser } from './types';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

export async function seedEquipment(users: SeedUser[]) {
	console.log('Seeding inventory...');

	const categories = await db
		.insert(equipmentCategory)
		.values([
			{ id: randomUUID(), name: 'Guitars', displayOrder: 0, pricingTier: 'major' },
			{ id: randomUUID(), name: 'Amplifiers', displayOrder: 1, pricingTier: 'major' },
			{ id: randomUUID(), name: 'Microphones', displayOrder: 2, pricingTier: 'major' },
			{ id: randomUUID(), name: 'Drum Hardware', displayOrder: 3, pricingTier: 'major' },
			{ id: randomUUID(), name: 'Cables & Accessories', displayOrder: 4, pricingTier: 'accessory' },
			{ id: randomUUID(), name: 'Consumables', displayOrder: 5, pricingTier: 'accessory' }
		])
		.returning();

	const catByName = Object.fromEntries(categories.map((c) => [c.name, c.id]));

	// "Main room → stage left rack" is how people say it out loud, so the tree is
	// two deep rather than one flat list of compound names.
	const mainRoom = { id: randomUUID(), name: 'Main room', parentId: null, displayOrder: 0 };
	const storage = { id: randomUUID(), name: 'Storage closet', parentId: null, displayOrder: 1 };
	const locations = await batchInsert(
		inventoryLocation,
		[
			mainRoom,
			storage,
			{ id: randomUUID(), name: 'Stage left rack', parentId: mainRoom.id, displayOrder: 0 },
			{ id: randomUUID(), name: 'Supply shelf', parentId: storage.id, displayOrder: 0 }
		],
		4
	);
	const locByName = Object.fromEntries(locations.map((l) => [l.name, l.id]));

	/**
	 * Both kinds, and both loanable and not — the seed has to exercise the
	 * cable-drawer case (`bulk` *and* returnable) or the two-axis model is never
	 * actually tried locally.
	 */
	const items = await batchInsert(
		inventoryItem,
		[
			{
				id: randomUUID(),
				name: 'Fender Stratocaster',
				description: 'Sunburst finish, maple neck.',
				categoryId: catByName['Guitars'],
				kind: 'serialized' as const,
				isLoanable: true,
				resourceId: 'EQ-001'
			},
			{
				id: randomUUID(),
				name: 'Gibson Les Paul Standard',
				description: 'Cherry burst. Donated.',
				categoryId: catByName['Guitars'],
				kind: 'serialized' as const,
				isLoanable: true
			},
			{
				id: randomUUID(),
				name: 'Fender Blues Deluxe',
				description: '40W tube combo.',
				categoryId: catByName['Amplifiers'],
				kind: 'serialized' as const,
				isLoanable: true
			},
			{
				id: randomUUID(),
				name: 'QSC K12.2 Powered Speaker',
				description: '2000W powered PA speaker.',
				categoryId: catByName['Amplifiers'],
				kind: 'serialized' as const,
				isLoanable: true
			},
			{
				id: randomUUID(),
				name: 'Shure SM58',
				description: 'Cardioid dynamic vocal mic.',
				categoryId: catByName['Microphones'],
				kind: 'serialized' as const,
				isLoanable: true
			},
			{
				id: randomUUID(),
				name: 'AKG P420 Condenser',
				description: 'Multi-pattern large-diaphragm condenser.',
				categoryId: catByName['Microphones'],
				kind: 'serialized' as const,
				isLoanable: true
			},
			// Counted, but it comes back — the case a single asset/consumable enum
			// could not express.
			{
				id: randomUUID(),
				name: 'XLR Cable (25ft)',
				description: 'Neutrik ends.',
				categoryId: catByName['Cables & Accessories'],
				kind: 'bulk' as const,
				unitOfMeasure: 'each' as const,
				isLoanable: true,
				reorderPoint: 6,
				reorderQuantity: 12
			},
			{
				id: randomUUID(),
				name: 'Boom Mic Stand',
				categoryId: catByName['Drum Hardware'],
				kind: 'bulk' as const,
				isLoanable: true,
				reorderPoint: 2,
				reorderQuantity: 4
			},
			// Counted and consumed — a consumable is derived from exactly this
			// pair, never stored as its own flag.
			{
				id: randomUUID(),
				name: "D'Addario EXL110 Strings",
				description: 'Regular light, 10–46.',
				categoryId: catByName['Consumables'],
				kind: 'bulk' as const,
				unitOfMeasure: 'pack' as const,
				gtin: '019954141042',
				isLoanable: false,
				reorderPoint: 4,
				reorderQuantity: 12
			},
			{
				id: randomUUID(),
				name: 'Vic Firth 5A Drumsticks',
				categoryId: catByName['Consumables'],
				kind: 'bulk' as const,
				unitOfMeasure: 'pair' as const,
				gtin: '750795000159',
				isLoanable: false,
				reorderPoint: 3,
				reorderQuantity: 10
			},
			{
				id: randomUUID(),
				name: '9V Batteries',
				categoryId: catByName['Consumables'],
				kind: 'bulk' as const,
				unitOfMeasure: 'box' as const,
				isLoanable: false,
				// Deliberately seeded below its reorder point so the low-stock
				// surface has something to show without anyone arranging it.
				reorderPoint: 5,
				reorderQuantity: 20
			}
		],
		4
	);

	const itemByName = Object.fromEntries(items.map((i) => [i.name, i]));
	const now = new Date();
	const day = 86400000;
	const staffId = users[0].id;

	// -----------------------------------------------------------------------
	// Acquisitions. Every arrival goes through one, so the spend report has
	// something to add up and the gifts-in-kind disclosure has something to
	// disaggregate.
	// -----------------------------------------------------------------------
	const purchase = {
		id: randomUUID(),
		kind: 'purchase' as const,
		occurredAt: new Date(now.getTime() - 200 * day),
		sourceName: 'Guitar Center',
		reference: 'INV-88213',
		totalCents: 184_000,
		recordedByUserId: staffId
	};
	const donation = {
		id: randomUUID(),
		kind: 'donation' as const,
		occurredAt: new Date(now.getTime() - 120 * day),
		sourceName: 'Estate of R. Whitfield',
		donorUserId: users[2].id,
		fairValueCents: 250_000,
		fairValueBasis: 'Reverb comparable sales, three listings averaged',
		intendedUse: 'Practice-room backline, available to all members',
		monetized: false,
		acknowledgedAt: new Date(now.getTime() - 118 * day),
		recordedByUserId: staffId
	};
	const restock = {
		id: randomUUID(),
		kind: 'purchase' as const,
		occurredAt: new Date(now.getTime() - 20 * day),
		sourceName: 'Sweetwater',
		reference: 'SW-4471902',
		totalCents: 21_400,
		recordedByUserId: staffId
	};
	const grant = {
		id: randomUUID(),
		kind: 'grant' as const,
		occurredAt: new Date(now.getTime() - 300 * day),
		sourceName: 'Benton County Cultural Coalition',
		reference: 'BCCC-2025-14',
		totalCents: 96_000,
		intendedUse: 'PA capacity for all-ages programming',
		recordedByUserId: staffId
	};
	/**
	 * A gift with no signed Form 8283.
	 *
	 * Every other seeded donation carries `acknowledgedAt`, which meant a local
	 * run could only ever see the *flagging* path. This is the suppression path
	 * — and the common one for CMC, which has never signed an 8283 — so the
	 * compliance page's "nothing outstanding, and here is the denominator"
	 * branch has something to count.
	 */
	const unackedGift = {
		id: randomUUID(),
		kind: 'donation' as const,
		occurredAt: new Date(now.getTime() - 400 * day),
		sourceName: 'Anonymous walk-in',
		fairValueCents: 18_000,
		fairValueBasis: 'Staff estimate against local used listings',
		intendedUse: 'Practice-room use',
		monetized: false,
		recordedByUserId: staffId
	};
	/**
	 * A shop trip somebody fronted out of pocket and has not been paid back for.
	 * Nothing else in the seed exercises the reimbursement column.
	 */
	const fronted = {
		id: randomUUID(),
		kind: 'purchase' as const,
		occurredAt: new Date(now.getTime() - 6 * day),
		sourceName: 'Troubadour Music',
		reference: 'Receipt photographed',
		totalCents: 4_800,
		paidByUserId: users[1].id,
		recordedByUserId: staffId
	};
	/** The same, already settled — so the cleared state renders too. */
	const frontedSettled = {
		id: randomUUID(),
		kind: 'purchase' as const,
		occurredAt: new Date(now.getTime() - 45 * day),
		sourceName: 'Corvallis Hardware',
		totalCents: 3_200,
		paidByUserId: users[3].id,
		reimbursedAt: new Date(now.getTime() - 38 * day),
		recordedByUserId: staffId
	};

	/**
	 * The stocktake row: gear CMC has owned for years, with no receipt and no
	 * traceable donor.
	 *
	 * This is the shape the whole inventory rework exists to serve, and nothing
	 * local could produce it before — the only kinds were `purchase`, `donation`
	 * and `grant`, so recording a decade-old amp meant inventing a purchase and
	 * inflating the year's spend by the value of the building.
	 *
	 * Deliberately missing `sourceName` and `totalCents`, and its lines carry no
	 * unit values: nobody knows what any of it cost, and a seed that guessed
	 * would hide the fact that the reports must cope with not knowing. It is
	 * also the only multi-line arrival in the seed, so `acquisition_line`'s
	 * one-to-many is exercised rather than merely declared.
	 */
	const openingBalance = {
		id: randomUUID(),
		kind: 'opening_balance' as const,
		occurredAt: new Date(now.getTime() - 900 * day),
		reference: 'Stocktake 2026',
		notes: 'Entered during the first full inventory. Owned for years; no receipts survive.',
		recordedByUserId: staffId
	};

	// Named so the summary counts them rather than restating a literal that goes
	// stale the moment another arrival is seeded — which it just had.
	// Typed as the insert row so the reconciliation below can read `totalCents`
	// on every member, including the gifts that do not set one.
	const acquisitionRows: (typeof acquisition.$inferInsert)[] = [
		purchase,
		donation,
		restock,
		grant,
		unackedGift,
		fronted,
		frontedSettled,
		openingBalance
	];

	// A helper so a seeded arrival cannot drift from the ledger it implies: one
	// call writes the line *and* the movement, the way the service does.
	const lines: (typeof acquisitionLine.$inferInsert)[] = [];
	const movements: (typeof stockMovement.$inferInsert)[] = [];
	const assets: (typeof inventoryAsset.$inferInsert)[] = [];

	function received(
		acq: { id: string; occurredAt: Date },
		itemName: string,
		quantity: number,
		unitValueCents: number | null,
		opts: {
			units?: { tag?: string; serial?: string; condition?: string }[];
			locationId?: string;
		} = {}
	) {
		const item = itemByName[itemName];
		lines.push({
			id: randomUUID(),
			acquisitionId: acq.id,
			itemId: item.id,
			quantity,
			unitValueCents
		});

		if (item.kind === 'serialized') {
			const units = opts.units ?? Array.from({ length: quantity }, () => ({}));
			for (const unit of units) {
				const assetId = randomUUID();
				assets.push({
					id: assetId,
					itemId: item.id,
					assetTag: unit.tag ?? null,
					serialNumber: unit.serial ?? null,
					condition: (unit.condition ?? 'good') as 'excellent' | 'good' | 'fair' | 'poor',
					status: 'in_service',
					locationId: opts.locationId ?? null,
					acquisitionId: acq.id
				});
				movements.push({
					id: randomUUID(),
					itemId: item.id,
					assetId,
					quantity: 1,
					reason: 'receive',
					locationId: opts.locationId ?? null,
					acquisitionId: acq.id,
					actorId: staffId,
					occurredAt: acq.occurredAt
				});
			}
		} else {
			movements.push({
				id: randomUUID(),
				itemId: item.id,
				quantity,
				reason: 'receive',
				locationId: opts.locationId ?? null,
				acquisitionId: acq.id,
				actorId: staffId,
				occurredAt: acq.occurredAt
			});
		}
	}

	received(purchase, 'Fender Stratocaster', 1, 89_900, {
		units: [{ tag: 'CMC-000101', serial: 'FEN-STR-2019-0041' }],
		locationId: locByName['Main room']
	});
	received(purchase, 'Fender Blues Deluxe', 1, 94_100, {
		units: [{ tag: 'CMC-000102', serial: 'FBD-114522', condition: 'fair' }],
		locationId: locByName['Main room']
	});
	received(donation, 'Gibson Les Paul Standard', 1, 250_000, {
		units: [{ tag: 'CMC-000103', serial: 'GIB-LP-91188', condition: 'excellent' }],
		locationId: locByName['Main room']
	});
	// A donated unit the collective has since let go of, 40 days ago — inside the
	// three-year window, so it owes a Form 8282 decision and the compliance list
	// has a live row. Retired below, once the ids exist.
	received(donation, 'Fender Blues Deluxe', 1, 65_000, {
		units: [{ tag: 'CMC-000110', serial: 'FEN-BD-55021', condition: 'poor' }],
		locationId: locByName['Main room']
	});
	received(grant, 'QSC K12.2 Powered Speaker', 2, 48_000, {
		units: [{ tag: 'CMC-000104' }, { tag: 'CMC-000105' }],
		locationId: locByName['Stage left rack']
	});
	// One unit deliberately left untagged: gear gets entered before the roll of
	// stickers arrives, and the UI has to show that state honestly.
	received(purchase, 'Shure SM58', 3, 11_900, {
		units: [{ tag: 'CMC-000106' }, { tag: 'CMC-000107' }, {}],
		locationId: locByName['Stage left rack']
	});
	received(purchase, 'AKG P420 Condenser', 1, 29_900, {
		units: [{ tag: 'CMC-000108' }],
		locationId: locByName['Stage left rack']
	});
	received(purchase, 'XLR Cable (25ft)', 12, 1_800, { locationId: locByName['Stage left rack'] });
	received(purchase, 'Boom Mic Stand', 4, 3_500, { locationId: locByName['Storage closet'] });
	received(restock, "D'Addario EXL110 Strings", 12, 700, { locationId: locByName['Supply shelf'] });
	received(restock, 'Vic Firth 5A Drumsticks', 10, 1_100, {
		locationId: locByName['Supply shelf']
	});
	received(restock, '9V Batteries', 6, 1_400, { locationId: locByName['Supply shelf'] });
	// The unsigned gift, and a unit off it that gets disposed of below. Same
	// three-year window as CMC-000110, but with no Form 8283 on record — so it
	// lands in the compliance page's *count* rather than its queue, which is the
	// #309 behaviour and the one CMC actually hits.
	received(unackedGift, 'Shure SM58', 1, 9_000, {
		units: [{ tag: 'CMC-000111', serial: 'SM58-77120', condition: 'fair' }],
		locationId: locByName['Stage left rack']
	});
	// Two out-of-pocket shop trips: one outstanding, one already settled.
	received(fronted, "D'Addario EXL110 Strings", 4, 700, {
		locationId: locByName['Supply shelf']
	});
	received(frontedSettled, '9V Batteries', 2, 1_400, { locationId: locByName['Supply shelf'] });
	/**
	 * What the stocktake actually looks like: several kinds of thing on one
	 * record, no costs, no tags yet, and nothing filed anywhere.
	 *
	 * Every other seeded unit arrives tagged and shelved, which made two whole
	 * states unreachable locally — the `Unassigned` row on the locations page,
	 * and the "needs tagging" backlog the next phase is built around. A real
	 * stocktake produces both by the hundred: you carry the gear to the bench
	 * before the sticker roll arrives, and you file it afterwards.
	 */
	received(openingBalance, 'Shure SM58', 2, null, { units: [{}, {}] });
	received(openingBalance, 'Fender Blues Deluxe', 1, null, {
		units: [{ serial: 'FBD-091144', condition: 'poor' }]
	});
	received(openingBalance, 'XLR Cable (25ft)', 8, null);
	received(openingBalance, 'Boom Mic Stand', 3, null);

	/**
	 * A receipt's total and the lines it is made of must agree.
	 *
	 * They did not: four of the five seeded receipts disagreed with their own
	 * lines, the worst by $1,012, and `fronted` claimed $48 owed to a volunteer
	 * the lines put at $28 — a wrong number on a screen whose whole job is to
	 * tell somebody what they are owed. Hand-written totals drift the moment a
	 * line is added, so the total is now derived and cannot.
	 *
	 * Gifts keep a null total on purpose: a donation's worth is `fairValueCents`,
	 * which is a different claim from what it cost, and `opening_balance` has
	 * neither.
	 */
	for (const acq of acquisitionRows) {
		if (acq.totalCents == null) continue;
		acq.totalCents = lines
			.filter((l) => l.acquisitionId === acq.id)
			.reduce((sum, l) => sum + l.quantity * (l.unitValueCents ?? 0), 0);
	}

	// Acquisitions first: `acquisition_line` and `inventory_asset` both point at
	// them. This insert used to sit above, before the lines existed to total.
	await batchInsert(acquisition, acquisitionRows, 4);
	await batchInsert(acquisitionLine, lines, 4);
	await batchInsert(inventoryAsset, assets, 4);

	const assetByTag = Object.fromEntries(
		assets.filter((a) => a.assetTag).map((a) => [a.assetTag, a])
	);

	// -----------------------------------------------------------------------
	// Consumption and corrections, so the ledger reads like a real quarter and
	// the batteries land under their reorder point on their own.
	// -----------------------------------------------------------------------
	function used(itemName: string, quantity: number, daysAgo: number, notes: string) {
		movements.push({
			id: randomUUID(),
			itemId: itemByName[itemName].id,
			quantity: -quantity,
			reason: 'consume',
			locationId: locByName['Supply shelf'],
			actorId: staffId,
			occurredAt: new Date(now.getTime() - daysAgo * day),
			notes
		});
	}

	used("D'Addario EXL110 Strings", 3, 15, 'Restrung the house Strat');
	used("D'Addario EXL110 Strings", 2, 8, 'Open mic night');
	used('Vic Firth 5A Drumsticks', 4, 12, 'House kit');
	used('Vic Firth 5A Drumsticks', 3, 4, 'Broken during all-ages show');
	used('9V Batteries', 2, 18, 'Active DI boxes');
	// Leaves 9V at 6 − 2 − 2 = 2 against a reorder point of 5.
	used('9V Batteries', 2, 6, 'Wireless packs');

	// A stocktake correction: the honest way to change a count, and the reason
	// `adjust` is the one caller-signed reason in the vocabulary.
	movements.push({
		id: randomUUID(),
		itemId: itemByName['XLR Cable (25ft)'].id,
		quantity: -1,
		reason: 'adjust',
		locationId: locByName['Stage left rack'],
		actorId: staffId,
		occurredAt: new Date(now.getTime() - 5 * day),
		notes: 'Quarterly count — one unaccounted for'
	});

	// One amp out for repair, so a unit exists that is owned, on hand, and not
	// available. Only the per-unit status can say that.
	const blues = assetByTag['CMC-000102'];
	movements.push({
		id: randomUUID(),
		itemId: blues.itemId,
		assetId: blues.id,
		quantity: -1,
		reason: 'repair_out',
		actorId: staffId,
		occurredAt: new Date(now.getTime() - 3 * day),
		notes: 'Crackling on the clean channel'
	});

	// -----------------------------------------------------------------------
	// Loans across every state, with the movements they imply.
	// -----------------------------------------------------------------------
	const strat = assetByTag['CMC-000101'];
	const sm58 = assetByTag['CMC-000106'];
	const lespaul = assetByTag['CMC-000103'];
	const speaker = assetByTag['CMC-000104'];

	/**
	 * Purchase orders, one per state.
	 *
	 * The restock list subtracts what is on a *placed* order, so without at least
	 * one of these a local run can never see the behaviour orders exist for —
	 * the list would go on asking you to buy strings that are already coming.
	 * The late one is what the Orders page flags for chasing; the draft proves a
	 * shopping list still counts as missing until it is actually sent.
	 */
	const placedOrder = {
		id: randomUUID(),
		status: 'placed' as const,
		supplierName: 'Sweetwater',
		reference: 'SW-4472880',
		placedAt: new Date(now.getTime() - 4 * day),
		expectedAt: new Date(now.getTime() + 3 * day),
		createdByUserId: staffId,
		notes: 'Standing restock — strings and sticks.'
	};
	const lateOrder = {
		id: randomUUID(),
		status: 'placed' as const,
		supplierName: 'Troubadour Music',
		reference: 'TM-9912',
		placedAt: new Date(now.getTime() - 21 * day),
		expectedAt: new Date(now.getTime() - 5 * day),
		createdByUserId: staffId,
		notes: 'Chased once already.'
	};
	const draftOrder = {
		id: randomUUID(),
		status: 'draft' as const,
		supplierName: 'Corvallis Hardware',
		createdByUserId: staffId,
		notes: 'Not sent yet.'
	};
	const receivedOrder = {
		id: randomUUID(),
		status: 'received' as const,
		supplierName: 'Sweetwater',
		reference: 'SW-4471902',
		placedAt: new Date(now.getTime() - 26 * day),
		expectedAt: new Date(now.getTime() - 21 * day),
		createdByUserId: staffId
	};

	await batchInsert(purchaseOrder, [placedOrder, lateOrder, draftOrder, receivedOrder], 4);

	const orderLines: (typeof purchaseOrderLine.$inferInsert)[] = [
		// Partly delivered: six of ten arrived, four still out. This is the state
		// a boolean cannot express and the reason `quantityReceived` is a number.
		{
			id: randomUUID(),
			orderId: placedOrder.id,
			itemId: itemByName["D'Addario EXL110 Strings"].id,
			quantityOrdered: 10,
			unitCostCents: 700,
			quantityReceived: 6
		},
		{
			id: randomUUID(),
			orderId: placedOrder.id,
			itemId: itemByName['Vic Firth 5A Drumsticks'].id,
			quantityOrdered: 6,
			unitCostCents: 1_100,
			quantityReceived: 0
		},
		{
			id: randomUUID(),
			orderId: lateOrder.id,
			itemId: itemByName['9V Batteries'].id,
			quantityOrdered: 24,
			unitCostCents: 1_400,
			quantityReceived: 0
		},
		{
			id: randomUUID(),
			orderId: draftOrder.id,
			itemId: itemByName['XLR Cable (25ft)'].id,
			quantityOrdered: 6,
			unitCostCents: 1_800,
			quantityReceived: 0
		},
		{
			id: randomUUID(),
			orderId: receivedOrder.id,
			itemId: itemByName["D'Addario EXL110 Strings"].id,
			quantityOrdered: 12,
			unitCostCents: 700,
			quantityReceived: 12
		}
	];
	await batchInsert(purchaseOrderLine, orderLines, 4);

	// The receipt that closed the received order — the link the detail page
	// renders as "what arrived".
	await db
		.update(acquisition)
		.set({ purchaseOrderId: receivedOrder.id })
		.where(eq(acquisition.id, restock.id));

	const loanRows: (typeof inventoryLoan.$inferInsert)[] = [
		{
			id: randomUUID(),
			itemId: strat.itemId,
			assetId: strat.id,
			userId: users[0].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() - 10 * day),
			scheduledPickupDate: new Date(now.getTime() - 9 * day),
			dueDate: new Date(now.getTime() + 3 * day),
			checkedOutAt: new Date(now.getTime() - 9 * day),
			status: 'checked_out',
			dailyRateCents: 500,
			memberNotes: 'Need it for a gig this weekend'
		},
		{
			id: randomUUID(),
			itemId: sm58.itemId,
			assetId: sm58.id,
			userId: users[1].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() - 14 * day),
			scheduledPickupDate: new Date(now.getTime() - 13 * day),
			dueDate: new Date(now.getTime() - 2 * day),
			checkedOutAt: new Date(now.getTime() - 13 * day),
			status: 'checked_out',
			dailyRateCents: 500
		},
		{
			id: randomUUID(),
			itemId: lespaul.itemId,
			userId: users[2].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() + 2 * day),
			status: 'requested',
			memberNotes: 'Would love to try this for a recording session'
		},
		{
			id: randomUUID(),
			itemId: speaker.itemId,
			userId: users[3].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() + 1 * day),
			scheduledPickupDate: new Date(now.getTime() + 1 * day),
			status: 'scheduled',
			memberNotes: 'Need for band practice'
		},
		{
			id: randomUUID(),
			itemId: null,
			userId: users[4].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() + 3 * day),
			status: 'requested',
			memberNotes: 'Looking for a bass amp 300W+'
		},
		{
			id: randomUUID(),
			itemId: itemByName['XLR Cable (25ft)'].id,
			userId: users[1].id,
			quantity: 3,
			requestedPickupDate: new Date(now.getTime() - 20 * day),
			scheduledPickupDate: new Date(now.getTime() - 19 * day),
			dueDate: new Date(now.getTime() - 15 * day),
			checkedOutAt: new Date(now.getTime() - 19 * day),
			returnedAt: new Date(now.getTime() - 16 * day),
			status: 'returned',
			dailyRateCents: 0,
			totalChargeCents: 0,
			creditsCents: 0,
			cashCents: 0,
			staffNotes: 'Sustaining member — accessories free'
		},
		{
			id: randomUUID(),
			itemId: itemByName['AKG P420 Condenser'].id,
			userId: users[5].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() - 7 * day),
			status: 'cancelled'
		}
	];

	const loans = await batchInsert(inventoryLoan, loanRows, 3);

	// The two open checkouts have left the building; the returned cable loan went
	// out and came back. Written here so on-hand reflects what is physically in
	// the room, which is the invariant the whole rebuild rests on.
	for (const loan of loanRows) {
		if (!loan.itemId) continue;
		if (loan.checkedOutAt) {
			movements.push({
				id: randomUUID(),
				itemId: loan.itemId,
				assetId: loan.assetId ?? null,
				quantity: -(loan.quantity ?? 1),
				reason: 'loan_out',
				loanId: loan.id,
				actorId: staffId,
				occurredAt: loan.checkedOutAt
			});
		}
		if (loan.returnedAt) {
			movements.push({
				id: randomUUID(),
				itemId: loan.itemId,
				assetId: loan.assetId ?? null,
				quantity: loan.quantity ?? 1,
				reason: 'loan_return',
				loanId: loan.id,
				actorId: staffId,
				occurredAt: loan.returnedAt
			});
		}
	}

	// Units currently out or in the shop say so, so availability and the ledger
	// agree without anyone reconciling them by hand.
	await db
		.update(inventoryAsset)
		.set({ status: 'on_loan' })
		.where(inArray(inventoryAsset.id, [strat.id!, sm58.id!]));
	await db
		.update(inventoryAsset)
		.set({ status: 'maintenance', condition: 'poor' })
		.where(eq(inventoryAsset.id, blues.id!));

	// Disposed of 40 days ago: donated, inside the three-year window, and nobody
	// has recorded a Form 8282 outcome — so it shows on /staff/inventory/compliance
	// with roughly 85 of the 125 days left.
	const donatedDisposal = assets.find((a) => a.assetTag === 'CMC-000110');
	if (donatedDisposal) {
		const disposedAt = new Date(now.getTime() - 40 * day);
		await db
			.update(inventoryAsset)
			.set({
				status: 'retired',
				retiredAt: disposedAt,
				retiredReason: 'Cracked cabinet, sold for parts'
			})
			.where(eq(inventoryAsset.id, donatedDisposal.id!));
		movements.push({
			id: randomUUID(),
			itemId: donatedDisposal.itemId,
			assetId: donatedDisposal.id!,
			quantity: -1,
			reason: 'retire',
			actorId: staffId,
			occurredAt: disposedAt,
			notes: 'Cracked cabinet, sold for parts'
		});
	}

	// The unsigned gift's unit, disposed of inside the same window. Nothing owes
	// a filing for it, which is the point: the compliance page needs a
	// denominator for "nothing outstanding" or it reads like a page that is not
	// looking.
	const unsignedDisposal = assets.find((a) => a.assetTag === 'CMC-000111');
	if (unsignedDisposal) {
		const disposedAt = new Date(now.getTime() - 25 * day);
		await db
			.update(inventoryAsset)
			.set({
				status: 'retired',
				retiredAt: disposedAt,
				retiredReason: 'Capsule failed beyond economic repair'
			})
			.where(eq(inventoryAsset.id, unsignedDisposal.id!));
		movements.push({
			id: randomUUID(),
			itemId: unsignedDisposal.itemId,
			assetId: unsignedDisposal.id!,
			quantity: -1,
			reason: 'retire',
			actorId: staffId,
			occurredAt: disposedAt,
			notes: 'Capsule failed beyond economic repair'
		});
	}

	// `lost` is the one asset status the seed never produced, so its terminal
	// branch had no local representation at all.
	const lostUnit = assets.find((a) => a.assetTag === 'CMC-000107');
	if (lostUnit) {
		const lostAt = new Date(now.getTime() - 60 * day);
		await db
			.update(inventoryAsset)
			.set({ status: 'lost', retiredAt: lostAt, retiredReason: 'Not returned after a load-out' })
			.where(eq(inventoryAsset.id, lostUnit.id!));
		movements.push({
			id: randomUUID(),
			itemId: lostUnit.itemId,
			assetId: lostUnit.id!,
			quantity: -1,
			reason: 'loss',
			actorId: staffId,
			occurredAt: lostAt,
			notes: 'Not returned after a load-out'
		});
	}

	await batchInsert(stockMovement, movements, 4);

	return {
		categories: categories.length,
		locations: locations.length,
		items: items.length,
		assets: assets.length,
		acquisitions: acquisitionRows.length,
		orders: 4,
		movements: movements.length,
		loans: loans.length
	};
}

/**
 * Link a how-to to the gear it explains.
 *
 * Runs after both `seedEquipment` and `seedHelp`, and looks its rows up by name
 * rather than threading ids through two unrelated seeders for one join.
 */
export async function seedItemArticles() {
	const [pa] = await db
		.select({ id: inventoryItem.id })
		.from(inventoryItem)
		.where(eq(inventoryItem.name, 'QSC K12.2 Powered Speaker'))
		.limit(1);
	const [article] = await db
		.select({ id: helpArticle.id })
		.from(helpArticle)
		.where(eq(helpArticle.published, true))
		.limit(1);

	if (!pa || !article) return { links: 0 };

	await db
		.insert(inventoryItemArticle)
		.values({ itemId: pa.id, articleId: article.id })
		.onConflictDoNothing();

	return { links: 1 };
}

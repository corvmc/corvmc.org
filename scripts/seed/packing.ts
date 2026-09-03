import { packingItem, packingList } from '../../src/lib/server/db/schema/packing';
import { rider, riderElement } from '../../src/lib/server/db/schema/rider';
import { groupMember } from '../../src/lib/server/db/schema/group';
import { batchInsert, db } from './db';
import { and, eq } from 'drizzle-orm';
import type { PackingCategory } from '../../src/lib/config';
import type { RiderElementKind } from '../../src/lib/config';

/**
 * Band packing lists.
 *
 * Hung off the **same band the rider seed filled in**, and off its two logins,
 * so one account reaches both features and the promote-to-rider path in phase 3
 * has a real rider to promote into. The band id arrives as an argument rather
 * than being re-derived here; see the note on `seedRiders`' return value.
 *
 * What this fixture is *for* is the three rules a reader would otherwise have to
 * take on faith, each of which needs a row that shows it:
 *
 * - **Owning and carrying are different facts.** There is a row owned by the
 *   admin and assigned to the member, and shared rows (`userId: null`) assigned
 *   to a person. A seed where the two columns always agree is a seed that never
 *   shows why there are two.
 * - **Nobody has this.** Several rows are left unassigned, so the load-in page's
 *   leading section renders with something in it and the claim button has
 *   somewhere to land.
 * - **Anybody may pack anything.** Some packed rows were ticked by somebody who
 *   neither owns nor is bringing them.
 *
 * Plus the three promotion states, which exist to prove `promotedAt` earns its
 * column: on the rider and promoted, promotable and nagging, and promoted but
 * since deleted from the rider — the one that must *not* nag.
 *
 * Nothing is random. Counts on this page are load-bearing.
 */

const ADMIN = 'seed-rider-admin';
const MEMBER = 'seed-rider-member';

const HOURS = 3600_000;
const DAYS = 86_400_000;

interface Seeded {
	label: string;
	category: PackingCategory;
	quantity?: number;
	riderKind?: RiderElementKind;
	notes?: string;
	/** Whose it is. `null` is the band's own crate. */
	owner: string | null;
	/** Who is carrying it. `null` is nobody — the state that loses gear. */
	assigned?: string | null;
	/** Who put it on them; defaults to the assignee, i.e. they claimed it. */
	assignedBy?: string;
	/** Who ticked it. Present means packed. */
	packedBy?: string;
	promotedDaysAgo?: number;
}

/**
 * Every category, every assignment state, and a majority of rows carrying no
 * `riderKind` — because a thing that goes on the rider is the exception on a
 * packing list, and a fixture where most rows are promotable would teach the
 * opposite.
 *
 * Two of the three promotion states are static rows:
 * - "Fender Twin" and "Roland Jazz Chorus" have a kind, no `promotedAt`, and no
 *   matching element on the rider — the nudge.
 * - "Rhodes suitcase" has a kind and a `promotedAt` but still no match:
 *   promoted once, then deliberately deleted from the rider. It must render as
 *   settled rather than nagging forever, and it is the whole reason
 *   `promoted_at` is a bare timestamp and not a foreign key.
 *
 * The third — **on the rider and promoted** — cannot be written statically,
 * because the match is on `(owner, label)` and the rider seed hands its corners
 * out round-robin over a roster this file does not control. Guessing a pair
 * here produced a row that looked settled and silently was not. So it is
 * derived: `settledRows` reads the personas' actual elements back and mirrors
 * them.
 */
const ITEMS: Seeded[] = [
	// ---- backline: the heavy things, and the two-column case ----
	{
		label: 'Fender Twin',
		category: 'backline',
		riderKind: 'guitar_amp',
		owner: ADMIN,
		// Owned by the admin, carried by the member — this is the row the two
		// columns exist for, and the one to look at before touching either.
		assigned: MEMBER,
		assignedBy: ADMIN,
		packedBy: MEMBER,
		notes: 'Heavy. Two people on the stairs.'
	},
	{
		label: 'Roland Jazz Chorus',
		category: 'backline',
		riderKind: 'guitar_amp',
		owner: MEMBER,
		assigned: MEMBER
	},
	{
		label: 'Rhodes suitcase',
		category: 'backline',
		riderKind: 'keys',
		owner: ADMIN,
		assigned: ADMIN,
		promotedDaysAgo: 40
	},
	{
		label: 'PA tub',
		category: 'backline',
		owner: null,
		// Nobody has it. The band's own, so no owner to fall back on either —
		// exactly the row that stays in the practice room.
		assigned: null
	},

	// ---- instruments ----
	{ label: 'Bass + gig bag', category: 'instruments', owner: MEMBER, assigned: MEMBER },
	{
		label: 'Snare',
		category: 'instruments',
		owner: ADMIN,
		assigned: ADMIN,
		packedBy: ADMIN
	},
	{ label: 'Cymbal bag', category: 'instruments', owner: ADMIN, assigned: ADMIN, packedBy: MEMBER },
	{ label: 'Spare strings', category: 'instruments', quantity: 2, owner: MEMBER, assigned: null },

	// ---- audio ----
	{ label: 'DI box', category: 'audio', quantity: 3, owner: null, assigned: MEMBER },
	{ label: 'Tuner pedal', category: 'audio', owner: MEMBER, assigned: MEMBER, packedBy: MEMBER },

	// ---- cables & power ----
	{
		label: 'XLR cables',
		category: 'cables_power',
		quantity: 6,
		owner: null,
		assigned: ADMIN,
		assignedBy: ADMIN,
		packedBy: ADMIN
	},
	{ label: 'Power strips', category: 'cables_power', quantity: 2, owner: null, assigned: null },
	{
		label: 'Extension lead',
		category: 'cables_power',
		owner: null,
		assigned: MEMBER,
		// An admin handed this one out rather than the member claiming it, so
		// `assignedBy` differs from `assignedUserId` on at least one row.
		assignedBy: ADMIN
	},

	// ---- merch ----
	{ label: 'Merch tub', category: 'merch', owner: null, assigned: ADMIN, packedBy: ADMIN },
	{ label: 'Card reader', category: 'merch', owner: null, assigned: null },
	{ label: 'Cash float', category: 'merch', owner: null, assigned: ADMIN },

	// ---- paperwork ----
	{ label: 'Setlists', category: 'documents', quantity: 5, owner: null, assigned: MEMBER },
	{
		label: 'Stage plot printout',
		category: 'documents',
		owner: null,
		assigned: null,
		notes: 'Print it the morning of — the rider changes.'
	},

	// ---- personal ----
	{ label: 'Earplugs', category: 'personal', owner: MEMBER, assigned: MEMBER, packedBy: MEMBER },
	{ label: 'Spare shirt', category: 'personal', owner: ADMIN, assigned: ADMIN },

	// ---- other ----
	{ label: 'Gaff tape', category: 'other', quantity: 2, owner: null, assigned: null },
	{ label: 'First aid kit', category: 'other', owner: null, assigned: ADMIN }
];

export async function seedPacking(structuredBandId: string | null) {
	if (!structuredBandId) return { items: 0, packed: 0, unassigned: 0, settled: 0, band: null };

	// Both personas have to actually be on this roster — they are, from
	// `seedRiders` — because an assignment to a non-member is a state
	// `assignItem` refuses and one nothing should demonstrate.
	const roster = await db
		.select({ userId: groupMember.userId })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, structuredBandId), eq(groupMember.status, 'active')));
	const onRoster = new Set(roster.map((r) => r.userId));
	if (!onRoster.has(ADMIN) || !onRoster.has(MEMBER)) {
		return { items: 0, packed: 0, unassigned: 0, settled: 0, band: null };
	}

	// The **settled** promotion state, derived rather than guessed.
	//
	// `onRider` in phase 3 is a `(owner, label)` match, and the rider seed hands
	// its corners out round-robin over a roster this file does not control — so a
	// hardcoded pair here produced a row that read as settled and silently was
	// not. Reading the personas' actual elements back is the only way to write a
	// row that genuinely matches, and it stays correct if the rider seed's
	// ordering changes.
	const [head] = await db
		.select({ id: rider.id })
		.from(rider)
		.where(eq(rider.groupId, structuredBandId))
		.limit(1);

	const settled: Seeded[] = [];
	if (head) {
		for (const persona of [ADMIN, MEMBER]) {
			const [element] = await db
				.select({ label: riderElement.label, kind: riderElement.kind })
				.from(riderElement)
				.where(and(eq(riderElement.riderId, head.id), eq(riderElement.userId, persona)))
				.limit(1);
			// A wedge is on the rider and is not a thing anybody packs — it is what
			// the room supplies — so it is the one kind to skip here.
			if (!element || element.kind === 'monitor') continue;
			settled.push({
				label: element.label,
				category: element.kind === 'drum_kit' ? 'instruments' : 'backline',
				riderKind: element.kind,
				owner: persona,
				assigned: persona,
				packedBy: persona,
				promotedDaysAgo: 12
			});
		}
	}

	const all = [...settled, ...ITEMS];

	const now = Date.now();
	const listId = crypto.randomUUID();

	await db.insert(packingList).values({
		id: listId,
		groupId: structuredBandId,
		notes: 'Trailer key lives in the glovebox. Load the PA tub last — it comes out first.',
		// Nine days, so the load-in page's "cleared 9 days ago" line has something
		// to render and the staler-than-you-think case is visible without waiting.
		lastResetAt: new Date(now - 9 * DAYS),
		lastResetByUserId: ADMIN,
		createdAt: new Date(now - 60 * DAYS),
		updatedAt: new Date(now - 4 * DAYS)
	});

	const rows = all.map((item, i) => ({
		id: crypto.randomUUID(),
		listId,
		userId: item.owner,
		assignedUserId: item.assigned ?? null,
		assignedAt: item.assigned ? new Date(now - 6 * DAYS) : null,
		assignedByUserId: item.assigned ? (item.assignedBy ?? item.assigned) : null,
		category: item.category,
		label: item.label,
		quantity: item.quantity ?? 1,
		riderKind: item.riderKind ?? null,
		notes: item.notes ?? null,
		sortOrder: i,
		packed: !!item.packedBy,
		packedAt: item.packedBy ? new Date(now - 5 * HOURS) : null,
		packedByUserId: item.packedBy ?? null,
		promotedAt: item.promotedDaysAgo ? new Date(now - item.promotedDaysAgo * DAYS) : null,
		createdAt: new Date(now - 60 * DAYS)
	}));

	// Eighteen columns a row here — the seed writes every one rather than leaning
	// on defaults — so five rows a statement stays under D1's 100-bound-parameter
	// cap.
	await batchInsert(packingItem, rows, 5);

	return {
		items: rows.length,
		packed: rows.filter((r) => r.packed).length,
		unassigned: rows.filter((r) => r.assignedUserId === null).length,
		/** How many rows genuinely mirror an element already on the rider. */
		settled: settled.length,
		band: structuredBandId
	};
}

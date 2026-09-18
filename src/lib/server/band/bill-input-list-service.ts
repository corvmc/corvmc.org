import { db } from '$lib/server/db';
import { rider, riderElement, riderInput } from '$lib/server/db/schema/rider';
import { group, groupMember } from '$lib/server/db/schema/group';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { eventBand } from '$lib/server/db/schema/event';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { compareElements, type RiderElementView } from './rider-service';
import type { RiderInputSource, RiderStandType } from '$lib/config';

/**
 * The night's input list, not each act's: the desk has one channel count and it
 * is the show that has to fit it. Three acts of twelve pass their own checks.
 *
 * Nothing collapses automatically. Whether three kicks are one kick is the
 * house engineer's call, so repeats are marked and counted both ways —
 * `distinctCount` best case, `channelCount` worst.
 */

export interface BillChannel {
	/** Continuous across the whole bill, 1..n, in console order within each act. */
	channel: number;
	/** The `event_band` row, because a name is not unique on a bill. */
	actId: string;
	actName: string;
	inputId: string;
	label: string;
	/** The element the input hangs off — "Kit", "Bass rig". */
	elementLabel: string;
	ownerName: string | null;
	source: RiderInputSource;
	micPref: string | null;
	phantom: boolean;
	stand: RiderStandType;
	notes: string | null;
	/** Other acts asking for the same source, by name. Empty for most rows. */
	sharedWith: string[];
}

export interface BillAct {
	id: string;
	name: string;
	/** Null for an external act — there is no rider to link to. */
	slug: string | null;
	channelCount: number;
	/** Nothing structured at all: the list cannot speak for this act. */
	empty: boolean;
}

export interface BillInputList {
	acts: BillAct[];
	channels: BillChannel[];
	channelCount: number;
	phantomCount: number;
	/** Channels once every repeated source is patched once. The best case. */
	distinctCount: number;
	consoleChannels: number;
}

/** "Kick  Drum" and "kick drum" are the same request from two acts. */
function sourceKey(source: string, label: string): string {
	return `${source}|${label.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export interface BillActElements {
	id: string;
	name: string;
	elements: RiderElementView[];
}

/**
 * Number every input across the bill and mark the repeats.
 *
 * Pure, and exported for the same reason `numberChannels` is: a wrong number
 * here is invisible until someone is standing at a desk.
 */
export function buildBillChannels(acts: BillActElements[]): BillChannel[] {
	const namesByKey = new Map<string, Set<string>>();
	for (const act of acts) {
		for (const el of act.elements) {
			for (const input of el.inputs) {
				const key = sourceKey(input.source, input.label);
				const names = namesByKey.get(key) ?? new Set<string>();
				names.add(act.name);
				namesByKey.set(key, names);
			}
		}
	}

	const channels: BillChannel[] = [];
	let channel = 0;
	for (const act of acts) {
		for (const el of [...act.elements].sort(compareElements)) {
			for (const input of el.inputs) {
				const names = namesByKey.get(sourceKey(input.source, input.label)) ?? new Set<string>();
				channels.push({
					channel: ++channel,
					actId: act.id,
					actName: act.name,
					inputId: input.id,
					label: input.label,
					elementLabel: el.label,
					ownerName: el.ownerName,
					source: input.source,
					micPref: input.micPref,
					phantom: input.phantom,
					stand: input.stand,
					notes: input.notes,
					sharedWith: [...names].filter((n) => n !== act.name)
				});
			}
		}
	}
	return channels;
}

/** Distinct sources across the bill — what it costs if every repeat is patched once. */
export function countDistinctSources(channels: BillChannel[]): number {
	return new Set(channels.map((c) => sourceKey(c.source, c.label))).size;
}

export async function getBillInputList(
	eventId: string,
	consoleChannels: number
): Promise<BillInputList> {
	const billRows = await db
		.select({
			id: eventBand.id,
			name: eventBand.name,
			groupId: directoryEntry.groupId,
			slug: group.slug
		})
		.from(eventBand)
		.leftJoin(directoryEntry, eq(directoryEntry.id, eventBand.directoryEntryId))
		.leftJoin(group, eq(group.id, directoryEntry.groupId))
		.where(eq(eventBand.eventId, eventId))
		.orderBy(asc(eventBand.billingOrder));

	const groupIds = billRows.map((r) => r.groupId).filter((id): id is string => !!id);

	const elementRows = groupIds.length
		? await db
				.select({
					id: riderElement.id,
					groupId: rider.groupId,
					userId: riderElement.userId,
					// The band's word for who this is, matching `getRider` — one person
					// must not read as two across the sheet.
					ownerName: sql<string | null>`coalesce(${groupMember.alias}, ${user.name})`.as(
						'owner_name'
					),
					kind: riderElement.kind,
					label: riderElement.label,
					providedBy: riderElement.providedBy,
					notes: riderElement.notes,
					sortOrder: riderElement.sortOrder
				})
				.from(riderElement)
				.innerJoin(rider, eq(rider.id, riderElement.riderId))
				.leftJoin(user, eq(user.id, riderElement.userId))
				.leftJoin(
					groupMember,
					and(eq(groupMember.groupId, rider.groupId), eq(groupMember.userId, riderElement.userId))
				)
				.where(inArray(rider.groupId, groupIds))
				.orderBy(asc(riderElement.sortOrder))
		: [];

	const inputRows = elementRows.length
		? await db
				.select()
				.from(riderInput)
				.where(
					inArray(
						riderInput.elementId,
						elementRows.map((e) => e.id)
					)
				)
				.orderBy(asc(riderInput.sortOrder))
		: [];

	const inputsByElement = new Map<string, RiderElementView['inputs']>();
	for (const row of inputRows) {
		const list = inputsByElement.get(row.elementId) ?? [];
		list.push({
			id: row.id,
			channel: 0,
			label: row.label,
			source: row.source,
			micPref: row.micPref,
			phantom: row.phantom,
			stand: row.stand,
			monitorMixUserId: row.monitorMixUserId,
			notes: row.notes
		});
		inputsByElement.set(row.elementId, list);
	}

	const elementsByGroup = new Map<string, RiderElementView[]>();
	for (const row of elementRows) {
		const list = elementsByGroup.get(row.groupId) ?? [];
		list.push({ ...row, x: null, y: null, inputs: inputsByElement.get(row.id) ?? [] });
		elementsByGroup.set(row.groupId, list);
	}

	// A group can appear twice on one bill, and both credits carry its rider.
	const channels = buildBillChannels(
		billRows.map((row) => ({
			id: row.id,
			name: row.name,
			elements: row.groupId ? (elementsByGroup.get(row.groupId) ?? []) : []
		}))
	);

	const byAct = new Map<string, number>();
	for (const c of channels) byAct.set(c.actId, (byAct.get(c.actId) ?? 0) + 1);

	return {
		acts: billRows.map((row) => ({
			id: row.id,
			name: row.name,
			slug: row.slug ?? null,
			channelCount: byAct.get(row.id) ?? 0,
			empty: (byAct.get(row.id) ?? 0) === 0
		})),
		channels,
		channelCount: channels.length,
		phantomCount: channels.filter((c) => c.phantom).length,
		distinctCount: countDistinctSources(channels),
		consoleChannels
	};
}

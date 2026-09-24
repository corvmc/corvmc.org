/**
 * Whether a release's radio attestation is in force: given to the current
 * wording of `RADIO_PRO_ATTESTATION`, and less than `termMonths` old. The band's
 * view, the rotation and the staff readiness panel all read it from here, so an
 * attestation cannot lapse in one of them and not the others.
 */
import { db } from '$lib/server/db';
import { audioRelease } from '$lib/server/db/schema/audio';
import { group, groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { and, eq, gt, gte, inArray, isNull, lt, type SQL } from 'drizzle-orm';
import { RADIO_PRO_ATTESTATION } from '$lib/config';

function addMonths(d: Date, months: number): Date {
	const out = new Date(d);
	out.setUTCMonth(out.getUTCMonth() + months);
	return out;
}

export function radioAttestationExpiresAt(attestedAt: Date): Date {
	return addMonths(attestedAt, RADIO_PRO_ATTESTATION.termMonths);
}

export function radioAttested(
	r: { radioAttestationVersion: string | null; radioAttestedAt: Date | null },
	now: Date = new Date()
): boolean {
	return (
		r.radioAttestationVersion === RADIO_PRO_ATTESTATION.version &&
		r.radioAttestedAt !== null &&
		radioAttestationExpiresAt(r.radioAttestedAt) > now
	);
}

/** `radioAttested` as a predicate on `audio_release`. */
export function currentRadioAttestation(now: Date = new Date()): SQL {
	return and(
		eq(audioRelease.radioAttestationVersion, RADIO_PRO_ATTESTATION.version),
		gt(audioRelease.radioAttestedAt, addMonths(now, -RADIO_PRO_ATTESTATION.termMonths))
	)!;
}

export type ExpiringRadioAttestation = {
	releaseId: string;
	releaseTitle: string;
	bandName: string;
	bandSlug: string;
	attestedAt: Date;
	expiresAt: Date;
	bandAdmins: Array<{ userId: string; userName: string; userEmail: string }>;
};

/**
 * On-air releases whose attestation lapses in `[from, to)`, with the band admins
 * who can renew it. A release already off the air for another reason is left
 * out: reminding a band to re-attest something that would not play anyway is noise.
 */
export async function listRadioAttestationsExpiringBetween(
	from: Date,
	to: Date
): Promise<ExpiringRadioAttestation[]> {
	const term = RADIO_PRO_ATTESTATION.termMonths;
	const rows = await db
		.select({
			releaseId: audioRelease.id,
			releaseTitle: audioRelease.title,
			attestedAt: audioRelease.radioAttestedAt,
			bandName: group.name,
			bandSlug: group.slug,
			userId: user.id,
			userName: user.name,
			userEmail: user.email
		})
		.from(audioRelease)
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.innerJoin(groupMember, eq(groupMember.groupId, group.id))
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(
			and(
				eq(audioRelease.status, 'published'),
				eq(audioRelease.radioOptIn, true),
				eq(audioRelease.radioAttestationVersion, RADIO_PRO_ATTESTATION.version),
				gte(audioRelease.radioAttestedAt, addMonths(from, -term)),
				lt(audioRelease.radioAttestedAt, addMonths(to, -term)),
				isNull(audioRelease.radioExcludedAt),
				isNull(audioRelease.deletedAt),
				isNull(group.deletedAt),
				// The same people `listBandAdmins` returns.
				inArray(groupMember.role, ['owner', 'admin']),
				eq(groupMember.status, 'active'),
				isNull(user.deletedAt)
			)
		);

	const byRelease = new Map<string, ExpiringRadioAttestation>();
	for (const r of rows) {
		if (!r.attestedAt) continue;
		let entry = byRelease.get(r.releaseId);
		if (!entry) {
			entry = {
				releaseId: r.releaseId,
				releaseTitle: r.releaseTitle,
				bandName: r.bandName,
				bandSlug: r.bandSlug,
				attestedAt: r.attestedAt,
				expiresAt: radioAttestationExpiresAt(r.attestedAt),
				bandAdmins: []
			};
			byRelease.set(r.releaseId, entry);
		}
		entry.bandAdmins.push({ userId: r.userId, userName: r.userName, userEmail: r.userEmail });
	}
	return [...byRelease.values()];
}

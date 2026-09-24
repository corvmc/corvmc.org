import { describe, it, expect, vi } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { RADIO_PRO_ATTESTATION } from '$lib/config';

/**
 * The yearly term on a radio attestation (#1516). An attestation counts only to
 * the current wording and for twelve months from when it was given; past that
 * the release is off the air, in the band's view, the rotation and the staff
 * readiness panel alike, which is why all three read these two helpers.
 */

vi.mock('$lib/server/db', () => ({ db: {} }));

const { radioAttested, radioAttestationExpiresAt, currentRadioAttestation } =
	await import('./radio-attestation');

const NOW = new Date('2026-09-24T12:00:00Z');
const version = RADIO_PRO_ATTESTATION.version;
const dialect = new SQLiteSyncDialect();

describe('radioAttestationExpiresAt', () => {
	it('is twelve months after the attestation', () => {
		expect(radioAttestationExpiresAt(new Date('2026-03-10T08:00:00Z'))).toEqual(
			new Date('2027-03-10T08:00:00Z')
		);
	});
});

describe('radioAttested', () => {
	it('holds for a current attestation given under a year ago', () => {
		const attestedAt = new Date('2025-10-01T00:00:00Z');
		expect(
			radioAttested({ radioAttestationVersion: version, radioAttestedAt: attestedAt }, NOW)
		).toBe(true);
	});

	it('lapses twelve months after it was given', () => {
		const attestedAt = new Date('2025-09-20T00:00:00Z');
		expect(
			radioAttested({ radioAttestationVersion: version, radioAttestedAt: attestedAt }, NOW)
		).toBe(false);
	});

	it('does not count an attestation to earlier wording, however recent', () => {
		expect(
			radioAttested({ radioAttestationVersion: '2026-09-23', radioAttestedAt: NOW }, NOW)
		).toBe(false);
	});

	it('does not count a version with no date', () => {
		expect(radioAttested({ radioAttestationVersion: version, radioAttestedAt: null }, NOW)).toBe(
			false
		);
	});
});

describe('currentRadioAttestation', () => {
	it('checks the wording and the date in SQL', () => {
		const q = dialect.sqlToQuery(currentRadioAttestation(NOW));
		expect(q.sql).toContain('"audio_release"."radio_attestation_version" = ?');
		expect(q.sql).toContain('"audio_release"."radio_attested_at" > ?');
		expect(q.params).toContain(version);
		// Timestamp columns bind as unix seconds: a year before NOW.
		expect(q.params).toContain(Math.floor(new Date('2025-09-24T12:00:00Z').getTime() / 1000));
	});
});

import { renewal, type NewRenewal } from '../../src/lib/server/db/schema/renewal';
import { batchInsert } from './db';
import { ptDate } from './util';

/** `YYYY-MM-DD` for a day relative to today, in Pacific time. */
function day(offset: number): string {
	return ptDate(offset, 12).toISOString().slice(0, 10);
}

/**
 * Five of CMC's own renewals, one per state the list and the reminders treat
 * differently: lapsed, inside the fourteen-day stage, inside the sixty-day
 * stage, and comfortably far off. One has nobody responsible, so its reminder
 * goes to every renewal manager. No certificates: those live in R2.
 */
export async function seedRenewals(responsibleUserId: string) {
	console.log('Seeding renewals...');

	const rows: NewRenewal[] = [
		{
			id: 'seed-renewal-liability',
			name: 'General liability insurance',
			kind: 'insurance',
			issuer: 'Willamette Mutual',
			reference: 'GL-20417-CMC',
			expiresOn: day(9),
			responsibleUserId,
			notes: 'The certificate goes to the city with every sound permit.'
		},
		{
			id: 'seed-renewal-sound',
			name: 'Amplified sound permit',
			kind: 'permit',
			issuer: 'City of Corvallis',
			reference: 'SP-2026-118',
			expiresOn: day(-4),
			responsibleUserId
		},
		{
			id: 'seed-renewal-olcc',
			name: 'OLCC temporary sales license',
			kind: 'license',
			issuer: 'Oregon Liquor and Cannabis Commission',
			expiresOn: day(41)
		},
		{
			id: 'seed-renewal-ascap',
			name: 'Performance rights license',
			kind: 'license',
			issuer: 'ASCAP',
			reference: '500123456',
			expiresOn: day(210),
			responsibleUserId
		},
		{
			id: 'seed-renewal-fire',
			name: 'Fire inspection sign-off',
			kind: 'other',
			issuer: 'Corvallis Fire Department',
			expiresOn: day(330)
		}
	];

	await batchInsert(renewal, rows);
	return { renewals: rows.length };
}

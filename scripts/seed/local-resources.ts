import {
	localResource,
	localResourceCategory
} from '../../src/lib/server/db/schema/local-resource';
import { batchInsert } from './db';
import { randomUUID } from 'crypto';

/**
 * The local resources directory. Every status: published listings across the
 * categories, one pending tip with a submitter email, one returned with a note,
 * and one removed. One category is left empty so the delete path is reachable.
 * Businesses are illustrative; contact details use the .example domain.
 */
export async function seedLocalResources(staffId: string) {
	const cat = {
		shops: randomUUID(),
		venues: randomUUID(),
		records: randomUUID(),
		studios: randomUUID(),
		repair: randomUUID(),
		empty: randomUUID()
	};

	const categories = await batchInsert(localResourceCategory, [
		{ id: cat.shops, name: 'Instrument & gear shops', displayOrder: 1 },
		{ id: cat.venues, name: 'Venues', displayOrder: 2 },
		{ id: cat.records, name: 'Record stores', displayOrder: 3 },
		{ id: cat.studios, name: 'Rehearsal & recording', displayOrder: 4 },
		{ id: cat.repair, name: 'Repair techs', displayOrder: 5 },
		{ id: cat.empty, name: 'Lessons', displayOrder: 6 }
	]);

	const now = new Date();
	const published = { status: 'published' as const, reviewedByUserId: staffId, reviewedAt: now };

	const resources = await batchInsert(localResource, [
		{
			categoryId: cat.shops,
			name: 'Willamette Valley Music',
			description: 'Guitars, amps, strings and a good wall of pedals. Staff will set up a guitar.',
			website: 'https://wvmusic.example/',
			phone: '541-555-0110',
			addressLine: 'NW 2nd St, Corvallis',
			...published
		},
		{
			categoryId: cat.shops,
			name: 'Second Chance Drums',
			description: 'Used drums and cymbals, trade-ins welcome.',
			website: 'https://secondchancedrums.example/',
			...published
		},
		{
			categoryId: cat.venues,
			name: 'The Old Grange Hall',
			description: 'All-ages room for about 150; books local bills on weekends.',
			addressLine: 'Philomath',
			...published
		},
		{
			categoryId: cat.records,
			name: 'Spin Cycle Records',
			description: 'New and used vinyl, and a bin of local releases by the register.',
			website: 'https://spincycle.example/',
			phone: '541-555-0133',
			...published
		},
		{
			categoryId: cat.studios,
			name: 'Riverbend Studio',
			description: 'Tracking room and hourly rehearsal space with a backline.',
			website: 'https://riverbend.example/',
			...published
		},
		{
			categoryId: cat.repair,
			name: 'Corvallis Amp Works',
			description: 'Tube amp repair and speaker reconing.',
			phone: '541-555-0143',
			...published
		},
		{
			categoryId: cat.records,
			name: 'Basement Tapes',
			description: 'Cassettes and zines, open Saturdays.',
			submitterEmail: 'tipster@example.com',
			status: 'pending'
		},
		{
			categoryId: cat.venues,
			name: 'Somebody’s Garage',
			description: 'House shows.',
			submitterEmail: 'garage@example.com',
			status: 'rejected',
			staffNote: 'We only list public venues — a house show address cannot go on a public page.',
			reviewedByUserId: staffId,
			reviewedAt: now
		},
		{
			categoryId: cat.shops,
			name: 'Closed Guitar Shop',
			description: 'Closed in the spring.',
			deletedAt: now,
			...published
		}
	]);

	return { categories: categories.length, resources: resources.length };
}

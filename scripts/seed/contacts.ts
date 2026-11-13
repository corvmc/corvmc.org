import { seedOrganizations, seedPeople, type SeedOrganization, type SeedPerson } from './parties';

/**
 * Contacts beyond funders, sponsors and contractors: a partner, the press, and
 * the duplicates the Possible duplicates page exists for. Two press rows share
 * a website domain, and "Sam Okafor" here repeats Benton Electric's electrician
 * from `seedContractors`, so both suggestion kinds have something to show.
 */
export async function seedContacts() {
	console.log('Seeding contacts...');
	const orgs: SeedOrganization[] = [
		{
			id: 'seed-org-arts-center',
			name: 'Corvallis Arts Center',
			roles: ['partner', 'donor'],
			website: 'https://example.org/arts-center',
			notes: 'Co-hosts the winter showcase.',
			person: { name: 'Lena Ortiz', role: 'Programs director', email: 'lena@example.org' }
		},
		{
			id: 'seed-org-mid-valley-media',
			name: 'Mid-Valley Media',
			roles: ['press'],
			website: 'https://www.midvalleymedia.example',
			person: { name: 'Sam Okafor', role: 'Arts reporter', email: 'sam@midvalleymedia.example' }
		},
		{
			id: 'seed-org-mvm-news',
			name: 'MVM News',
			roles: ['press'],
			website: 'midvalleymedia.example/news'
		}
	];
	await seedOrganizations(orgs);
	// People with no organization, so the list's person rows and Type filter have something to show.
	const people: SeedPerson[] = [
		{
			id: 'seed-person-margaret-hale',
			name: 'Margaret Hale',
			email: 'margaret.hale@example.org',
			notes: 'Gives each December.',
			roles: ['donor']
		},
		{
			id: 'seed-person-dev-patel',
			name: 'Dev Patel',
			email: 'dev.patel@example.org',
			roles: ['donor', 'partner']
		},
		{ id: 'seed-person-ruth-ng', name: 'Ruth Ng', phone: '541-555-0142', roles: [] }
	];
	await seedPeople(people);
	return { organizations: orgs.length, people: people.length };
}

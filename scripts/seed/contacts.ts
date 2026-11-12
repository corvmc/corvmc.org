import { seedOrganizations, type SeedOrganization } from './parties';

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
			roles: ['partner'],
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
	return { organizations: orgs.length };
}

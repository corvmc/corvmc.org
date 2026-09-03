/**
 * Seed the local D1 database with fake data for UI development.
 *
 * Usage:
 *   pnpm db:seed
 *
 * This is DESTRUCTIVE — it deletes all data and rebuilds from scratch. Running it
 * twice is fine: `deleteAll()` clears every table first. Do not run against
 * production.
 *
 * Prerequisites:
 *   - The local D1 file exists and is migrated. `pnpm db:reset` does that and
 *     then calls this, so it is the one command to reach for; `pnpm db:seed`
 *     alone re-seeds a database that is already there.
 *
 * This file is the ORCHESTRATOR and nothing else. Every seeder lives in its own
 * file under `scripts/seed/`, one per feature, and the only thing that lives
 * here is the order they run in — which is a dependency graph, so the comments
 * explaining *why* a call sits where it does are the most valuable thing in the
 * file. `e2e/prepare.ts` is the same shape for the e2e fixtures.
 *
 * To add a feature: one new file under `scripts/seed/`, one call below placed
 * where its inputs already exist, and one line in the summary block.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, dispose } from './seed/db';
import { deleteAll } from './seed/teardown';
import { pendingSites } from './seed/pending';
import { seedRoles, seedUsers, seedAdminUser, seedUserRoles } from './seed/users';
import { seedReservations, seedClosures } from './seed/reservations';
import { seedEvents } from './seed/events';
import { seedBands } from './seed/bands';
import { SOLO_ACT_LOGIN, seedSoloAct } from './seed/solo-act';
import { seedGroups } from './seed/groups';
import { seedGroupDocuments } from './seed/group-documents';
import { seedDirectoryEntries } from './seed/directory';
import { seedDirectoryPersonas } from './seed/directory-personas';
import { seedInstructors } from './seed/instructors';
import { seedExternalActs } from './seed/external-acts';
import { seedGroupSessions } from './seed/group-sessions';
import { seedBandEvents } from './seed/band-events';
import { seedCommunityEvents } from './seed/community-events';
import { seedCmcEventLineups } from './seed/lineups';
import { seedBandReservations } from './seed/band-reservations';
import { seedBandSites, seedBandPageConfigs } from './seed/band-sites';
import { seedRecurringSeries } from './seed/recurring';
import { seedPaymentRecords } from './seed/payments';
import { seedTickets } from './seed/tickets';
import { seedRsvps } from './seed/rsvps';
import { seedNotifications, seedNotificationPreferences } from './seed/notifications';
import { seedCreditTransactions } from './seed/credits';
import { seedMarketing } from './seed/marketing';
import { seedEquipment, seedItemArticles } from './seed/equipment';
import { seedHelp } from './seed/help';
import { seedInbox } from './seed/inbox';
import { seedDirectMessages } from './seed/direct-messages';
import { seedContentFlags } from './seed/content-flags';
import { seedContractors } from './seed/contractors';
import { seedDutyLists } from './seed/duty-lists';
import {
	seedVolunteerRoles,
	seedVolunteerProfiles,
	seedVolunteerInterests,
	seedCertifications,
	seedWorkOrders,
	seedVolunteerHours
} from './seed/volunteer';
import { seedVolunteerPersonas } from './seed/volunteer-personas';
import { seedSustainingPersonas } from './seed/sustaining-personas';
import { seedSuggestions } from './seed/suggestions';
import { seedProjects } from './seed/projects';
import { seedRiders } from './seed/rider';
import { seedPacking } from './seed/packing';

async function main() {
	console.log('\nStarting dev seed...\n');

	// Off for the whole seed: the call order below is a dependency graph, not a
	// topological guarantee — several seeders backfill a parent after the child.
	// Turned back on at the end, before anything reads.
	await db.run(sql`PRAGMA foreign_keys = OFF`);

	await deleteAll();

	const roles = await seedRoles();
	const adminUser = await seedAdminUser();
	const users = await seedUsers(20);
	await seedUserRoles(users, adminUser, roles);
	const allUsers = [adminUser, ...users];
	const reservations = await seedReservations(allUsers);
	await seedClosures();
	const events = await seedEvents(allUsers);
	const bands = await seedBands(allUsers);
	// Appended rather than folded into `seedBands`: it brings its own persona and
	// login, and every downstream band seeder either maps over the whole array —
	// which should include it — or slices the first few, which should not.
	const soloAct = await seedSoloAct(roles);
	if (soloAct) bands.push(soloAct);
	const groups = await seedGroups(allUsers);
	// After the bands and before the entries, which is the only window that works:
	// it reads `pendingTags` to point each persona at data the bulk seed actually
	// produced, and `seedDirectoryEntries` is what gives these accounts a listing
	// at all.
	const directoryPersonas = await seedDirectoryPersonas(roles);
	// Before anything that writes a lineup credit, because a credit names an
	// entry. Every user and group the seed creates exists by this point — the
	// last of them is `seedGroups` above — so it can still read them all back,
	// which is the property it was placed last for.
	const directory = await seedDirectoryEntries();
	const instructors = await seedInstructors(allUsers, adminUser);
	const externalActs = await seedExternalActs();
	const groupSessions = await seedGroupSessions(groups);
	const groupDocuments = await seedGroupDocuments(groups, allUsers);
	const bandEvents = await seedBandEvents(bands, allUsers);
	await seedCommunityEvents(users, adminUser);
	await seedCmcEventLineups(events, bands);
	const bandReservations = await seedBandReservations(bands);
	const bandSites = await seedBandSites(bands);
	const pageConfigs = await seedBandPageConfigs(bands);
	const series = await seedRecurringSeries(allUsers);
	const payments = await seedPaymentRecords(allUsers, reservations);
	const tickets = await seedTickets(allUsers, events);
	const rsvps = await seedRsvps(allUsers);
	const notifications = await seedNotifications(allUsers);
	const preferences = await seedNotificationPreferences(allUsers);
	await seedCreditTransactions(allUsers);
	const marketing = await seedMarketing(allUsers);
	const eq = await seedEquipment(allUsers);
	const help = await seedHelp();
	const itemArticles = await seedItemArticles();
	const contractors = await seedContractors(adminUser.id);
	const inbox = await seedInbox(adminUser, users[0]);
	const directMessages = await seedDirectMessages(users, adminUser);
	const flags = await seedContentFlags(allUsers, bands, bandEvents);
	const volunteerRoles = await seedVolunteerRoles();
	// Profiles first, and everything downstream is seeded against the members who
	// actually finished onboarding. Hours or a shift signup belonging to somebody
	// with no profile would be invisible to them — /member/volunteer would bounce
	// them to /start before the page rendered.
	const volunteerProfiles = await seedVolunteerProfiles(allUsers, adminUser);
	const activeVolunteers = volunteerProfiles.active;
	const volunteerInterests = await seedVolunteerInterests(activeVolunteers, volunteerRoles);
	const certifications = await seedCertifications(allUsers, volunteerRoles);
	const workOrders = await seedWorkOrders(activeVolunteers, volunteerRoles, events);
	// After the shifts, which is new: half the completed signups get an hour log
	// pointing back at the shift that earned them.
	const volunteerHours = await seedVolunteerHours(
		activeVolunteers,
		volunteerRoles,
		workOrders.completions
	);
	// Last of the volunteer block — it grants against the certifications above and
	// schedules against the role catalog.
	const personas = await seedVolunteerPersonas(roles, volunteerRoles, certifications, adminUser);
	const dutyLists = await seedDutyLists(volunteerRoles, events);
	// Needs only the role catalog. Kept out of `allUsers` like the volunteer
	// personas, so nothing that slices or indexes that array shifts under it.
	const sustainingPersonas = await seedSustainingPersonas(roles);
	const suggestions = await seedSuggestions(allUsers, adminUser);
	// Last: it attaches rows every seeder above it has already written, and reads
	// the committees, the suggestion it answers and the shows it groups.
	const projects = await seedProjects(events, adminUser.id);
	// After the bands and their rosters: a rider is owned corner by corner, so it
	// reads the roster back rather than being handed one.
	const riders = await seedRiders(roles);
	// Straight after the rider, whose band and logins it reuses: one account
	// reaches both features, and the promote path has a real rider to aim at.
	const packing = await seedPacking(riders.structuredBandId);

	await db.run(sql`PRAGMA foreign_keys = ON`);

	const premiumBands = bands.filter(
		(b: any) => pendingSites.get(b.id)?.tier === 'premium' && !b.deletedAt
	);
	console.log('\nSeed complete:');
	console.log(`  ${allUsers.length} users (admin: admin@corvallismusic.org / password)`);
	console.log(`  ${roles.length} roles`);
	console.log(`  ${reservations.length} reservations`);
	console.log(`  ${events.length} CMC events`);
	console.log(`  ${bands.length} bands (${premiumBands.length} premium, 1 solo act)`);
	console.log(`  ${groups.length} groups (clubs and committees)`);
	console.log(
		`  ${dutyLists.lists} duty list, ${dutyLists.workOrders} work orders applied to a show`
	);
	console.log(`  ${externalActs.length} external acts (hidden, unowned)`);
	console.log(
		`  ${instructors.rows} instructors (3 active, 1 paused, 1 awaiting review, 1 sent back)` +
			` with ${instructors.lessons ?? 0} teaching bookings`
	);
	console.log(
		`  ${groupSessions.length} group sessions (${groupSessions.filter((e) => e.reservationId).length} holding the room)`
	);
	console.log(
		`  ${groupDocuments.length} group documents (${groupDocuments.filter((d) => d.deletedAt).length} removed)`
	);
	console.log(`  ${bandEvents.length} band events`);
	console.log(`  ${bandReservations.length} band reservations`);
	console.log(`  ${bandSites.size} band sites`);
	console.log(`  ${pageConfigs.length} band page configs with EPK data`);
	console.log(`  ${series.length} recurring series`);
	console.log(`  ${payments.length} payment records`);
	console.log(`  ${tickets.length} tickets`);
	console.log(`  ${rsvps.length} RSVPs`);
	console.log(`  ${notifications.length} notifications`);
	console.log(`  ${preferences.length} notification preferences`);
	console.log(
		`  ${marketing.audiences} audiences, ${marketing.subscribers} subscribers, ${marketing.campaigns} campaigns`
	);
	console.log(
		`  ${eq.categories} categories, ${eq.locations} locations, ${eq.items} items, ${eq.assets} units,\n` +
			`  ${eq.acquisitions} acquisitions, ${eq.orders} purchase orders, ${eq.movements} stock movements, ${eq.loans} loans`
	);
	console.log(
		`  ${help.categories} help categories, ${help.articles} help articles, ${itemArticles.links} linked to gear`
	);
	console.log(
		`  ${contractors.contractors} contractors, ${contractors.jobs} contractor jobs (1 overdue, 1 unit at the shop, 1 lapsed certificate)`
	);
	console.log(`  ${directory.entries} directory entries, ${directory.tags} directory tags`);
	console.log(`  ${directoryPersonas.users} directory matching demo personas`);
	console.log(`  ${inbox.threads} inbox threads, ${inbox.messages} messages, ${inbox.notes} notes`);
	console.log(
		`  ${directMessages.threads} direct conversations, ${directMessages.blocks} blocks, ${directMessages.standings} messaging standings, 1 member-set messaging preference`
	);
	console.log(`  ${flags.length} content flags`);
	console.log(
		`  ${volunteerRoles.length} volunteer roles, ${volunteerProfiles.rows.length} volunteer profiles (${volunteerProfiles.blocked} awaiting review), ${volunteerHours.length} volunteer hour logs, ${volunteerInterests.length} role interests`
	);
	console.log(
		`  ${certifications.certs} certifications (${certifications.held} held), ${workOrders.shifts} shifts, ${workOrders.signups} signups, ${workOrders.feedback} feedback`
	);
	console.log(`  ${personas.users} volunteer demo personas`);
	console.log(`  ${sustainingPersonas.users} sustaining demo personas`);
	console.log(
		`  ${suggestions.total} suggestions (${suggestions.votes} votes, ${suggestions.pendingEdits} edit awaiting review)`
	);
	console.log(
		`  ${projects.projects} projects (1 over budget, 1 answering a suggestion, 1 festival over ${projects.events} nights)`
	);
	console.log(
		`  ${riders.riders} tech riders — ${riders.structuredBand ?? '—'} (fits the room), ${riders.oversizedBand ?? '—'} (over it); ${riders.uploadBand ?? '—'} uploaded a PDF; ${riders.emptyBand ?? '—'} has nothing`
	);
	console.log(
		`  ${packing.items} packing rows on the same band — ${packing.packed} already in the van, ${packing.unassigned} nobody has yet, ${packing.settled} already on the rider`
	);
	console.log('\n  Tech rider demo logins (all `password`):');
	console.log('    rideradmin@corvallismusic.org   admin — can edit anyone’s corner');
	console.log('    ridermember@corvallismusic.org  member — own corner only');
	console.log('\n  Volunteer demo logins (all `password`):');
	console.log('    coordinator@corvallismusic.org  staff — every /staff/volunteer page');
	console.log('    volunteer@corvallismusic.org    active volunteer — /member/volunteer');
	console.log('    newcomer@corvallismusic.org     no profile — /member/volunteer/start');
	console.log('    minor@corvallismusic.org        blocked — /member/volunteer/blocked');
	console.log('\n  Sustaining demo logins (all `password`):');
	console.log('    sustaining@corvallismusic.org   active, mid-cycle — /member/membership');
	console.log('    cancelling@corvallismusic.org   ending at period end — resume path');
	console.log('    feecoverer@corvallismusic.org   covering fees — fee schedule');
	console.log('    lapsed@corvallismusic.org       former member — win-back CTA');
	console.log('\n  Directory matching demo logins (all `password`):');
	console.log('    seeker@corvallismusic.org       wants a band — matched bands on /member');
	console.log('    bandleader@corvallismusic.org   wants members — matched members on /member');
	console.log('    undecided@corvallismusic.org    no lookingFor — the empty state');

	console.log('\n  Solo-act demo login (`password`):');
	console.log(
		`    ${SOLO_ACT_LOGIN.email}    one-person act — /member/bands, /band/${SOLO_ACT_LOGIN.slug}`
	);
	console.log('\n  Volunteer deep links:');
	console.log('    /member/volunteer/feedback/seed-vol-signup-feedback');
	console.log('    /staff/volunteer/shifts/seed-vol-shift-cancelled');

	console.log('\n  Premium band pages available at:');
	for (const b of premiumBands) {
		console.log(`    http://localhost:5173/?__band_subdomain=${b.slug}`);
	}

	await dispose();
}
main().catch((err) => {
	console.error(err);
	process.exit(1);
});

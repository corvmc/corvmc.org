import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form, command } from '$app/server';
import {
	getAllProductConfigs,
	updateProductConfig,
	type ProductKey
} from '$lib/server/finance/product-config-service';
import {
	getConfigsByPrefix,
	updateSiteConfigs,
	updateSiteConfig
} from '$lib/server/site-config/site-config-service';
import { testConnection } from '$lib/server/lock/ultraloc-client';
import { issueLockSelfTest, revokeLockSelfTest } from '$lib/server/lock/lock-service';
import { requireCapability } from '$lib/server/authorization';
import { getAllFeatureFlags, ALL_FLAGS, type FeatureFlag } from '$lib/server/feature-flags';
import { getInboxChannelConfigs } from './inbox.remote';
import { syncAllSubscriptions } from '$lib/server/finance/subscription-sync-service';
import { refreshCommunityStats as refreshStats } from '$lib/server/finance/community-stats';

// ---------------------------------------------------------------------------
// Public queries (no auth)
// ---------------------------------------------------------------------------

type OrgConfigs = Awaited<ReturnType<typeof getConfigsByPrefix>>;

function socialFrom(settings: OrgConfigs) {
	return {
		facebook: String(settings.socialFacebook ?? ''),
		instagram: String(settings.socialInstagram ?? '')
	};
}

function addressFrom(settings: OrgConfigs) {
	return {
		street: String(settings.addressStreet ?? ''),
		city: String(settings.addressCity ?? ''),
		state: String(settings.addressState ?? ''),
		zip: String(settings.addressZip ?? '')
	};
}

export const getSocialLinks = query(async () => socialFrom(await getConfigsByPrefix('org')));

export const getOrgAddress = query(async () => addressFrom(await getConfigsByPrefix('org')));

/**
 * The site footer's one load-bearing query.
 *
 * It used to await `getSocialLinks()` and `getOrgAddress()` side by side, which is two
 * requests for one `org` config read and — past kit 2.64 — a crash: a component holding two
 * remote queries in flight blows up in Svelte's reactivity rather than rendering
 * (JAVASCRIPT-SVELTEKIT-2H, on a page whose footer sits in every public route). One query,
 * one config read.
 *
 * `getOrgAddress` stays exported because `/contact` reads it on its own, and a page with a
 * single query is not the shape that breaks.
 */
export const getFooterInfo = query(async () => {
	const settings = await getConfigsByPrefix('org');
	return { social: socialFrom(settings), address: addressFrom(settings) };
});

// ---------------------------------------------------------------------------
// Staff queries — remote queries are directly addressable endpoints, so each
// one must self-guard; the staff layout guard does not cover them.
// ---------------------------------------------------------------------------

export const getProducts = query(async () => {
	await requireCapability('settings.read');
	return getAllProductConfigs();
});

export const getReservationSettings = query(async () => {
	await requireCapability('settings.read');
	return getConfigsByPrefix('reservation');
});

export const getOrgSettings = query(async () => {
	await requireCapability('settings.read');
	return getConfigsByPrefix('org');
});

/**
 * What an hour of donated volunteer time is worth, and where that figure comes
 * from. Both, because a grant narrative has to cite its rate and the citation
 * would otherwise drift a year behind the number it describes.
 */
export const getVolunteerValueSettings = query(async () => {
	await requireCapability('settings.read');
	const raw = await getConfigsByPrefix('volunteer');
	return {
		hourValueCents: Number(raw.hourValueCents ?? 0),
		hourValueSource: String(raw.hourValueSource ?? '')
	};
});

export const getIntegrationSettings = query(async () => {
	await requireCapability('settings.read');
	const raw = await getConfigsByPrefix('integration.utec');
	return {
		clientId: raw.clientId ? String(raw.clientId) : '',
		clientSecret: raw.clientSecret ? String(raw.clientSecret) : '',
		deviceId: raw.deviceId ? String(raw.deviceId) : '',
		refreshToken: raw.refreshToken ? String(raw.refreshToken) : ''
	};
});

export const testUtecConnection = query(async () => {
	await requireCapability('settings.read');
	return testConnection();
});

// Exercise the real st.lockUser command path (create + list) and issue a
// short-lived test code so staff can physically verify the door.
//
// `settings.update` rather than a read: this issues a working door code. It is
// grouped with the integration settings it verifies, and the Technology
// Coordinator is the position that holds both — but if lock management ever
// grows past a self-test, it wants a capability of its own rather than riding
// on the one that also renames the organisation.
export const runLockSelfTest = command(async () => {
	await requireCapability('settings.update');
	return issueLockSelfTest();
});

export const revokeLockTest = command(async () => {
	await requireCapability('settings.update');
	return revokeLockSelfTest();
});

// ---------------------------------------------------------------------------
// Forms — Product pricing
// ---------------------------------------------------------------------------

const updateProductSchema = z.object({
	key: z.enum(['contribution', 'fee_coverage']),
	name: z.string().trim().min(1, 'Name is required'),
	description: z.string().trim(),
	unitAmountCents: z.string().regex(/^\d+$/, 'Amount must be a whole number of cents')
});

export const updateProduct = form(updateProductSchema, async (raw) => {
	await requireCapability('settings.update');
	const data = raw as z.infer<typeof updateProductSchema>;

	await updateProductConfig(data.key as ProductKey, {
		name: data.name,
		description: data.description || null,
		unitAmountCents: parseInt(data.unitAmountCents, 10)
	});

	void getStaffSettingsPage().refresh();

	return { success: true };
});

// ---------------------------------------------------------------------------
// Forms — Reservation settings
// ---------------------------------------------------------------------------

const reservationSettingsSchema = z
	.object({
		operatingHoursStart: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format'),
		operatingHoursEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format'),
		timeSlotMinutes: z.string().regex(/^\d+$/).transform(Number),
		minDurationHours: z
			.string()
			.regex(/^\d+(\.\d+)?$/)
			.transform(Number),
		maxDurationHours: z.string().regex(/^\d+$/).transform(Number),
		bufferMinutes: z.string().regex(/^\d+$/).transform(Number),
		minAdvanceMinutes: z.string().regex(/^\d+$/).transform(Number),
		maxAdvanceDaysOneoff: z.string().regex(/^\d+$/).transform(Number),
		maxAdvanceDaysRecurring: z
			.string()
			.regex(/^\d+(\.\d+)?$/)
			.transform(Number),
		hourlyRateCents: z.string().regex(/^\d+$/).transform(Number),
		teachingRateCents: z.string().regex(/^\d+$/).transform(Number),
		teachingMinDurationHours: z
			.string()
			.regex(/^\d+(\.\d+)?$/)
			.transform(Number),
		teachingMaxAdvanceDaysOneoff: z.string().regex(/^\d+$/).transform(Number),
		teachingMaxAdvanceDaysRecurring: z.string().regex(/^\d+$/).transform(Number)
	})
	// A teaching series is Tier 2 in the generator, so it can be waitlisted behind
	// a member's one-off. The mitigation needs no machinery — a teaching horizon
	// longer than any member can book into means the series is already
	// materialised before a member can reach that week — but it only holds while
	// this stays true, so it is refused at the point of saving rather than left to
	// drift.
	.refine((d) => d.teachingMaxAdvanceDaysRecurring > d.maxAdvanceDaysOneoff, {
		path: ['teachingMaxAdvanceDaysRecurring'],
		message: 'Must exceed the member one-off window, or teachers lose their standing slots'
	});

export const updateReservationSettings = form(reservationSettingsSchema, async (raw) => {
	await requireCapability('settings.update');
	const data = raw as z.infer<typeof reservationSettingsSchema>;

	await updateSiteConfigs([
		{ key: 'reservation.operatingHoursStart', value: data.operatingHoursStart },
		{ key: 'reservation.operatingHoursEnd', value: data.operatingHoursEnd },
		{ key: 'reservation.timeSlotMinutes', value: data.timeSlotMinutes },
		{ key: 'reservation.minDurationHours', value: data.minDurationHours },
		{ key: 'reservation.maxDurationHours', value: data.maxDurationHours },
		{ key: 'reservation.bufferMinutes', value: data.bufferMinutes },
		{ key: 'reservation.minAdvanceMinutes', value: data.minAdvanceMinutes },
		{ key: 'reservation.maxAdvanceDaysOneoff', value: data.maxAdvanceDaysOneoff },
		{ key: 'reservation.maxAdvanceDaysRecurring', value: data.maxAdvanceDaysRecurring },
		{ key: 'reservation.hourlyRateCents', value: data.hourlyRateCents },
		{ key: 'reservation.teachingRateCents', value: data.teachingRateCents },
		{ key: 'reservation.teachingMinDurationHours', value: data.teachingMinDurationHours },
		{
			key: 'reservation.teachingMaxAdvanceDaysOneoff',
			value: data.teachingMaxAdvanceDaysOneoff
		},
		{
			key: 'reservation.teachingMaxAdvanceDaysRecurring',
			value: data.teachingMaxAdvanceDaysRecurring
		}
	]);

	void getStaffSettingsPage().refresh();

	return { success: true };
});

// ---------------------------------------------------------------------------
// Forms — Organization settings
// ---------------------------------------------------------------------------

const orgSettingsSchema = z.object({
	name: z.string().trim().min(1, 'Organization name is required'),
	shortName: z.string().trim().min(1, 'Short name is required'),
	contactEmail: z.string().trim().email('Invalid email address'),
	timezone: z.string().trim().min(1, 'Timezone is required'),
	addressStreet: z.string().trim().max(200).optional().default(''),
	addressCity: z.string().trim().max(100).optional().default(''),
	addressState: z.string().trim().max(50).optional().default(''),
	addressZip: z.string().trim().max(20).optional().default(''),
	socialFacebook: z.string().trim().max(500).optional().default(''),
	socialInstagram: z.string().trim().max(500).optional().default('')
});

export const updateOrgSettings = form(orgSettingsSchema, async (raw) => {
	await requireCapability('settings.update');
	const data = raw as z.infer<typeof orgSettingsSchema>;

	await updateSiteConfigs([
		{ key: 'org.name', value: data.name },
		{ key: 'org.shortName', value: data.shortName },
		{ key: 'org.contactEmail', value: data.contactEmail },
		{ key: 'org.timezone', value: data.timezone },
		{ key: 'org.addressStreet', value: data.addressStreet ?? '' },
		{ key: 'org.addressCity', value: data.addressCity ?? '' },
		{ key: 'org.addressState', value: data.addressState ?? '' },
		{ key: 'org.addressZip', value: data.addressZip ?? '' },
		{ key: 'org.socialFacebook', value: data.socialFacebook ?? '' },
		{ key: 'org.socialInstagram', value: data.socialInstagram ?? '' }
	]);

	void getStaffSettingsPage().refresh();
	// Both, not either: `/contact` reads `getOrgAddress` directly, the footer reads it only
	// through `getFooterInfo`, and refreshing one repaints nothing for the other.
	void getOrgAddress().refresh();
	void getFooterInfo().refresh();

	return { success: true };
});

// ---------------------------------------------------------------------------
// Forms — Volunteer hour value
// ---------------------------------------------------------------------------

/**
 * Its own form rather than four more fields on `orgSettingsSchema`: one form,
 * one config prefix, so a save here cannot half-write the org address.
 */
const volunteerValueSchema = z.object({
	hourValueCents: z.string().regex(/^\d+$/, 'Whole cents, digits only').transform(Number),
	hourValueSource: z.string().trim().min(1, 'Say where the rate came from').max(200)
});

export const updateVolunteerValueSettings = form(volunteerValueSchema, async (raw) => {
	await requireCapability('settings.update');
	const data = raw as z.infer<typeof volunteerValueSchema>;

	await updateSiteConfigs([
		{ key: 'volunteer.hourValueCents', value: data.hourValueCents },
		{ key: 'volunteer.hourValueSource', value: data.hourValueSource }
	]);

	void getStaffSettingsPage().refresh();

	return { success: true };
});

// ---------------------------------------------------------------------------
// Forms — Integration settings
// ---------------------------------------------------------------------------

const integrationSettingsSchema = z.object({
	clientId: z.string().trim(),
	clientSecret: z.string().trim(),
	deviceId: z.string().trim(),
	refreshToken: z.string().trim()
});

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export const getFeatureFlags = query(async () => {
	await requireCapability('settings.read');
	return getAllFeatureFlags();
});

// Kept as an alias rather than a second hand-maintained list: the two drifted
// apart and `contentFlags` was missing here, so the settings toggle 400'd.
const VALID_FLAGS: FeatureFlag[] = ALL_FLAGS;

export const updateFeatureFlag = form(
	z.object({
		flag: z.string(),
		enabled: z.enum(['true', 'false']).transform((v) => v === 'true')
	}),
	async (data) => {
		await requireCapability('settings.update');
		if (!VALID_FLAGS.includes(data.flag as FeatureFlag)) {
			throw error(400, 'Invalid feature flag');
		}
		await updateSiteConfig(`feature.${data.flag}`, data.enabled);
		void getStaffSettingsPage().refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Subscription status sync
// ---------------------------------------------------------------------------

export const syncSubscriptions = command(async () => {
	await requireCapability('settings.update');
	return syncAllSubscriptions();
});

export const refreshCommunityStats = command(async () => {
	await requireCapability('settings.update');
	return refreshStats();
});

export const updateIntegrationSettings = form(integrationSettingsSchema, async (raw) => {
	await requireCapability('settings.update');
	const data = raw as z.infer<typeof integrationSettingsSchema>;

	await updateSiteConfigs([
		{ key: 'integration.utec.clientId', value: data.clientId },
		{ key: 'integration.utec.clientSecret', value: data.clientSecret },
		{ key: 'integration.utec.deviceId', value: data.deviceId },
		{ key: 'integration.utec.refreshToken', value: data.refreshToken }
	]);

	void getStaffSettingsPage().refresh();

	return { success: true };
});

/**
 * The staff settings page's one load-bearing query.
 *
 * Six tabs' worth of configuration, and every constituent is unparameterized — which is what makes
 * this composable at all: each of the mutations that used to refresh them one at a time can name
 * this wrapper with no argument.
 */
export const getStaffSettingsPage = query(z.void(), async () => {
	await requireCapability('settings.read');

	const [products, reservation, org, volunteerValue, integration, channelConfigs, featureFlags] =
		await Promise.all([
			getProducts(),
			getReservationSettings(),
			getOrgSettings(),
			getVolunteerValueSettings(),
			getIntegrationSettings(),
			getInboxChannelConfigs(),
			getFeatureFlags()
		]);

	return { products, reservation, org, volunteerValue, integration, channelConfigs, featureFlags };
});

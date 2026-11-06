<script lang="ts">
	import {
		IconLayoutDashboard,
		IconUsersGroup,
		IconMessages,
		IconSpeakerphone,
		IconCoin,
		IconDisc,
		IconCalendarEvent,
		IconMetronome,
		IconPencil,
		IconFolders,
		IconSettings,
		IconCrown,
		IconBrush,
		IconPlug,
		IconPackage
	} from '@tabler/icons-svelte';
	import ErrorToastBoundary from '#lib/components/ui/ErrorToastBoundary.svelte';
	import { EntityViewer } from '#lib/components/ui/entity/index.js';
	import AppShell from '#lib/components/layout/AppShell.svelte';
	import Nav from '#lib/components/layout/Nav/index.js';
	import { panelTabs } from '#lib/components/layout/panel-tabs.js';
	import { navTrail } from '#lib/components/layout/nav-trail.js';
	import { setBreadcrumbTrail } from '#lib/components/ui/breadcrumbs.js';
	import { page } from '$app/state';
	import { getBandLayout, requireBandLayoutSession } from '#lib/remote/layout.remote.js';
	import { setBandLayoutContext } from './layout-context';
	import {
		activeBandNavKey,
		bandNavFooter,
		bandNavItems,
		bandNavMain,
		type BandNavKey,
		type BandNavItem
	} from './nav-items';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug');

	let { children } = $props();

	// Before the await, not after: the `await` below suspends the script body, and `setContext`
	// has to run during synchronous init. The getter defers reading `layout` until a child
	// renders, which is after this script has finished.
	setBandLayoutContext({
		get current() {
			return layout;
		}
	});

	setBreadcrumbTrail({
		get current() {
			return navTrail([{ items: bandNavItems(navInput) }], page.url.pathname);
		}
	});

	// The sign-in gate first, then the data (#2197): kit 3 gives a query no page, so the gate takes it
	// as an argument, and the data query stays unkeyed so a mutation's `.refresh()` finds it.
	// Serial, not beside it — two queries in flight at once is the kit ≥2.65 render loop.
	// Runs once per mount: a slug change inside the panel falls back to `getBandLayout`'s own
	// forward, which drops the subpage.
	await requireBandLayoutSession({
		slug: params.slug,
		path: page.url.pathname + page.url.search
	});
	let layout = $derived(await getBandLayout(params.slug));

	// The gating itself lives in `nav-items.ts` as data, so it can be asserted
	// against for every role and flag combination — this file has had the role
	// checks wrong twice. The template below only decides how to draw each entry.
	let navInput = $derived({
		slug: layout.band.slug,
		bandId: layout.band.id,
		tier: layout.band.tier,
		userRole: layout.userRole,
		isStaff: layout.isStaff,
		features: layout.features
	});

	const mainItems = $derived(bandNavMain(navInput));
	const footerItems = $derived(bandNavFooter(navInput));
	let activeKey = $derived(activeBandNavKey(navInput, page.url.pathname));

	const icons: Record<BandNavKey, typeof IconLayoutDashboard> = {
		dashboard: IconLayoutDashboard,
		messages: IconMessages,
		members: IconUsersGroup,
		rider: IconPlug,
		packing: IconPackage,
		announcements: IconSpeakerphone,
		reservations: IconMetronome,
		events: IconCalendarEvent,
		music: IconDisc,
		payouts: IconCoin,
		edit: IconPencil,
		'press-kit': IconFolders,
		'page-editor': IconBrush,
		subscription: IconCrown,
		settings: IconSettings,
		'staff-tools': IconSettings
	};

	const panels = $derived(panelTabs(layout));
</script>

{#snippet row(item: BandNavItem)}
	{@const Icon = icons[item.key]}
	<Nav.Item href={item.href} label={item.label} active={activeKey === item.key}>
		{#snippet icon()}<Icon />{/snippet}
	</Nav.Item>
{/snippet}

<AppShell drawerId="band-drawer" {panels} activePanel={layout.band.slug} chrome={layout.chrome}>
	{#snippet navigation()}
		{#each mainItems as item (item.key)}
			{@render row(item)}
		{/each}

		<!-- The spacer the member panel uses: administering the band is about it
		     rather than in it, so those rows sit at the foot rather than at the
		     end of the list where the useful ones are. -->
		<div class="flex grow"></div>

		{#each footerItems as item (item.key)}
			{@render row(item)}
		{/each}
	{/snippet}
	<ErrorToastBoundary>
		<EntityViewer
			panel="band"
			userId={layout.user.id}
			isStaff={layout.isStaff}
			bands={layout.userBands}
		>
			{@render children()}
		</EntityViewer>
	</ErrorToastBoundary>
</AppShell>

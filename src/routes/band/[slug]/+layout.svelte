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
	import ErrorToastBoundary from '$lib/components/ui/ErrorToastBoundary.svelte';
	import { EntityViewer } from '$lib/components/ui/entity';
	import AppShell from '$lib/components/layout/AppShell.svelte';
	import Nav from '$lib/components/layout/Nav';
	import { panelTabs } from '$lib/components/layout/panel-tabs';
	import { page } from '$app/state';
	import { getBandLayout } from '$lib/remote/layout.remote';
	import { setBandLayoutContext } from './layout-context';
	import {
		activeBandNavKey,
		bandNavFooter,
		bandNavMain,
		type BandNavKey,
		type BandNavItem
	} from './nav-items';

	let { children } = $props();

	// Before the await, not after: the `await` below suspends the script body, and `setContext`
	// has to run during synchronous init. The getter defers reading `layout` until a child
	// renders, which is after this script has finished.
	setBandLayoutContext({
		get current() {
			return layout;
		}
	});

	let layout = $derived(await getBandLayout(page.params.slug!));

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

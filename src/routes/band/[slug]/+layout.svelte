<script lang="ts">
	import {
		IconLayoutDashboard,
		IconUsersGroup,
		IconCalendar,
		IconCalendarEvent,
		IconPencil,
		IconSettings,
		IconCrown,
		IconBrush,
		IconExternalLink
	} from '@tabler/icons-svelte';
	import { env } from '$env/dynamic/public';
	import { bandSiteUrl } from '$lib/utils/band-site-url';
	import ErrorToastBoundary from '$lib/components/shared/ErrorToastBoundary.svelte';
	import { EntityViewer } from '$lib/components/shared/entity';
	import AppShell from '$lib/components/shared/AppShell.svelte';
	import Nav from '$lib/components/shared/Nav';
	import { panelTabs } from '$lib/components/shared/panel-tabs';
	import { page } from '$app/state';
	import { getBandLayout } from '$lib/remote/layout.remote';
	import { activeBandNavKey, bandNavItems, type BandNavKey } from './nav-items';

	let { children } = $props();

	let layout = $derived(await getBandLayout(page.params.slug!));

	// A custom domain only replaces the subdomain once it is actually serving.
	const liveCustomDomain = $derived(
		layout.band.customDomainStatus === 'active' ? layout.band.customDomain : null
	);
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

	const navItems = $derived(bandNavItems(navInput));
	let activeKey = $derived(activeBandNavKey(navInput, page.url.pathname));

	const icons: Record<BandNavKey, typeof IconLayoutDashboard> = {
		dashboard: IconLayoutDashboard,
		members: IconUsersGroup,
		reservations: IconCalendar,
		events: IconCalendarEvent,
		edit: IconPencil,
		'page-editor': IconBrush,
		'live-site': IconExternalLink,
		subscription: IconCrown,
		settings: IconSettings,
		'staff-tools': IconSettings
	};

	const panels = $derived(panelTabs(layout));
</script>

<AppShell drawerId="band-drawer" {panels} activePanel={layout.band.slug}>
	{#snippet navigation()}
		{#each navItems as item (item.key)}
			{@const Icon = icons[item.key]}
			<Nav.Item
				href={item.key === 'live-site'
					? bandSiteUrl(layout.band.slug, env.PUBLIC_SITE_URL, liveCustomDomain)
					: item.href}
				label={item.label}
				active={activeKey === item.key}
				target={item.external ? '_blank' : undefined}
				rel={item.external ? 'noopener' : undefined}
			>
				{#snippet icon()}<Icon />{/snippet}
			</Nav.Item>
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

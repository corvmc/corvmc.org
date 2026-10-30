<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import ErrorToastBoundary from '$lib/components/ui/ErrorToastBoundary.svelte';
	import { EntityViewer } from '$lib/components/ui/entity';
	import AppShell from '$lib/components/layout/AppShell.svelte';
	import Nav from '$lib/components/layout/Nav';
	import { readStarred, resolveStarred, toggleStarred } from '$lib/components/layout/Nav/nav-stars';
	import {
		IconDisc,
		IconCheckbox,
		IconMapPinPlus,
		IconBulb,
		IconSpeakerphone,
		IconUsers,
		IconClipboardCheck,
		IconSettings,
		IconHistory,
		IconShieldLock,
		IconCash,
		IconCoins,
		IconMail,
		IconMailbox,
		IconTool,
		IconAlertTriangle,
		IconHammer,
		IconFolders,
		IconClipboardList,
		IconPackage,
		IconReceipt,
		IconChartBar,
		IconScale,
		IconBook,
		IconLayoutDashboard,
		IconInbox,
		IconFlag,
		IconHeartHandshake,
		IconUsersGroup,
		IconReportAnalytics,
		IconCalendarWeek,
		IconCalendarMonth,
		IconMapPin,
		IconKey,
		IconBuildingStore,
		IconContract,
		IconCertificate
	} from '@tabler/icons-svelte';
	import { getStaffLayout } from '$lib/remote/layout.remote';
	import { panelTabs } from '$lib/components/layout/panel-tabs';
	import { navTrail } from '$lib/components/layout/nav-trail';
	import { setBreadcrumbTrail } from '$lib/components/ui/breadcrumbs';
	import {
		activeNavKey,
		childHrefsFor,
		filterNavItems,
		filterNavSections,
		sectionHasKey,
		staffNavSections,
		staffNavTop,
		type StaffNavBadgeKey,
		type StaffNavItem,
		type StaffNavKey
	} from './nav-items';

	let { children } = $props();

	// Before the await: `setContext` has to run during synchronous init. The full
	// tree, not the filtered one — a trail only ever names rows above a page the
	// viewer already reached.
	const trailGroups = [{ items: staffNavTop }, ...staffNavSections];
	setBreadcrumbTrail({
		get current() {
			return navTrail(trailGroups, page.url.pathname);
		}
	});

	// Above the await, so `onMount` registers during synchronous init. Read after
	// hydration, like section collapse state, so server and first paint agree.
	let starredKeys = $state<string[]>([]);
	onMount(() => (starredKeys = readStarred('staff')));
	const toggleStar = (key: StaffNavKey) => (starredKeys = toggleStarred('staff', key));

	let layout = $derived(await getStaffLayout());

	// Only the rows this viewer can use. `getStaffLayout` settled that they may
	// open the panel; this settles which of it is worth showing them. Hiding a
	// row is not a guard — the guard is on the remote function behind it — but
	// offering a treasurer a Volunteering row is offering them a 403.
	const navTop = $derived(filterNavItems(staffNavTop, layout.capabilities));
	const navSections = $derived(filterNavSections(staffNavSections, layout.capabilities));
	// Resolved against the filtered tree, so a star on a row this viewer cannot
	// see, or on a key that no longer exists, simply does not render.
	const navStarred = $derived(
		resolveStarred(starredKeys, [...navTop, ...navSections.flatMap((s) => s.items)])
	);

	const panels = $derived(
		// Staff is unconditional here: `getStaffLayout` has already redirected
		// anyone without the role, so reaching this layout proves `isStaff`.
		panelTabs({ isStaff: true, userBands: layout.userBands })
	);

	// The rows live in `nav-items.ts`; these two maps are the only things that
	// need a Svelte file. Keeping the counts here means a renamed field on
	// `getStaffLayout` is a type error rather than a badge that quietly stops.
	const icons: Record<StaffNavKey, typeof IconLayoutDashboard> = {
		dashboard: IconLayoutDashboard,
		inbox: IconInbox,
		users: IconUsers,
		groups: IconUsersGroup,
		music: IconDisc,
		ballots: IconCheckbox,
		volunteer: IconHeartHandshake,
		'volunteer-schedule': IconCalendarWeek,
		'project-templates': IconClipboardList,
		'volunteer-report': IconReportAnalytics,
		reservations: IconClipboardCheck,
		equipment: IconTool,
		'equipment-reports': IconFlag,
		'equipment-loans': IconPackage,
		'inventory-acquisitions': IconReceipt,
		'inventory-spend': IconChartBar,
		'inventory-compliance': IconScale,
		contractors: IconHammer,
		incidents: IconAlertTriangle,
		keys: IconKey,
		projects: IconFolders,
		venues: IconMapPin,
		calendar: IconCalendarMonth,
		flags: IconFlag,
		suggestions: IconBulb,
		classifieds: IconSpeakerphone,
		campaigns: IconMail,
		audiences: IconMailbox,
		help: IconBook,
		'local-resources': IconMapPin,
		'resource-tips': IconMapPinPlus,
		reports: IconReportAnalytics,
		payments: IconCash,
		credits: IconCoins,
		sponsors: IconBuildingStore,
		grants: IconContract,
		renewals: IconCertificate,
		settings: IconSettings,
		access: IconShieldLock,
		audit: IconHistory
	};

	let badges = $derived({
		inboxUnread: layout.inboxUnread,
		resourceTipsPending: layout.resourceTipsPending,
		suggestionsAwaiting: layout.suggestionsAwaiting,
		volunteerPending: layout.volunteerPending,
		listingsPending: layout.listingsPending,
		appealsPending: layout.appealsPending
	} satisfies Record<StaffNavBadgeKey, number>);

	let activeKey = $derived(activeNavKey(page.url.pathname));

	function badgeFor(item: StaffNavItem): number | undefined {
		return item.badgeKey ? badges[item.badgeKey] : undefined;
	}
</script>

{#snippet row(item: StaffNavItem)}
	{@const Icon = icons[item.key]}
	{#if item.children}
		<Nav.Collapsible
			href={item.href}
			label={item.label}
			childHrefs={childHrefsFor(item)}
			badge={badgeFor(item)}
			active={activeKey === item.key}
			starred={starredKeys.includes(item.key)}
			onstar={() => toggleStar(item.key)}
		>
			{#snippet icon()}<Icon />{/snippet}
			{#each item.children as child (child.key)}
				{@render row(child)}
			{/each}
		</Nav.Collapsible>
	{:else}
		{@render flat(item)}
	{/if}
{/snippet}

<!-- A starred collapsible appears here as a plain row: its children stay home. -->
{#snippet flat(item: StaffNavItem)}
	{@const Icon = icons[item.key]}
	<Nav.Item
		href={item.href}
		label={item.label}
		badge={badgeFor(item)}
		active={activeKey === item.key}
		starred={starredKeys.includes(item.key)}
		onstar={() => toggleStar(item.key)}
	>
		{#snippet icon()}<Icon />{/snippet}
	</Nav.Item>
{/snippet}

<AppShell drawerId="staff-drawer" {panels} activePanel="staff" chrome={layout.chrome}>
	{#snippet navigation()}
		{#if navStarred.length > 0}
			<Nav.Group title="Starred">
				{#each navStarred as item (item.key)}
					{@render flat(item)}
				{/each}
			</Nav.Group>
		{/if}

		{#each navTop as item (item.key)}
			{@render row(item)}
		{/each}

		{#each navSections as section (section.key)}
			<Nav.Group
				title={section.title}
				collapsible
				persistKey={section.key}
				containsActive={sectionHasKey(section, activeKey)}
			>
				{#each section.items as item (item.key)}
					{@render row(item)}
				{/each}
			</Nav.Group>
		{/each}
	{/snippet}
	<ErrorToastBoundary>
		<!-- `getStaffLayout` redirects anyone without the role, so reaching this
		     markup is itself the proof that the viewer is staff. -->
		<EntityViewer
			panel="staff"
			userId={layout.user.id}
			isStaff
			capabilities={layout.capabilities}
			bands={layout.userBands}
		>
			{@render children()}
		</EntityViewer>
	</ErrorToastBoundary>
</AppShell>

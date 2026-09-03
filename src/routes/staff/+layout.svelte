<script lang="ts">
	import { page } from '$app/state';
	import ErrorToastBoundary from '$lib/components/ui/ErrorToastBoundary.svelte';
	import { EntityViewer } from '$lib/components/ui/entity';
	import AppShell from '$lib/components/layout/AppShell.svelte';
	import Nav from '$lib/components/layout/Nav';
	import {
		IconDisc,
		IconSchool,
		IconBulb,
		IconUsers,
		IconClipboardCheck,
		IconTag,
		IconTruckDelivery,
		IconCalendarEvent,
		IconBan,
		IconSettings,
		IconCash,
		IconCoins,
		IconRepeat,
		IconMusic,
		IconMail,
		IconMailbox,
		IconTool,
		IconHammer,
		IconFolders,
		IconClipboardList,
		IconPackage,
		IconShoppingCart,
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
		IconListDetails,
		IconCalendarWeek,
		IconCalendarMonth
	} from '@tabler/icons-svelte';
	import { getStaffLayout } from '$lib/remote/layout.remote';
	import { panelTabs } from '$lib/components/layout/panel-tabs';
	import {
		activeNavKey,
		childHrefsFor,
		sectionHasKey,
		staffNavSections,
		staffNavTop,
		type StaffNavBadgeKey,
		type StaffNavItem,
		type StaffNavKey
	} from './nav-items';

	let { children } = $props();

	let layout = $derived(await getStaffLayout());

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
		bands: IconMusic,
		music: IconDisc,
		groups: IconUsersGroup,
		volunteer: IconHeartHandshake,
		'volunteer-schedule': IconCalendarWeek,
		'volunteer-people': IconUsersGroup,
		'volunteer-setup': IconListDetails,
		'volunteer-duty-lists': IconClipboardList,
		'volunteer-report': IconReportAnalytics,
		reservations: IconClipboardCheck,
		recurring: IconRepeat,
		closures: IconBan,
		instructors: IconSchool,
		equipment: IconTool,
		'inventory-intake': IconTruckDelivery,
		'inventory-tagging': IconTag,
		'equipment-loans': IconPackage,
		'inventory-acquisitions': IconReceipt,
		'inventory-restock': IconShoppingCart,
		'inventory-orders': IconTruckDelivery,
		'inventory-spend': IconChartBar,
		'inventory-compliance': IconScale,
		contractors: IconHammer,
		'contractor-jobs': IconClipboardList,
		projects: IconFolders,
		productions: IconCalendarEvent,
		calendar: IconCalendarMonth,
		flags: IconFlag,
		suggestions: IconBulb,
		campaigns: IconMail,
		audiences: IconMailbox,
		help: IconBook,
		payments: IconCash,
		credits: IconCoins,
		settings: IconSettings
	};

	let badges = $derived({
		inboxUnread: layout.inboxUnread,
		suggestionsAwaiting: layout.suggestionsAwaiting,
		volunteerPending: layout.volunteerPending,
		listingsPending: layout.listingsPending
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
		>
			{#snippet icon()}<Icon />{/snippet}
			{#each item.children as child (child.key)}
				{@render row(child)}
			{/each}
		</Nav.Collapsible>
	{:else}
		<Nav.Item
			href={item.href}
			label={item.label}
			badge={badgeFor(item)}
			active={activeKey === item.key}
		>
			{#snippet icon()}<Icon />{/snippet}
		</Nav.Item>
	{/if}
{/snippet}

<AppShell drawerId="staff-drawer" {panels} activePanel="staff">
	{#snippet navigation()}
		{#each staffNavTop as item (item.key)}
			{@render row(item)}
		{/each}

		{#each staffNavSections as section (section.key)}
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
		<EntityViewer panel="staff" userId={layout.user.id} isStaff bands={layout.userBands}>
			{@render children()}
		</EntityViewer>
	</ErrorToastBoundary>
</AppShell>

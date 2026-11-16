<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import ErrorToastBoundary from '#lib/components/ui/ErrorToastBoundary.svelte';
	import { EntityViewer } from '#lib/components/ui/entity/index.js';
	import AppShell from '#lib/components/layout/AppShell.svelte';
	import Nav from '#lib/components/layout/Nav/index.js';
	import {
		readStarred,
		resolveStarred,
		toggleStarred
	} from '#lib/components/layout/Nav/nav-stars.js';
	import {
		IconDisc,
		IconCheckbox,
		IconBulb,
		IconSpeakerphone,
		IconUsers,
		IconClipboardCheck,
		IconSettings,
		IconHistory,
		IconCash,
		IconMail,
		IconTool,
		IconFolders,
		IconPackage,
		IconBook,
		IconLayoutDashboard,
		IconInbox,
		IconFlag,
		IconUsersGroup,
		IconReportAnalytics,
		IconCalendarWeek,
		IconCalendarMonth,
		IconAddressBook,
		IconContract,
		IconArrowLeft,
		IconBuilding,
		IconToggleRight,
		IconKey
	} from '@tabler/icons-svelte';
	import { getStaffLayout, requireLayoutSession } from '#lib/remote/layout.remote.js';
	import { panelTabs } from '#lib/components/layout/panel-tabs.js';
	import { navTrail } from '#lib/components/layout/nav-trail.js';
	import { setBreadcrumbTrail } from '#lib/components/ui/breadcrumbs.js';
	import {
		activeNavKey,
		activeSystemKey,
		childHrefsFor,
		inSystemPanel,
		filterNavItems,
		filterNavSections,
		sectionHasKey,
		staffNavBottom,
		staffNavSections,
		staffNavTop,
		systemNavItems,
		type StaffNavBadgeKey,
		type StaffNavItem,
		type StaffNavKey
	} from './nav-items';

	let { children } = $props();

	// Before the await: `setContext` has to run during synchronous init. The full
	// tree, not the filtered one — a trail only ever names rows above a page the
	// viewer already reached.
	const trailGroups = [{ items: staffNavTop }, ...staffNavSections, { items: staffNavBottom }];
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

	// The sign-in gate first, then the data (#2197): kit 3 gives a query no page, so the gate takes it
	// as an argument, and the data query stays unkeyed so a mutation's `.refresh()` finds it.
	// Serial, not beside it — two queries in flight at once is the kit ≥2.65 render loop.
	await requireLayoutSession(page.url.pathname + page.url.search);
	let layout = $derived(await getStaffLayout());

	// Only the rows this viewer can use. `getStaffLayout` settled that they may
	// open the panel; this settles which of it is worth showing them. Hiding a
	// row is not a guard — the guard is on the remote function behind it — but
	// offering a treasurer a Volunteering row is offering them a 403.
	const navTop = $derived(filterNavItems(staffNavTop, layout.capabilities));
	const navSections = $derived(filterNavSections(staffNavSections, layout.capabilities));
	const navBottom = $derived(filterNavItems(staffNavBottom, layout.capabilities));
	const navSystem = $derived(filterNavItems(systemNavItems, layout.capabilities));
	// The System panel swaps this sidebar for its own (#2763).
	const system = $derived(inSystemPanel(page.url.pathname));
	// Resolved against the filtered tree, so a star on a row this viewer cannot
	// see, or on a key that no longer exists, simply does not render.
	const navStarred = $derived(
		resolveStarred(starredKeys, [...navTop, ...navSections.flatMap((s) => s.items), ...navBottom])
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
		'volunteer-schedule': IconCalendarWeek,
		reservations: IconClipboardCheck,
		gear: IconTool,
		supplies: IconPackage,
		projects: IconFolders,
		calendar: IconCalendarMonth,
		moderation: IconFlag,
		suggestions: IconBulb,
		classifieds: IconSpeakerphone,
		outreach: IconMail,
		content: IconBook,
		reports: IconReportAnalytics,
		payments: IconCash,
		contacts: IconAddressBook,
		funding: IconContract,
		settings: IconSettings,
		organization: IconBuilding,
		features: IconToggleRight,
		access: IconKey,
		audit: IconHistory
	};

	let badges = $derived({
		inboxUnread: layout.inboxUnread,
		volunteerPending: layout.volunteerPending,
		reviewWaiting: layout.reviewWaiting
	} satisfies Record<StaffNavBadgeKey, number>);

	let activeKey = $derived(
		system ? activeSystemKey(page.url.pathname) : activeNavKey(page.url.pathname)
	);

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

{#snippet staffNav()}
	{#if navStarred.length > 0}
		<Nav.Group title={m.staff_starred_title()}>
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

	{#each navBottom as item (item.key)}
		{@render row(item)}
	{/each}
{/snippet}

<AppShell drawerId="staff-drawer" {panels} activePanel="staff" chrome={layout.chrome}>
	{#snippet navigation()}
		{#if system}
			<Nav.Item href={resolve('staff')} label={m.staff_system_back_label()} active={false}>
				{#snippet icon()}<IconArrowLeft />{/snippet}
			</Nav.Item>
			<Nav.Group title={m.staff_system_title()}>
				<!-- Not starrable: a star shows in the staff sidebar, which these rows are not in. -->
				{#each navSystem as item (item.key)}
					{@const Icon = icons[item.key]}
					<Nav.Item href={item.href} label={item.label} active={activeKey === item.key}>
						{#snippet icon()}<Icon />{/snippet}
					</Nav.Item>
				{/each}
			</Nav.Group>
		{:else}
			{@render staffNav()}
		{/if}
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

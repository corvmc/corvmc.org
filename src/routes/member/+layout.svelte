<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		IconReceipt,
		IconLayoutDashboard,
		IconStar,
		IconCalendarEvent,
		IconAddressBook,
		IconTool,
		IconPackage,
		IconPlus,
		IconHelp,
		IconMetronome,
		IconMessages,
		IconUser,
		IconSettings,
		IconHeartHandshake,
		IconBulb
	} from '@tabler/icons-svelte';
	import AppShell from '$lib/components/layout/AppShell.svelte';
	import Nav from '$lib/components/layout/Nav';
	import { childHrefsFor } from '$lib/components/layout/Nav/active-nav';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ErrorToastBoundary from '$lib/components/ui/ErrorToastBoundary.svelte';
	import { EntityViewer } from '$lib/components/ui/entity';
	import { getMemberLayout } from '$lib/remote/layout.remote';
	import { setMemberLayoutContext } from './layout-context';
	import { panelTabs } from '$lib/components/layout/panel-tabs';
	import {
		activeMemberNavKey,
		memberNavFooter,
		memberNavMain,
		type MemberNavBadgeKey,
		type MemberNavItem,
		type MemberNavKey
	} from './nav-items';

	let { children } = $props();

	// Before the await, not after: the `await` below suspends the script body, and `setContext`
	// has to run during synchronous init. See `layout-context.ts`.
	setMemberLayoutContext({
		get current() {
			return layout;
		}
	});

	let layout = $derived(await getMemberLayout());

	const panels = $derived(panelTabs(layout));

	const icons: Record<MemberNavKey, typeof IconLayoutDashboard> = {
		dashboard: IconLayoutDashboard,
		messages: IconMessages,
		reservations: IconMetronome,
		events: IconCalendarEvent,
		'events-submit': IconPlus,
		directory: IconAddressBook,
		purchases: IconReceipt,
		// Matches the staff panel's Inventory glyph, so the same thing looks the
		// same on both sides.
		equipment: IconTool,
		'equipment-loans': IconPackage,
		volunteer: IconHeartHandshake,
		suggestions: IconBulb,
		profile: IconUser,
		account: IconSettings,
		help: IconHelp,
		membership: IconStar
	};

	// No `features` any more: every flag the member nav consulted is retired.
	// `layout.features` still exists for the surfaces that read it directly.
	let navInput = $derived({
		hasLoanableEquipment: layout.hasLoanableEquipment
	});
	let mainItems = $derived(memberNavMain(navInput));
	let footerItems = $derived(memberNavFooter(navInput));

	let badges = $derived({
		messagesUnread: layout.messagesUnread
	} satisfies Record<MemberNavBadgeKey, number>);

	let activeKey = $derived(activeMemberNavKey(navInput, page.url.pathname));

	function badgeFor(item: MemberNavItem): number | undefined {
		return item.badgeKey ? badges[item.badgeKey] : undefined;
	}
</script>

{#snippet row(item: MemberNavItem)}
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

<AppShell drawerId="member-drawer" {panels} activePanel="member">
	{#snippet navigation()}
		{#each mainItems as item (item.key)}
			{@render row(item)}
		{/each}

		<!-- `persistKey` stays "my-bands": it addresses a value already sitting in
		     every member's localStorage, so renaming it would silently re-expand the
		     group for everyone who had collapsed it. -->
		<Nav.Group
			title="My Acts"
			collapsible
			persistKey="my-bands"
			persistScope="member"
			containsActive={page.url.pathname.startsWith('/band/')}
		>
			{#snippet action()}
				<Button href="/member/bands" variant="ghost" size="xs">All</Button>
			{/snippet}
			{#each layout.userBands as band (band.slug)}
				<Nav.Item href={`/band/${band.slug}`} label={band.name}>
					{#snippet icon()}
						<Avatar
							class="size-8"
							size="avatar-sm"
							src={band.avatarUrl ?? undefined}
							name={band.name}
						/>
					{/snippet}
				</Nav.Item>
			{/each}
			<Nav.Item href={resolve('/member/bands?create=1')} label="Create Act" data-sveltekit-reload>
				{#snippet icon()}<IconPlus />{/snippet}
			</Nav.Item>
		</Nav.Group>

		<!-- A second group rather than a merge. An act is a member's own project
		     with a panel; a club is a program with a page, and the two indexes
		     answer different questions. Absent rather than empty when you belong
		     to none, which is also the day-one shape: a member with no groups
		     should see no heading, not a heading over nothing. -->
		{#if layout.userGroups.length > 0}
			<Nav.Group
				title="My Groups"
				collapsible
				persistKey="my-groups"
				persistScope="member"
				containsActive={page.url.pathname.startsWith('/member/groups')}
			>
				{#snippet action()}
					<Button href="/member/groups" variant="ghost" size="xs">All</Button>
				{/snippet}
				{#each layout.userGroups as group (group.slug)}
					<Nav.Item href={`/member/groups/${group.slug}`} label={group.name}>
						{#snippet icon()}
							<Avatar
								class="size-8"
								size="avatar-sm"
								src={group.avatarUrl ?? undefined}
								name={group.name}
							/>
						{/snippet}
					</Nav.Item>
				{/each}
			</Nav.Group>
		{/if}

		<div class="flex grow"></div>

		{#each footerItems as item (item.key)}
			{@render row(item)}
		{/each}
	{/snippet}
	<ErrorToastBoundary>
		<EntityViewer
			panel="member"
			userId={layout.user.id}
			isStaff={layout.isStaff}
			capabilities={layout.capabilities}
			bands={layout.userBands}
		>
			{@render children()}
		</EntityViewer>
	</ErrorToastBoundary>
</AppShell>

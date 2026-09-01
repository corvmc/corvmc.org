<script lang="ts">
	import { page } from '$app/state';
	import {
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

	let navInput = $derived({
		features: layout.features,
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

		<Nav.Group
			title="My Bands"
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
			<Nav.Item href="/member/bands?create=1" label="Create Band" data-sveltekit-reload>
				{#snippet icon()}<IconPlus />{/snippet}
			</Nav.Item>
		</Nav.Group>

		<!-- The "My Groups" nav group used to live here, gated on the `groups`
		     feature flag. The flag is gone and the module is not launched, so the
		     nav entry is simply absent: /member/groups and the club pages work by
		     direct URL. Launching is putting this block back — see
		     docs/plans/feature-flag-retirement.md. -->

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
			bands={layout.userBands}
		>
			{@render children()}
		</EntityViewer>
	</ErrorToastBoundary>
</AppShell>

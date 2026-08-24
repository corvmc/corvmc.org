<script lang="ts">
	import { page } from '$app/state';
	import {
		IconLayoutDashboard,
		IconStar,
		IconCalendarEvent,
		IconAddressBook,
		IconPlus,
		IconHelp,
		IconMetronome,
		IconMessages,
		IconUser,
		IconSettings,
		IconHeartHandshake,
		IconBulb
	} from '@tabler/icons-svelte';
	import AppShell from '$lib/components/shared/AppShell.svelte';
	import Nav from '$lib/components/shared/Nav';
	import { childHrefsFor } from '$lib/components/shared/Nav/active-nav';
	import Avatar from '$lib/components/shared/Avatar.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import ErrorToastBoundary from '$lib/components/shared/ErrorToastBoundary.svelte';
	import { EntityViewer } from '$lib/components/shared/entity';
	import { getMemberLayout } from '$lib/remote/layout.remote';
	import { panelTabs } from '$lib/components/shared/panel-tabs';
	import {
		activeMemberNavKey,
		memberNavFooter,
		memberNavMain,
		type MemberNavBadgeKey,
		type MemberNavItem,
		type MemberNavKey
	} from './nav-items';

	let { children } = $props();

	let layout = $derived(await getMemberLayout());

	const panels = $derived(panelTabs(layout));

	const icons: Record<MemberNavKey, typeof IconLayoutDashboard> = {
		dashboard: IconLayoutDashboard,
		messages: IconMessages,
		reservations: IconMetronome,
		events: IconCalendarEvent,
		'events-submit': IconPlus,
		directory: IconAddressBook,
		volunteer: IconHeartHandshake,
		suggestions: IconBulb,
		profile: IconUser,
		account: IconSettings,
		help: IconHelp,
		membership: IconStar
	};

	let navInput = $derived({ features: layout.features });
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

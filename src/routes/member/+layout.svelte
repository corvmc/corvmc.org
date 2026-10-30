<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		IconLayoutDashboard,
		IconCalendarEvent,
		IconAddressBook,
		IconTool,
		IconPackage,
		IconPlus,
		IconSearch,
		IconHelp,
		IconMetronome,
		IconHeartHandshake,
		IconBulb,
		IconSpeakerphone,
		IconCheckbox
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
	import { navTrail } from '$lib/components/layout/nav-trail';
	import { setBreadcrumbTrail } from '$lib/components/ui/breadcrumbs';
	import { m } from '$lib/paraglide/messages.js';
	import { many } from '$lib/terms';
	import {
		activeMemberNavKey,
		memberNavFooter,
		memberNavGroupRows,
		memberNavItems,
		memberNavMain,
		type MemberNavItem,
		type SidebarNavKey
	} from './nav-items';

	let { children } = $props();

	// Before the await, not after: the `await` below suspends the script body, and `setContext`
	// has to run during synchronous init. See `layout-context.ts`.
	setMemberLayoutContext({
		get current() {
			return layout;
		}
	});

	// Before the await, like the context above; the getter reads `layout` only
	// once a page renders. A member's groups are sidebar rows too, so a group's
	// subpages trail through it.
	setBreadcrumbTrail({
		get current() {
			const groups = layout.userGroups.map((g) => ({
				key: `group:${g.slug}`,
				label: g.name,
				href: resolve('/member/groups/[slug]', { slug: g.slug })
			}));
			return navTrail(
				[{ items: memberNavItems(navInput) }, { title: 'My Groups', items: groups }],
				page.url.pathname
			);
		}
	});

	let layout = $derived(await getMemberLayout());

	const panels = $derived(panelTabs(layout));

	/**
	 * Only the rows the sidebar renders. Messages and the four member-context
	 * destinations are in `memberNavItems` so every `/member` page still
	 * resolves to a key, but the chrome draws them and owns their glyphs
	 * (#1244).
	 */
	const icons: Record<SidebarNavKey, typeof IconLayoutDashboard> = {
		dashboard: IconLayoutDashboard,
		reservations: IconMetronome,
		events: IconCalendarEvent,
		'events-submit': IconPlus,
		directory: IconAddressBook,
		classifieds: IconSpeakerphone,
		// Matches the staff panel's Inventory glyph, so the same thing looks the
		// same on both sides.
		equipment: IconTool,
		'equipment-loans': IconPackage,
		volunteer: IconHeartHandshake,
		suggestions: IconBulb,
		ballots: IconCheckbox,
		help: IconHelp
	};

	// No `features` any more: every flag the member nav consulted is retired.
	// `layout.features` still exists for the surfaces that read it directly.
	let navInput = $derived({
		hasLoanableEquipment: layout.hasLoanableEquipment
	});
	let mainItems = $derived(memberNavMain(navInput));
	let footerItems = $derived(memberNavFooter(navInput));

	let activeKey = $derived(activeMemberNavKey(navInput, page.url.pathname));

	const [browseBands] = memberNavGroupRows();
</script>

{#snippet row(item: MemberNavItem)}
	{@const Icon = icons[item.key as SidebarNavKey]}
	{#if item.children}
		<Nav.Collapsible
			href={item.href}
			label={item.label}
			childHrefs={childHrefsFor(item)}
			active={activeKey === item.key}
		>
			{#snippet icon()}<Icon />{/snippet}
			{#each item.children as child (child.key)}
				{@render row(child)}
			{/each}
		</Nav.Collapsible>
	{:else}
		<Nav.Item href={item.href} label={item.label} active={activeKey === item.key}>
			{#snippet icon()}<Icon />{/snippet}
		</Nav.Item>
	{/if}
{/snippet}

<AppShell drawerId="member-drawer" {panels} activePanel="member" chrome={layout.chrome}>
	{#snippet navigation()}
		{#each mainItems as item (item.key)}
			{@render row(item)}
		{/each}

		<!-- `persistKey` stays "my-bands": it addresses a value already sitting in
		     every member's localStorage, so renaming it would silently re-expand the
		     group for everyone who had collapsed it. -->
		<Nav.Group
			title={`My ${many(m.term_band)}`}
			collapsible
			persistKey="my-bands"
			persistScope="member"
			containsActive={page.url.pathname.startsWith('/band/') || activeKey === browseBands.key}
		>
			{#snippet action()}
				<Button
					href={resolve('/member/bands?create=1')}
					variant="ghost"
					size="xs"
					class="latched"
					aria-label={`New ${m.term_band({ count: 1 })}`}
					data-sveltekit-reload>New</Button
				>
			{/snippet}
			{#each layout.userBands as band (band.slug)}
				<Nav.Item href={`/band/${band.slug}`} label={band.name}>
					{#snippet icon()}
						<!-- Icon-sized and square: these rows sit among 20px glyphs, and a
						     32px circle lined up with none of them. -->
						<Avatar
							class="size-5"
							size="avatar-sm"
							shape="square"
							src={band.avatarUrl ?? undefined}
							name={band.name}
						/>
					{/snippet}
				</Nav.Item>
			{/each}
			<Nav.Item
				href={browseBands.href}
				label={browseBands.label}
				active={activeKey === browseBands.key}
			>
				{#snippet icon()}<IconSearch />{/snippet}
			</Nav.Item>
		</Nav.Group>

		<!-- A second group rather than a merge: a band is a member's own project
		     with a panel, a club is a program with a page. No New here, because
		     members cannot create clubs or committees. -->
		<Nav.Group
			title="My Groups"
			collapsible
			persistKey="my-groups"
			persistScope="member"
			containsActive={page.url.pathname.startsWith('/member/groups')}
		>
			{#each layout.userGroups as group (group.slug)}
				<Nav.Item href={`/member/groups/${group.slug}`} label={group.name}>
					{#snippet icon()}
						<Avatar
							class="size-5"
							size="avatar-sm"
							shape="square"
							src={group.avatarUrl ?? undefined}
							name={group.name}
						/>
					{/snippet}
				</Nav.Item>
			{/each}
			<Nav.Item href={resolve('/member/groups')} label="Browse Groups">
				{#snippet icon()}<IconSearch />{/snippet}
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
			capabilities={layout.capabilities}
			bands={layout.userBands}
		>
			{@render children()}
		</EntityViewer>
	</ErrorToastBoundary>
</AppShell>

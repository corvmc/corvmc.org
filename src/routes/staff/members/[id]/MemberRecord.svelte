<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { getUserPage } from '$lib/remote/users.remote';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { TAB_LABELS, type TabKey } from './tabs';
	import UserScoreboard from './panels/UserScoreboard.svelte';
	import OverviewPanel from './panels/OverviewPanel.svelte';
	import SpacePanel from './panels/SpacePanel.svelte';
	import BandsPanel from './panels/BandsPanel.svelte';
	import VolunteerPanel from './panels/VolunteerPanel.svelte';
	import InstructorPanel from './panels/InstructorPanel.svelte';
	import MoneyPanel from './panels/MoneyPanel.svelte';
	import CommsPanel from './panels/CommsPanel.svelte';
	import ModerationPanel from './panels/ModerationPanel.svelte';
	import AccountPanel from './panels/AccountPanel.svelte';

	/**
	 * The whole staff record of one member: the full page, and the side panel on
	 * the Members views. `tab` is the caller's to mirror into the URL or not.
	 * `panel` drops the page frame for an identity row carrying `actions`.
	 */
	let {
		id,
		tab = $bindable('overview'),
		variant = 'page',
		actions
	}: {
		id: string;
		tab?: TabKey;
		variant?: 'page' | 'panel';
		actions?: Snippet;
	} = $props();

	// Keep-alive. A plain {#if} would unmount the Account panel on tab change and
	// silently discard a half-typed edit — Form's `guard` only fires on
	// navigation, and switching tabs is not one. Mounting on first visit and
	// hiding thereafter also means each panel's queries run exactly once.
	// Declared above the await so it is not async-gated.
	const visited = new SvelteSet<TabKey>([untrack(() => tab)]);
	$effect(() => {
		visited.add(tab);
	});

	let tabBarEl = $state<HTMLElement | null>(null);

	// The record's one load-bearing query: the member and the overview that backs
	// the identity badges, the scoreboard, every tab badge and the Overview tab.
	let { member, overview } = $derived(await getUserPage(id));

	// Jumping from an attention item scrolls back to the tab bar, which on a phone
	// is most of a screen above where the item was.
	function jump(next: TabKey) {
		tab = next;
		tabBarEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	// Badges mean one thing: something here wants a staff member, not a size.
	const badge = (n: number) => (n > 0 ? n : undefined);

	const attentionCount = $derived(
		[
			!!member.deletedAt,
			overview.standings.community_event.status !== 'none',
			overview.standings.suggestion.status !== 'none',
			overview.counts.openFlagsAgainst > 0,
			overview.counts.overdueLoans > 0,
			overview.counts.unpaidReservations > 0,
			overview.counts.pendingHourLogs > 0,
			overview.counts.certsNeedingAttention > 0,
			overview.volunteer.stage === 'blocked',
			overview.membership.cancelAtPeriodEnd,
			overview.marketing.suppressed,
			overview.counts.unreadThreads > 0,
			overview.counts.pendingBandInvites > 0
		].filter(Boolean).length
	);

	const tabs = $derived([
		{ key: 'overview', label: TAB_LABELS.overview, badge: badge(attentionCount) },
		{ key: 'space', label: TAB_LABELS.space },
		{ key: 'bands', label: TAB_LABELS.bands, badge: badge(overview.counts.pendingBandInvites) },
		{
			key: 'volunteer',
			label: TAB_LABELS.volunteer,
			badge: badge(overview.counts.pendingHourLogs)
		},
		{ key: 'instructor', label: TAB_LABELS.instructor },
		{ key: 'money', label: TAB_LABELS.money },
		{ key: 'comms', label: TAB_LABELS.comms, badge: badge(overview.counts.unreadThreads) },
		{
			key: 'moderation',
			label: TAB_LABELS.moderation,
			badge: badge(overview.counts.openFlagsAgainst)
		},
		{ key: 'account', label: TAB_LABELS.account }
	]);

	const activeBands = $derived(overview.bands.filter((b) => b.status === 'active'));
</script>

{#snippet identityBadges()}
	{#if member.deletedAt}
		<Badge variant="error" size="md">Deactivated</Badge>
	{/if}
	{#if overview.membership.sustaining}
		<Badge variant="success" size="md">Sustaining</Badge>
	{/if}
	{#each member.roles as role (role)}
		<Badge variant="info" size="md">{role}</Badge>
	{/each}
{/snippet}

{#snippet body()}
	<div class="flex flex-wrap gap-x-3 gap-y-1 text-muted">
		<a class="link" href="mailto:{member.email}">{member.email}</a>
		{#if member.phone}
			<a class="link" href="tel:{member.phone}">{member.phone}</a>
		{/if}
		{#if member.pronouns}
			<span>{member.pronouns}</span>
		{/if}
		{#if member.memberNumber}
			<span>#{member.memberNumber}</span>
		{/if}
	</div>

	{#if overview.bands.length > 0}
		<div class="flex flex-wrap items-center gap-1">
			{#each activeBands as b (b.id)}
				<a href={resolve(`/staff/bands/${b.id}`)}>
					<Badge size="sm">{b.name}</Badge>
				</a>
			{/each}
			{#if overview.counts.pendingBandInvites > 0}
				<Badge size="sm" variant="warning">
					{overview.counts.pendingBandInvites} invite{overview.counts.pendingBandInvites === 1
						? ''
						: 's'} pending
				</Badge>
			{/if}
		</div>
	{/if}

	<UserScoreboard {overview} />

	<div bind:this={tabBarEl}>
		<TabBar {tabs} active={tab} collapse onchange={(key) => (tab = key as TabKey)} />
	</div>

	{#snippet tabPanel(key: TabKey, content: Snippet)}
		{#if visited.has(key)}
			<div role="tabpanel" aria-labelledby="tab-{key}" class="space-y-6" class:hidden={tab !== key}>
				{@render content()}
			</div>
		{/if}
	{/snippet}

	{#snippet overviewTab()}<OverviewPanel {overview} {member} onjump={jump} />{/snippet}
	{#snippet spaceTab()}<SpacePanel {id} />{/snippet}
	{#snippet bandsTab()}<BandsPanel {id} />{/snippet}
	{#snippet volunteerTab()}<VolunteerPanel {id} />{/snippet}
	{#snippet instructorTab()}<InstructorPanel {id} name={member.name} />{/snippet}
	{#snippet moneyTab()}<MoneyPanel {id} />{/snippet}
	{#snippet commsTab()}<CommsPanel {id} email={member.email} />{/snippet}
	{#snippet moderationTab()}<ModerationPanel {id} />{/snippet}
	{#snippet accountTab()}<AccountPanel {id} {member} />{/snippet}

	{@render tabPanel('overview', overviewTab)}
	{@render tabPanel('space', spaceTab)}
	{@render tabPanel('bands', bandsTab)}
	{@render tabPanel('volunteer', volunteerTab)}
	{@render tabPanel('instructor', instructorTab)}
	{@render tabPanel('money', moneyTab)}
	{@render tabPanel('comms', commsTab)}
	{@render tabPanel('moderation', moderationTab)}
	{@render tabPanel('account', accountTab)}
{/snippet}

{#if variant === 'page'}
	<PageHeader subtitle="Member" title={member.name}>
		{#snippet leading()}
			<Avatar src={member.avatarUrl ?? undefined} name={member.name} class="size-12" />
		{/snippet}
		{@render identityBadges()}
	</PageHeader>

	<PageContent width="full">
		{@render body()}
	</PageContent>
{:else}
	<!-- Its own container, so the tables' column tiers track the panel's width. -->
	<div class="@container space-y-6">
		<div class="flex flex-wrap items-center gap-2">
			<Avatar src={member.avatarUrl ?? undefined} name={member.name} class="size-10" />
			{@render identityBadges()}
			<span class="ms-auto">{@render actions?.()}</span>
		</div>
		{@render body()}
	</div>
{/if}

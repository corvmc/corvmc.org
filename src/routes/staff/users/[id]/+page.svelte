<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import { getUser, getUserOverview } from '$lib/remote/users.remote';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import TabBar from '$lib/components/shared/TabBar.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Avatar from '$lib/components/shared/Avatar.svelte';
	import { TAB_LABELS, parseTab, type TabKey } from './tabs';
	import UserScoreboard from './panels/UserScoreboard.svelte';
	import OverviewPanel from './panels/OverviewPanel.svelte';
	import SpacePanel from './panels/SpacePanel.svelte';
	import BandsPanel from './panels/BandsPanel.svelte';
	import VolunteerPanel from './panels/VolunteerPanel.svelte';
	import MoneyPanel from './panels/MoneyPanel.svelte';
	import CommsPanel from './panels/CommsPanel.svelte';
	import ModerationPanel from './panels/ModerationPanel.svelte';
	import AccountPanel from './panels/AccountPanel.svelte';

	let id = $derived(page.params.id!);

	// The only two queries the page itself makes. `getUserOverview` is what pays
	// for the tabs: it backs the identity badges, the scoreboard, every tab
	// badge and the whole Overview tab, so the default view of a member costs
	// two requests instead of the twenty an untabbed version of this page would.
	let [member, overview] = $derived(await Promise.all([getUser(id), getUserOverview(id)]));

	// Seeded from the query string and mirrored back into it, so a staff member
	// can hand someone a link to the tab they are talking about. Local state
	// rather than reading `page.url` directly, so a click re-renders immediately
	// instead of waiting on the navigation that records it.
	const initialTab = parseTab(page.url.searchParams.get('tab'));
	let tab = $state<TabKey>(initialTab);

	// Keep-alive. A plain {#if} would unmount the Account panel on tab change and
	// silently discard a half-typed edit — Form's `guard` only fires on
	// navigation, and switching tabs is not one. Mounting on first visit and
	// hiding thereafter also means each panel's queries run exactly once.
	const visited = new SvelteSet<TabKey>([initialTab]);
	$effect(() => {
		visited.add(tab);
	});

	// Writes the URL, never state — `tab` above stays the source of truth.
	//
	// `replaceState` (shallow routing) rather than `goto(..., { replaceState })`,
	// which is what the filter bars on the list pages use. A tab change is not a
	// navigation, but `goto` is one, and `FormGuard` hooks `beforeNavigate`: with
	// the Account form dirty, every tab click cancelled the navigation and popped
	// "You have unsaved changes", whose <dialog> then swallowed pointer events for
	// the whole page. Shallow routing rewrites the address bar without running
	// beforeNavigate or any load, which is exactly what mirroring local state
	// wants. The address bar is all this needs to reach: `tab` is read back out of
	// `page.url` only on mount, so a reload or a copied link still lands right.
	$effect(() => {
		const href = `${resolve(`/staff/users/${id}`)}${tab === 'overview' ? '' : `?tab=${tab}`}`;
		if (location.pathname + location.search !== href) {
			replaceState(href, {});
		}
	});

	// Jumping from an attention item used to flip the tab and leave you wherever
	// you had scrolled to, which on a phone is most of a screen below the top of
	// the panel you just asked for. The scroller is <main>, not the window.
	let tabBarEl = $state<HTMLElement | null>(null);

	function jump(next: TabKey) {
		tab = next;
		tabBarEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	// Badges mean one thing: something here wants a staff member. A count of
	// upcoming bookings or of bands is a size, not a task, and rendering it in the
	// same token as "3 unresolved reports" made the token say nothing at all.
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

<!--
	One identity block, not two. The avatar rides in the header rather than in a
	strip below it, because the strip's only reason to restate the name was to
	have something to put beside the picture.
-->
<PageHeader subtitle="Member" title={member.name} backHref="/staff/users">
	{#snippet leading()}
		<Avatar src={member.avatarUrl ?? undefined} name={member.name} class="size-12" />
	{/snippet}
	{#if member.deletedAt}
		<Badge variant="error" size="md">Deactivated</Badge>
	{/if}
	{#if overview.membership.sustaining}
		<Badge variant="success" size="md">Sustaining</Badge>
	{/if}
	{#each member.roles as role (role)}
		<Badge variant="info" size="md">{role}</Badge>
	{/each}
</PageHeader>

<PageContent width="full">
	<!--
		What is left once the header has the name: the things you would act on, and
		the bands, which are worth more as names you can click than as a number.
	-->
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

	{#if visited.has('overview')}
		<div
			role="tabpanel"
			aria-labelledby="tab-overview"
			class="space-y-6"
			class:hidden={tab !== 'overview'}
		>
			<OverviewPanel {overview} {member} onjump={jump} />
		</div>
	{/if}
	{#if visited.has('space')}
		<div
			role="tabpanel"
			aria-labelledby="tab-space"
			class="space-y-6"
			class:hidden={tab !== 'space'}
		>
			<SpacePanel {id} />
		</div>
	{/if}
	{#if visited.has('bands')}
		<div
			role="tabpanel"
			aria-labelledby="tab-bands"
			class="space-y-6"
			class:hidden={tab !== 'bands'}
		>
			<BandsPanel {id} />
		</div>
	{/if}
	{#if visited.has('volunteer')}
		<div
			role="tabpanel"
			aria-labelledby="tab-volunteer"
			class="space-y-6"
			class:hidden={tab !== 'volunteer'}
		>
			<VolunteerPanel {id} />
		</div>
	{/if}
	{#if visited.has('money')}
		<div
			role="tabpanel"
			aria-labelledby="tab-money"
			class="space-y-6"
			class:hidden={tab !== 'money'}
		>
			<MoneyPanel {id} />
		</div>
	{/if}
	{#if visited.has('comms')}
		<div
			role="tabpanel"
			aria-labelledby="tab-comms"
			class="space-y-6"
			class:hidden={tab !== 'comms'}
		>
			<CommsPanel {id} email={member.email} />
		</div>
	{/if}
	{#if visited.has('moderation')}
		<div
			role="tabpanel"
			aria-labelledby="tab-moderation"
			class="space-y-6"
			class:hidden={tab !== 'moderation'}
		>
			<ModerationPanel {id} />
		</div>
	{/if}
	{#if visited.has('account')}
		<div
			role="tabpanel"
			aria-labelledby="tab-account"
			class="space-y-6"
			class:hidden={tab !== 'account'}
		>
			<AccountPanel {id} {member} />
		</div>
	{/if}
</PageContent>

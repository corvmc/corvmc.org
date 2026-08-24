<script lang="ts">
	import type { getUserOverview } from '$lib/remote/users.remote';
	import type { TabKey } from '../tabs';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';
	import { formatDateShortYear, formatDateTimeShort } from '$lib/utils/format';
	import { standingScopeConfig } from '$lib/config';

	let {
		overview,
		member,
		onjump
	}: {
		overview: Awaited<ReturnType<typeof getUserOverview>>;
		member: {
			createdAt: Date;
			deletedAt: Date | null;
		};
		onjump: (tab: TabKey) => void;
	} = $props();

	// Every item is derived from the one overview query, so this tab issues no
	// requests of its own. That is deliberate: Overview is the default tab, and
	// a default tab that fans out to a dozen endpoints would undo the whole
	// reason the page is tabbed.
	type Attention = { text: string; tab: TabKey; tone: 'error' | 'warning' };

	const attention = $derived.by<Attention[]>(() => {
		const c = overview.counts;
		const items: Attention[] = [];

		if (member.deletedAt) {
			items.push({
				text: 'This account is deactivated. Their future bookings were cancelled when it happened, and reactivating does not bring them back.',
				tab: 'account',
				tone: 'error'
			});
		}
		// One line per restricted scope, in a fixed order so the list doesn't
		// reshuffle between members.
		for (const scope of ['community_event', 'suggestion'] as const) {
			const standing = overview.standings[scope];
			if (standing.status === 'none') continue;
			items.push({
				text: `${standingScopeConfig[scope].label} are held for review${standing.reason ? ` — ${standing.reason}` : ''}.`,
				tab: 'moderation',
				tone: 'warning'
			});
		}
		if (c.openFlagsAgainst > 0) {
			items.push({
				text: `${c.openFlagsAgainst} unresolved report${c.openFlagsAgainst === 1 ? '' : 's'} against this member.`,
				tab: 'moderation',
				tone: 'error'
			});
		}
		if (c.overdueLoans > 0) {
			items.push({
				text: `${c.overdueLoans} overdue equipment loan${c.overdueLoans === 1 ? '' : 's'}.`,
				tab: 'space',
				tone: 'error'
			});
		}
		if (c.unpaidReservations > 0) {
			items.push({
				text: `${c.unpaidReservations} booking${c.unpaidReservations === 1 ? '' : 's'} with cash still owed.`,
				tab: 'space',
				tone: 'warning'
			});
		}
		if (c.pendingHourLogs > 0) {
			items.push({
				text: `${c.pendingHourLogs} volunteer hour log${c.pendingHourLogs === 1 ? '' : 's'} waiting on review.`,
				tab: 'volunteer',
				tone: 'warning'
			});
		}
		if (c.certsNeedingAttention > 0) {
			items.push({
				text: `${c.certsNeedingAttention} clearance${c.certsNeedingAttention === 1 ? '' : 's'} expired or expiring.`,
				tab: 'volunteer',
				tone: 'warning'
			});
		}
		if (overview.volunteer.stage === 'blocked') {
			items.push({
				text: 'Volunteer signup is blocked pending guardian approval.',
				tab: 'volunteer',
				tone: 'warning'
			});
		}
		if (overview.membership.cancelAtPeriodEnd) {
			items.push({
				text: 'Membership is set to cancel at the end of the current period.',
				tab: 'money',
				tone: 'warning'
			});
		}
		if (overview.marketing.suppressed) {
			items.push({
				text: `Email is suppressed${overview.marketing.suppressionReason ? ` (${overview.marketing.suppressionReason})` : ''} — club mail is not reaching them.`,
				tab: 'comms',
				tone: 'warning'
			});
		}
		if (c.unreadThreads > 0) {
			items.push({
				text: `${c.unreadThreads} unread message${c.unreadThreads === 1 ? '' : 's'} in their portal inbox.`,
				tab: 'comms',
				tone: 'warning'
			});
		}
		if (c.pendingBandInvites > 0) {
			items.push({
				text: `${c.pendingBandInvites} band invitation${c.pendingBandInvites === 1 ? '' : 's'} never accepted.`,
				tab: 'bands',
				tone: 'warning'
			});
		}
		return items;
	});
</script>

<!--
	There used to be a third card here: a twelve-tile "Programs" grid stating the
	size of every domain and jumping to the tab that held it. It was a table of
	contents for a tab bar sitting one row above it, and every tile restated a
	number the destination tab shows in full. Cutting it also orphaned ten counts
	in `getUserOverview`, which is why the first paint of this page got cheaper by
	deleting a card that cost nothing to render.

	What is left is the pair that Overview is actually for: what wants doing, and
	who this is.
-->
{#if attention.length > 0}
	<InfoCard title="Needs attention">
		<ul class="flex flex-col gap-2">
			{#each attention as item (item.text)}
				<li>
					<button
						type="button"
						class="flex w-full items-start gap-2 rounded-box px-2 py-1.5 text-left hover:bg-base-200"
						onclick={() => onjump(item.tab)}
					>
						<Badge variant={item.tone} size="sm" class="mt-0.5 shrink-0">
							{item.tone === 'error' ? '!' : '•'}
						</Badge>
						<span class="text-sm">{item.text}</span>
					</button>
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}

<!--
	Roles, member number and a sustaining membership are all badges in the header
	already; repeating them here as rows was the same duplication the identity
	strip had, one card down. What stays is what the header has no room to say.
-->
<InfoCard title="At a glance">
	<DefinitionList>
		<Fact label="Joined">{formatDateShortYear(member.createdAt)}</Fact>

		<Fact label="Last sign-in">
			{#if overview.lastLoginAt}
				{formatDateTimeShort(overview.lastLoginAt)}
			{:else}
				<span class="opacity-60">Never, or signed out everywhere</span>
			{/if}
		</Fact>

		<!-- Sustaining is a header badge; the free tier has no badge, so it says so. -->
		<Fact label="Membership">
			{#if overview.membership.sustaining}
				{overview.membership.hoursPerReset
					? `${overview.membership.hoursPerReset / 2} hrs a month`
					: 'Sustaining'}
			{:else}
				Free tier
			{/if}
		</Fact>

		<Fact label="Directory">
			{overview.directory.visibility}
			{#if !overview.directory.profileComplete}
				<span class="opacity-60"> · profile incomplete</span>
			{/if}
		</Fact>
	</DefinitionList>
</InfoCard>

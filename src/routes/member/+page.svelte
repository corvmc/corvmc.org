<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import { EntityCard } from '$lib/components/ui/entity';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import BookerTypeIcon from '$lib/components/reservations/BookerTypeIcon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { formatDate, formatTimeRange, formatDuration } from '$lib/utils/format';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import { getMemberDashboard } from '$lib/remote/users.remote';
	import { ReportBuildingProblemAction } from '$lib/components/actions';
	import MatchesCard from './MatchesCard.svelte';
	import NeedsYouCard from './NeedsYouCard.svelte';
	import { creditsToHours } from '$lib/config';
	import { resolve } from '$app/paths';

	let data = $derived(await getMemberDashboard());

	const isSustaining = $derived(data.subscription != null && !data.subscription.cancelAtPeriodEnd);
	// Credits are stored as 30-min blocks; display practice time in hours.
	const freeHours = $derived(creditsToHours(data.credits.free_hours ?? 0));
	const usedHours = $derived(creditsToHours(data.usedThisMonth));
	const allocatedHours = $derived(creditsToHours(data.allocatedThisMonth));
</script>

<PageHeader title="Dashboard">
	<ReportBuildingProblemAction />
</PageHeader>
<PageContent>
	<!-- Everything that has a clock on it, soonest first. The invitations alert,
	     the profile nudge and the unconfirmed-booking warnings were three
	     regions of this page; the quick links below them were the sidebar
	     again (#1245). -->
	<NeedsYouCard items={data.needsYou} />

	<!-- Reservations + Credits grid -->
	<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
		<!-- This week's reservations -->
		<div class="lg:col-span-2">
			<InfoCard title="This Week">
				{#if data.weekReservations.length === 0}
					<EmptyState
						message="No sessions booked this week."
						actionLabel="Book a session"
						actionHref="/member/reservations"
					/>
				{:else}
					<div class="space-y-2">
						{#each data.weekReservations as res (res.id)}
							<div class="flex items-center justify-between inset px-3 py-2">
								<div class="flex items-center gap-3">
									<BookerTypeIcon type={res.bookerType} size={18} class="opacity-60" />
									<div>
										<p class="text-sm font-medium">
											{formatDate(res.startsAt)}
											{#if res.bandName}
												<span class="opacity-60">· {res.bandName}</span>
											{/if}
										</p>
										<p class="text-subtle">
											{formatTimeRange(res.startsAt, res.endsAt)} · {formatDuration(
												res.startsAt,
												res.endsAt
											)}
										</p>
									</div>
								</div>
								<StatusBadge status={res.status} />
							</div>
						{/each}
					</div>
				{/if}
			</InfoCard>
		</div>

		<!-- Credit balance -->
		<InfoCard title="Practice Credits">
			{#if isSustaining}
				<div class="space-y-3">
					<p class="text-3xl font-medium">
						{freeHours}<span class="text-base opacity-60"> hrs left</span>
					</p>
					<progress
						class="progress w-full progress-primary"
						value={data.usedThisMonth}
						max={data.allocatedThisMonth || 1}
					></progress>
					<p class="text-subtle">
						{usedHours} of {allocatedHours} hours used this month
					</p>
				</div>
			{:else}
				<div class="space-y-3">
					<p class="text-muted">
						Become a sustaining member to get free practice hours each month.
					</p>
					<Button href="/member/membership" variant="default" size="sm">Learn More</Button>
				</div>
			{/if}
		</InfoCard>
	</div>

	<!-- Who to meet, from `directory_entry.lookingFor` — the question we already
	     ask every member and, until this card, did nothing with. -->
	<MatchesCard matches={data.matches} />

	<!-- Upcoming events -->
	<InfoCard title="Upcoming Events">
		{#if data.upcomingEvents.length === 0}
			<EmptyState
				message="No events on the horizon."
				actionLabel="Browse events"
				actionHref="/member/events"
			/>
		{:else}
			<!-- `EntityCard`, whose own comment states the rule this grid broke:
			     the portrait is keyed off the shape, not off whether an image
			     loaded, so an event with no artwork is still a full-height tile
			     and the row stays even (#1047). It also crops 2:3 like every
			     other poster rather than letterboxing to h-32. -->
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{#each data.upcomingEvents as evt (evt.id)}
					<a href={resolve(`/member/events/${evt.id}`)} class="block">
						<EntityCard ref={evt.ref} class="h-full transition-shadow hover:shadow-md">
							<p class="text-subtle">{formatDate(evt.startsAt)}</p>
						</EntityCard>
					</a>
				{/each}
			</div>
		{/if}
	</InfoCard>
</PageContent>

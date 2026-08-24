<script lang="ts">
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import BookerTypeIcon from '$lib/components/shared/reservations/BookerTypeIcon.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import { formatDate, formatTimeRange, formatDuration } from '$lib/utils/format';
	import { IconCalendarPlus, IconCalendarEvent, IconStar } from '@tabler/icons-svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import { getMemberDashboard } from '$lib/remote/users.remote';
	import { creditsToHours } from '$lib/config';
	import { resolve } from '$app/paths';
	import { imageSrc } from '$lib/utils/images';

	let data = $derived(await getMemberDashboard());

	const isSustaining = $derived(data.subscription != null && !data.subscription.cancelAtPeriodEnd);
	// Credits are stored as 30-min blocks; display practice time in hours.
	const freeHours = $derived(creditsToHours(data.credits.free_hours ?? 0));
	const usedHours = $derived(creditsToHours(data.usedThisMonth));
	const allocatedHours = $derived(creditsToHours(data.allocatedThisMonth));
	const pendingInvites = $derived(data.pendingInviteCount ?? 0);
</script>

<PageHeader title="Dashboard" />
<PageContent>
	{#if pendingInvites > 0}
		<Alert type="info" href="/member/bands" class="shadow-sm">
			You have {pendingInvites} pending band invitation{pendingInvites === 1 ? '' : 's'}.
		</Alert>
	{/if}

	<!-- Resolves itself the moment the profile has anything on it, so it needs no
	     dismiss control and can't be permanently silenced by accident. States the
	     consequence rather than issuing an instruction, and never blocks the page. -->
	{#if !data.profileComplete}
		<Alert type="info" href="/member/profile" class="shadow-sm">
			Add your instruments or a short bio so other members can find you in the directory.
		</Alert>
	{/if}

	<!-- Quick links -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<Button href="/member/reservations" variant="default" class="card bg-base-100 h-auto">
			<CardBody class="flex-row items-center gap-3 py-4">
				<IconCalendarPlus size={24} class="text-primary" />
				<span class="font-medium">Book a Session</span>
			</CardBody>
		</Button>
		<Button href="/member/events" variant="default" class="card bg-base-100 h-auto">
			<CardBody class="flex-row items-center gap-3 py-4">
				<IconCalendarEvent size={24} class="text-primary" />
				<span class="font-medium">Browse Events</span>
			</CardBody>
		</Button>
		<Button href="/member/membership" variant="default" class="card bg-base-100 h-auto">
			<CardBody class="flex-row items-center gap-3 py-4">
				<IconStar size={24} class="text-primary" />
				<span class="font-medium">Manage Membership</span>
			</CardBody>
		</Button>
	</div>

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
							<div class="flex items-center justify-between rounded-lg bg-base-200 px-3 py-2">
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

	<!-- Upcoming events -->
	<InfoCard title="Upcoming Events">
		{#if data.upcomingEvents.length === 0}
			<EmptyState
				message="No events on the horizon."
				actionLabel="Browse events"
				actionHref="/member/events"
			/>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{#each data.upcomingEvents as evt (evt.id)}
					<a
						href={resolve(`/member/events/${evt.id}`)}
						class="card bg-base-200 transition-shadow hover:shadow-md"
					>
						{#if evt.posterUrl}
							{@const poster = imageSrc(evt.posterUrl, 'poster')}
							<figure>
								<img
									src={poster.src}
									srcset={poster.srcset}
									sizes={poster.sizes}
									alt={evt.title}
									class="h-32 w-full object-cover"
								/>
							</figure>
						{/if}
						<CardBody class="p-3">
							<p class="text-sm font-medium">{evt.title}</p>
							<p class="text-subtle">{formatDate(evt.startsAt)}</p>
						</CardBody>
					</a>
				{/each}
			</div>
		{/if}
	</InfoCard>
</PageContent>

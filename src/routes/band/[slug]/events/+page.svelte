<script lang="ts">
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import BadgeList from '$lib/components/ui/BadgeList.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import Button from '$lib/components/ui/Button.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import ImportGigsModal from './ImportGigsModal.svelte';
	import CreateEventModal from './CreateEventModal.svelte';
	import { formatDate, formatTime } from '$lib/utils/format';
	import { describeTerms } from '$lib/production/terms';
	import { formatEventTimeRange } from '$lib/utils/event-time';
	import {
		getBandEventsPage,
		confirmLineupSlotForm,
		declineLineupSlotForm
	} from '$lib/remote/band-events.remote';
	import { getBandLayoutContext } from '../layout-context';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	// The layout above already holds this; re-awaiting it here was a second remote query
	// in flight in this component. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	const { events, invites, bookings } = $derived(await getBandEventsPage(page.params.slug!));
	const band = $derived(layout.band);
	const isAdmin = $derived(layout.userRole === 'owner' || layout.userRole === 'admin');

	let importing = $state(false);

	/** Other acts on the bill. Clamped by `BadgeList`: a five-act bill was a paragraph. */
	function supportNames(lineup: { name: string; bandId: string | null }[]): string[] {
		return lineup.filter((l) => l.bandId !== band.id).map((l) => l.name);
	}
</script>

<!-- Unclamped: the column tiers are container queries, and `2xl` is 672px —
     narrower than `col-extra`'s 768px, so a clamped page renders its widest
     tier set in the narrowest container the app allows (ui-patterns, #1216). -->
<PageHeader title="Events" subtitle={band.name}>
	{#if isAdmin}
		<Button variant="ghost" size="sm" onclick={() => (importing = true)}>Import past gigs</Button>
		<CreateEventModal bandId={band.id} bandSlug={band.slug} bandName={band.name} />
	{/if}
</PageHeader>
<PageContent>
	<!-- Bills this band was named on but hasn't answered. Until it confirms,
	     the show is on the other band's listing only — never on this profile. -->
	{#if invites.length > 0}
		<div class="mb-6 space-y-3">
			<h2 class="text-muted font-semibold uppercase">Invitations</h2>
			{#each invites as invite (invite.eventId)}
				<!-- One form object can only back a single <form>, so each invite gets
				     its own instance with its own pending state. -->
				{@const confirm = confirmLineupSlotForm.for(invite.eventId)}
				{@const decline = declineLineupSlotForm.for(invite.eventId)}
				<div class="card border border-warning/40 bg-warning/10">
					<CardBody row class="gap-4 py-4">
						<div>
							<p class="font-medium">{invite.eventTitle}</p>
							<p class="text-muted">
								{formatDate(invite.startsAt)}{invite.location ? ` · ${invite.location}` : ''}
							</p>
							<p class="text-subtle">
								Added by {invite.ownerBandName ?? 'CMC staff'}
							</p>
						</div>
						{#if isAdmin}
							<div class="flex shrink-0 gap-2">
								<Form
									remote={confirm}
									successToast="Added to your profile"
									onsuccess={() => invalidateAll()}
									class="inline"
								>
									<input {...confirm.fields.slug.as('hidden', band.slug)} />
									<input {...confirm.fields.eventId.as('hidden', invite.eventId)} />
									<SubmitButton label="Confirm" variant="primary" size="sm" />
								</Form>
								<Form
									remote={decline}
									successToast="Declined"
									onsuccess={() => invalidateAll()}
									class="inline"
								>
									<input {...decline.fields.slug.as('hidden', band.slug)} />
									<input {...decline.fields.eventId.as('hidden', invite.eventId)} />
									<SubmitButton label="Decline" variant="ghost" size="sm" />
								</Form>
							</div>
						{/if}
					</CardBody>
				</div>
			{/each}
		</div>
	{/if}

	<!--
		The deal, before the show rather than after it. Read-only: an act cannot
		accept or edit anything here, and it sees only its own terms — never another
		act's, and never a whole-show total.
	-->
	{#if bookings.length > 0}
		<div class="mb-6 space-y-3">
			<h2 class="text-muted font-semibold uppercase">Bookings</h2>
			<!-- A table: read-only with no actions at all, and the call times were a
			     run-on line of up to four conditional facts (#1048). -->
			<Table>
				{#snippet head()}
					<th class="cell-primary">Show</th>
					<th class="col-support whitespace-nowrap">On at</th>
					<th class="col-extra whitespace-nowrap">Call times</th>
					<th class="whitespace-nowrap">Terms</th>
				{/snippet}

				{#each bookings as booking (booking.eventId)}
					<tr class="hover">
						<td class="cell-primary">
							<div class="truncate font-medium">{booking.eventTitle}</div>
							<div class="text-subtle">
								{formatDate(booking.startsAt)}{booking.location ? ` · ${booking.location}` : ''}
							</div>
						</td>
						<td class="col-support whitespace-nowrap">
							{#if booking.scheduledStartAt}
								{formatTime(booking.scheduledStartAt)}
							{:else}
								<span class="text-subtle">—</span>
							{/if}
							<div class="text-subtle">{booking.setLengthMinutes} min</div>
						</td>
						<td class="col-extra text-subtle">
							{#if booking.soundcheckAt}
								<div>soundcheck {formatTime(booking.soundcheckAt)}</div>
							{/if}
							{#if booking.loadInAt}
								<div>load-in {formatTime(booking.loadInAt)}</div>
							{/if}
							{#if booking.curfewAt}
								<div>curfew {formatTime(booking.curfewAt)}</div>
							{/if}
						</td>
						<td class="whitespace-nowrap">{describeTerms(booking.terms)}</td>
					</tr>
				{/each}
			</Table>
		</div>
	{/if}

	{#if events.length === 0}
		<EmptyState>
			<p>No events yet</p>
			{#if isAdmin}
				<div class="mt-2">
					<CreateEventModal bandId={band.id} bandSlug={band.slug} bandName={band.name} />
				</div>
			{/if}
		</EmptyState>
	{:else}
		<!--
			A table: zero always-visible actions and no prose, which is none of the
			four tests a card has to pass. The two conditional facts — location and
			the rest of the bill — set the card's height, so the stack went ragged
			between events that had both, one or neither (#1048).
		-->
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th class="cell-primary">Event</th>
				<th class="col-support">Where</th>
				<th class="col-extra">On the bill</th>
			{/snippet}

			{#each events as evt (evt.id)}
				<tr
					class="hover cursor-pointer"
					use:rowLink={resolve(`/band/${band.slug}/events/${evt.id}`)}
				>
					<td class="w-px whitespace-nowrap">
						<StatusBadge status={evt.status} />
						{#if !evt.isOwner}
							<Badge variant="ghost" size="xs">guest</Badge>
						{/if}
					</td>
					<td class="cell-primary">
						<div class="truncate font-medium">{evt.title}</div>
						<div class="text-subtle">
							{formatDate(evt.startsAt)} &middot; {formatEventTimeRange(evt.startsAt, evt.endsAt)}
						</div>
					</td>
					<td class="col-support truncate">{evt.location ?? '—'}</td>
					<td class="col-extra">
						{#if supportNames(evt.lineup).length}
							<BadgeList items={supportNames(evt.lineup)} max={2} />
						{:else}
							<span class="text-subtle">—</span>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>

<ImportGigsModal slug={band.slug} bind:open={importing} />

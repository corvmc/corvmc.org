<script lang="ts">
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import ImportGigsModal from './ImportGigsModal.svelte';
	import CreateEventModal from './CreateEventModal.svelte';
	import { formatDate } from '$lib/utils/format';
	import { formatEventTimeRange } from '$lib/utils/event-time';
	import {
		getBandEvents,
		getBandLineupInvites,
		confirmLineupSlotForm,
		declineLineupSlotForm
	} from '$lib/remote/band-events.remote';
	import { getBandLayout } from '$lib/remote/layout.remote';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let layout = $derived(await getBandLayout(page.params.slug!));
	let events = $derived(await getBandEvents(page.params.slug!));
	let invites = $derived(await getBandLineupInvites(page.params.slug!));
	const band = $derived(layout.band);
	const isAdmin = $derived(layout.userRole === 'owner' || layout.userRole === 'admin');

	let importing = $state(false);

	/** Other acts on the bill, for the "w/" byline. */
	function supportNames(lineup: { name: string; bandId: string | null }[]): string {
		return lineup
			.filter((l) => l.bandId !== band.id)
			.map((l) => l.name)
			.join(', ');
	}
</script>

<PageHeader title="Events" subtitle={band.name}>
	{#if isAdmin}
		<Button variant="ghost" size="sm" onclick={() => (importing = true)}>Import past gigs</Button>
		<CreateEventModal bandId={band.id} bandSlug={band.slug} bandName={band.name} />
	{/if}
</PageHeader>
<PageContent width="2xl">
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
				<div class="card bg-warning/10 border border-warning/40">
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
									<input {...confirm.fields.eventId.as('hidden', invite.eventId)} />
									<SubmitButton label="Confirm" variant="primary" size="sm" />
								</Form>
								<Form
									remote={decline}
									successToast="Declined"
									onsuccess={() => invalidateAll()}
									class="inline"
								>
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
		<div class="space-y-3">
			{#each events as evt (evt.id)}
				<a
					href={resolve(`/band/${band.slug}/events/${evt.id}`)}
					class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow block"
				>
					<CardBody row class="py-4">
						<div>
							<p class="font-medium">{evt.title}</p>
							<p class="text-muted">
								{formatDate(evt.startsAt)} &middot; {formatEventTimeRange(evt.startsAt, evt.endsAt)}
							</p>
							{#if evt.location}
								<p class="text-subtle">{evt.location}</p>
							{/if}
							{#if supportNames(evt.lineup)}
								<p class="text-subtle">w/ {supportNames(evt.lineup)}</p>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-2">
							{#if !evt.isOwner}
								<span class="badge badge-ghost badge-sm">guest</span>
							{/if}
							<StatusBadge status={evt.status} />
						</div>
					</CardBody>
				</a>
			{/each}
		</div>
	{/if}
</PageContent>

<ImportGigsModal bind:open={importing} />

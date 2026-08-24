<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import LineupEditor, {
		type LineupChip
	} from '../../../../band/[slug]/events/LineupEditor.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		getMyListing,
		findDuplicateListing,
		searchBandsForListing,
		updateListing,
		publishListing,
		unpublishListing,
		withdrawListing,
		deleteListing
	} from '$lib/remote/community-events.remote';
	import { formatDateShort, formatDollars } from '$lib/utils/format';
	import { imageSrc } from '$lib/utils/images';

	// Declared before the awaited query below — see the note on the create page.
	const fields = updateListing.fields;
	const publishFields = publishListing.fields;
	const unpublishFields = unpublishListing.fields;
	const withdrawFields = withdrawListing.fields;
	const deleteFields = deleteListing.fields;

	const eventId = $derived(page.params.id!);
	let listing = $derived(await getMyListing(eventId));

	// Advisory only — shown next to Publish, never blocking it.
	let duplicate = $derived(
		listing?.status === 'draft' ? await findDuplicateListing(eventId) : null
	);

	const requiresReview = $derived(listing?.standing.status !== 'none');

	// A button that silently does something other than what it says is worse
	// than the delay itself.
	const publishLabel = $derived(requiresReview ? 'Submit for review' : 'Publish');

	let lineup = $state<LineupChip[]>([]);
	let lineupLoaded = $state(false);
	$effect(() => {
		if (!lineupLoaded && listing) {
			lineup = listing.lineup.map((l) => ({
				name: l.name,
				bandId: l.bandId ?? undefined,
				status: l.status
			}));
			lineupLoaded = true;
		}
	});

	function toTimeValue(d: Date | null): string {
		if (!d) return '';
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}
	function toDateValue(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	function toDollars(cents: number | null): string {
		return cents == null ? '' : formatDollars(cents);
	}
</script>

{#if !listing}
	<PageHeader title="Listing not found" backHref={resolve('/member/events')} />
	<PageContent width="2xl">
		<Alert type="warning">
			This listing doesn't exist, or it isn't yours.
			<a href={resolve('/member/events')} class="link">Back to your events</a>
		</Alert>
	</PageContent>
{:else}
	<PageHeader title={listing.title} backHref={resolve('/member/events')}>
		<StatusBadge status={listing.status} label />
	</PageHeader>

	<PageContent width="2xl">
		{#if listing.status === 'rejected'}
			<!-- The reason is the entire point of a rejection: a member who can't see
			     what was wrong can't fix it, and `rejected` exists so they can. -->
			<Alert type="warning">
				<strong>Staff didn't publish this listing.</strong>
				{#if listing.reviewNotes}
					<p class="mt-1">"{listing.reviewNotes}"</p>
				{/if}
				<p class="mt-1">Fix it below and submit it again — everything you entered is still here.</p>
			</Alert>
		{:else if listing.status === 'pending_review'}
			<Alert type="info">
				This listing is with staff for review. You'll hear back once they've looked at it.
			</Alert>
		{:else if listing.status === 'draft' && listing.reviewNotes}
			<!-- Staff pulled this off the guide. Ordered ahead of the standing
			     explainer below: a takedown is specific news about THIS listing,
			     and the standing note is background the member has already seen. -->
			<Alert type="warning">
				<strong>Staff took this listing off the calendar.</strong>
				<p class="mt-1">"{listing.reviewNotes}"</p>
				<p class="mt-1">Fix it and publish again when you're ready.</p>
			</Alert>
		{:else if requiresReview && listing.status === 'draft'}
			<Alert type="info">
				{#if listing.standing.reason}
					After a report was upheld against one of your listings, staff check your listings before
					they go on the calendar. Their note: "{listing.standing.reason}"
				{:else}
					Staff check your listings before they go on the calendar.
				{/if}
			</Alert>
		{:else if listing.status === 'cancelled'}
			<Alert type="info">
				You've marked this show as cancelled. It stays on the public calendar, marked, until its
				date passes — so anyone who had the date finds out.
			</Alert>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			{#if listing.status === 'draft' || listing.status === 'rejected'}
				<Action
					action={publishListing}
					label={publishLabel}
					successToast={requiresReview ? 'Sent to staff' : 'Published'}
					variant="primary"
					size="sm"
					onsuccess={() => invalidateAll()}
				>
					{#snippet form()}
						<input {...publishFields.eventId.as('hidden', eventId)} />
						{#if requiresReview}
							<p class="py-2">
								Staff will look at this before it goes on the calendar. You'll get a note either
								way.
							</p>
						{:else}
							<p class="py-2">Put this show on the public calendar?</p>
						{/if}
					{/snippet}
				</Action>

				<Action
					action={deleteListing}
					label="Delete"
					successToast="Listing deleted"
					variant="ghost"
					size="sm"
					onsuccess={() => goto(resolve('/member/events'))}
				>
					{#snippet form()}
						<input {...deleteFields.eventId.as('hidden', eventId)} />
						<p class="py-2">
							Delete this listing? It was never public, so nothing is lost but this.
						</p>
					{/snippet}
				</Action>
			{:else if listing.status === 'published'}
				<Action
					action={unpublishListing}
					label="Take it down"
					successToast="Back in your drafts"
					variant="ghost"
					size="sm"
					onsuccess={() => invalidateAll()}
				>
					{#snippet form()}
						<input {...unpublishFields.eventId.as('hidden', eventId)} />
						<p class="py-2">
							Move this back to your drafts? It comes off the public calendar straight away.
						</p>
					{/snippet}
				</Action>

				<Action
					action={withdrawListing}
					label="Cancel the show"
					successToast="Marked as cancelled"
					variant="warning"
					size="sm"
					onsuccess={() => invalidateAll()}
				>
					{#snippet form()}
						<input {...withdrawFields.eventId.as('hidden', eventId)} />
						<p class="py-2">
							Is this show not happening? It stays on the calendar marked <strong>cancelled</strong>
							until its date passes, so anyone who had the date finds out. If you just want it gone, take
							it down instead.
						</p>
					{/snippet}
				</Action>
			{/if}
		</div>

		{#if duplicate}
			<Alert type="warning">
				<strong>This might already be listed.</strong>
				<p class="mt-1">
					<a href={resolve(`/events/${duplicate.id}`)} class="link">{duplicate.title}</a>
					is already on the calendar for {formatDateShort(duplicate.startsAt)}. Publish anyway if
					it's a different show.
				</p>
			</Alert>
		{/if}

		<Form
			remote={updateListing}
			successToast="Listing saved"
			onsuccess={() => invalidateAll()}
			class="space-y-4"
		>
			<input {...fields.eventId.as('hidden', eventId)} />

			<FormField
				field={fields.title}
				type="text"
				label="Title *"
				value={listing.title}
				maxlength="200"
			/>

			<FormField name="description" label="Description">
				<textarea
					{...fields.description.as('text', listing.description ?? '')}
					class="textarea w-full"
					rows="4"
					maxlength="5000"
				></textarea>
			</FormField>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<FormField
					field={fields.eventDate}
					type="date"
					label="Date *"
					value={toDateValue(listing.startsAt)}
					required
				/>
				<FormField
					field={fields.eventStartTime}
					type="time"
					label="Start Time *"
					value={toTimeValue(listing.startsAt)}
					required
				/>
				<FormField
					field={fields.eventEndTime}
					type="time"
					label="End Time"
					value={toTimeValue(listing.endsAt)}
					description="Optional — leave blank if you don't know."
				/>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<FormField
					field={fields.doorsTime}
					type="time"
					label="Doors Open"
					value={toTimeValue(listing.doorsAt)}
				/>
				<FormField
					field={fields.location}
					type="text"
					label="Venue *"
					value={listing.location ?? ''}
					maxlength="500"
				/>
			</div>

			<FormField
				field={fields.tags}
				type="text"
				label="Tags"
				value={listing.tags ?? ''}
				maxlength="500"
			/>

			<FormField
				name="lineup"
				label="Who's playing"
				description="Naming a band that's on the site asks them to confirm — they'll appear as a plain credit until they do."
			>
				<LineupEditor bind:value={lineup} search={searchBandsForListing} />
			</FormField>

			<FormField name="posterFile" label="Replace poster">
				{#if listing.posterUrl}
					{@const current = imageSrc(listing.posterUrl, 'thumb')}
					<img
						src={current.src}
						srcset={current.srcset}
						alt=""
						class="mb-2 h-32 w-auto rounded border"
						style="border-color: var(--surface-border)"
					/>
				{/if}
				<input
					{...fields.posterFile.as('file')}
					accept="image/jpeg,image/png,image/webp"
					class="file-input w-full"
				/>
			</FormField>

			<div class="grid gap-4 md:grid-cols-2">
				<FormField
					field={fields.externalTicketUrl}
					type="text"
					label="Ticket Link"
					value={listing.externalTicketUrl ?? ''}
				/>
				<FormField
					field={fields.ticketPriceDollars}
					type="text"
					label="Ticket price ($)"
					value={toDollars(listing.ticketPrice)}
					inputmode="decimal"
					description="What people pay, at the door or through the link. Leave blank if it's free."
				/>
			</div>

			<div class="flex justify-end pt-4">
				<SubmitButton label="Save changes" variant="primary" />
			</div>
		</Form>
	</PageContent>
{/if}

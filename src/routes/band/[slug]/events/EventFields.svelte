<script lang="ts">
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import LineupEditor, { type LineupChip } from './LineupEditor.svelte';
	import {
		formatDate,
		formatDollars,
		formatTime,
		toLocalDate,
		toLocalTime
	} from '$lib/utils/format';
	import { formatEventTimeRange } from '$lib/utils/event-time';
	import { priceDisplay } from '$lib/utils/event-ticketing';
	import { imageSrc } from '$lib/utils/images';

	/**
	 * Every field of a band event, in one place.
	 *
	 * The set used to be written twice — once on the create page and once in the
	 * edit form hidden behind a toggle on the detail page — and the two had
	 * already drifted: create offered `tags` and edit did not, so a band could
	 * never correct a tag after the fact.
	 *
	 * `readonly` renders the same markup without the means to change it, rather
	 * than switching to a different read-only template. That is what lets the
	 * detail page *be* the edit form for anyone who can edit, and stay a legible
	 * detail page for everyone else, with no second layout to keep in step.
	 *
	 * This script must stay synchronous — no top-level `await`. `fields` arrives
	 * as a resolved prop for that reason: a declaration after a top-level await is
	 * async-gated, which would compile every `fields.X.as()` below into an async
	 * derived. Pinned by `src/async-effect-shape.spec.ts`.
	 */
	type EventForDisplay = {
		title: string;
		description: string | null;
		startsAt: Date;
		endsAt: Date | null;
		doorsAt: Date | null;
		location: string | null;
		tags: string | null;
		externalTicketUrl: string | null;
		ticketPrice: number | null;
		posterUrl: string | null;
	};

	let {
		fields,
		evt,
		bandId,
		lineup = $bindable<LineupChip[]>([]),
		readonly = false
	}: {
		// The remote form's `.fields`. Typed loosely on purpose: create and update
		// are different form objects with overlapping but not identical shapes.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		fields: any;
		/** The saved event. Absent when creating. */
		evt?: EventForDisplay;
		bandId: string;
		lineup?: LineupChip[];
		readonly?: boolean;
	} = $props();

	const poster = $derived(evt?.posterUrl ? imageSrc(evt.posterUrl, 'thumb') : null);
</script>

<FormField
	field={fields.title}
	type="text"
	label={readonly ? 'Title' : 'Title *'}
	value={evt?.title ?? ''}
	placeholder="e.g. Live at The Venue"
	maxlength="200"
	{readonly}
	display={evt?.title}
/>

<!-- Custom input mode: FormField's built-in textarea drops `rest`, so rows,
     maxlength and placeholder would be lost. Issues still resolve by name.
     `readonly` now wins over this child rather than being ignored by it. -->
<FormField name="description" label="Description" {readonly} display={evt?.description ?? '—'}>
	<textarea
		{...fields.description.as('text', evt?.description ?? '')}
		class="textarea w-full"
		rows="4"
		maxlength="5000"
		placeholder="Tell people what to expect..."
	></textarea>
</FormField>

{#if readonly}
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<FormField label="Date" readonly display={evt ? formatDate(evt.startsAt) : ''} />
		<FormField
			label="Time"
			readonly
			display={evt ? formatEventTimeRange(evt.startsAt, evt.endsAt) : ''}
		/>
	</div>
{:else}
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<FormField
			field={fields.eventDate}
			type="date"
			label="Date *"
			value={evt ? toLocalDate(evt.startsAt) : ''}
			required
		/>
		<FormField
			field={fields.eventStartTime}
			type="time"
			label="Start Time *"
			value={evt ? toLocalTime(evt.startsAt) : ''}
			required
		/>
		<FormField
			field={fields.eventEndTime}
			type="time"
			label="End Time"
			value={evt?.endsAt ? toLocalTime(evt.endsAt) : ''}
			description="Optional — clear it if you don't know."
		/>
	</div>
{/if}

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
	<!-- Hidden entirely when read-only and unset: a row of em dashes is noise. -->
	{#if !readonly || evt?.doorsAt}
		<FormField
			field={fields.doorsTime}
			type="time"
			label="Doors Open"
			value={evt?.doorsAt ? toLocalTime(evt.doorsAt) : ''}
			{readonly}
			display={evt?.doorsAt ? formatTime(evt.doorsAt) : undefined}
		/>
	{/if}
	{#if !readonly || evt?.location}
		<FormField
			field={fields.location}
			type="text"
			label="Location"
			value={evt?.location ?? ''}
			placeholder="Venue name & address"
			maxlength="500"
			{readonly}
			display={evt?.location ?? undefined}
		/>
	{/if}
</div>

<!-- New on the edit side. `updateBandEventForm` has always accepted `tags` and
     the handler has always written it; only the input was missing, so a typo'd
     tag was permanent. -->
{#if !readonly || evt?.tags}
	<FormField
		field={fields.tags}
		type="text"
		label="Tags"
		value={evt?.tags ?? ''}
		placeholder="Comma-separated tags"
		maxlength="500"
		{readonly}
		display={evt?.tags ?? undefined}
	/>
{/if}

<FormField name="lineup" label="Who's playing">
	<LineupEditor bind:value={lineup} ownerBandId={bandId} {readonly} />
</FormField>

<!--
	Same treatment as the band avatar — a preview you can see and a Replace
	button — rather than the bare `file-input` this used to be, which read as a
	setting you could skip and is why posters went unadded.

	Still submits with the form, unlike the avatar's immediate POST: an event's
	poster is picked before the event exists, so uploading it up front is how you
	end up with orphaned posters when the create fails. `FileUpload`'s deferred
	mode gives the same chrome without the eager write.
-->
{#if !readonly}
	<FormField
		field={fields.posterFile}
		type="file"
		label="Poster"
		accept="image/jpeg,image/png,image/webp"
		src={poster?.src}
		previewClass="h-40 w-32"
		emptyLabel="Add a poster"
		replaceLabel="Replace poster"
		description="Shown on your events list, your band page, and the community calendar."
	/>
{:else if poster}
	<FormField label="Poster" readonly>
		{#snippet display()}
			<img
				src={poster.src}
				srcset={poster.srcset}
				alt="Event poster"
				class="h-40 w-32 rounded object-cover"
			/>
		{/snippet}
	</FormField>
{/if}

<div class="grid gap-4 md:grid-cols-2">
	{#if !readonly || evt?.externalTicketUrl}
		<FormField
			field={fields.externalTicketUrl}
			type="text"
			label="Ticket Link"
			value={evt?.externalTicketUrl ?? ''}
			placeholder="https://eventbrite.com/..."
			{readonly}
		>
			{#snippet display()}
				{#if evt?.externalTicketUrl}
					<a
						href={evt.externalTicketUrl}
						target="_blank"
						rel="noopener external"
						class="link link-primary break-all"
					>
						{evt.externalTicketUrl}
					</a>
				{/if}
			{/snippet}
		</FormField>
	{/if}

	<!-- `type="text"` with a decimal inputmode, not `type="number"`: a number
	     FormField registers as `n:` and SvelteKit would hand the handler a
	     number, which `ticketPriceDollars: z.string()` rejects outright. -->
	<FormField
		field={fields.ticketPriceDollars}
		type="text"
		label="Ticket price ($)"
		value={evt?.ticketPrice ? formatDollars(evt.ticketPrice) : ''}
		placeholder="10.00"
		inputmode="decimal"
		description="What people pay, at the door or through the link. Leave blank if it's free."
		{readonly}
		display={evt ? priceDisplay({ ...evt, ticketingEnabled: false }).label : undefined}
	/>
</div>

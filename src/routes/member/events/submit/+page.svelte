<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import LineupEditor, { type LineupChip } from '../../../band/[slug]/events/LineupEditor.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createListing, searchBandsForListing } from '$lib/remote/community-events.remote';

	// Declared before any top-level await: a declaration that follows one is
	// async-gated, which would compile every `fields.X.as()` into an async
	// derived.
	const fields = createListing.fields;

	let lineup = $state<LineupChip[]>([]);
</script>

<PageHeader
	title="Add a show to the calendar"
	subtitle="Something happening around town that the scene should know about"
	backHref={resolve('/member/events')}
/>
<PageContent width="2xl">
	<Alert type="info">
		This is for shows at other venues — a gig, a house show, a festival. Save it now and publish it
		when you're ready; nothing goes on the public calendar until you say so.
	</Alert>

	<Form
		remote={createListing}
		successToast="Draft saved"
		onsuccess={(result) => {
			if (result?.eventId) goto(resolve(`/member/events/${result.eventId}/manage`));
		}}
		class="space-y-4"
	>
		<FormField
			field={fields.title}
			type="text"
			label="Title *"
			placeholder="e.g. Paper Wolves at The Whiteside"
			maxlength="200"
		/>

		<!-- Custom input mode: FormField's built-in textarea drops `rest`, so rows,
		     maxlength and placeholder would be lost. Issues still resolve by name. -->
		<FormField name="description" label="Description">
			<textarea
				{...fields.description.as('text')}
				class="textarea w-full"
				rows="4"
				maxlength="5000"
				placeholder="Who's playing, what it sounds like, anything worth knowing..."
			></textarea>
		</FormField>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<FormField field={fields.eventDate} type="date" label="Date *" required />
			<FormField field={fields.eventStartTime} type="time" label="Start Time *" required />
			<FormField
				field={fields.eventEndTime}
				type="time"
				label="End Time"
				description="Optional — leave blank if you don't know."
			/>
		</div>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<FormField field={fields.doorsTime} type="time" label="Doors Open" />
			<FormField
				field={fields.location}
				type="text"
				label="Venue *"
				placeholder="Venue name & address"
				maxlength="500"
			/>
		</div>

		<FormField
			field={fields.tags}
			type="text"
			label="Tags"
			placeholder="Comma-separated tags"
			maxlength="500"
		/>

		<FormField
			name="lineup"
			label="Who's playing"
			description="Naming a band that's on the site asks them to confirm — they'll appear as a plain credit until they do."
		>
			<LineupEditor bind:value={lineup} search={searchBandsForListing} />
		</FormField>

		<FormField name="posterFile" label="Poster">
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
				placeholder="https://..."
				description="Where people buy, if it isn't at the door."
			/>

			<!-- `type="text"` with a decimal inputmode, not `type="number"`: a number
			     FormField registers as `n:` and SvelteKit would hand the handler a
			     number, which `ticketPriceDollars: z.string()` rejects outright. -->
			<FormField
				field={fields.ticketPriceDollars}
				type="text"
				label="Ticket price ($)"
				placeholder="10.00"
				inputmode="decimal"
				description="What people pay, at the door or through the link. Leave blank if it's free."
			/>
		</div>

		<div class="flex justify-end pt-4">
			<SubmitButton label="Save draft" variant="primary" />
		</div>
	</Form>
</PageContent>

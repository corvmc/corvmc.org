<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import ContactRoleFields from './ContactRoleFields.svelte';
	import { saveBandEpk } from '$lib/remote/press-kit.remote';
	import type { getBandLayout } from '$lib/remote/layout.remote';
	import type { FullPressKit } from '$lib/types/band-page';

	let {
		band,
		epk: initialEpk
	}: {
		band: Awaited<ReturnType<typeof getBandLayout>>['band'];
		epk: FullPressKit;
	} = $props();

	// Seeded once. `$state` is deeply reactive, so `bind:value` into a nested
	// array element is enough — no per-field oninput plumbing.
	let epk = $state<FullPressKit>(untrack(() => structuredClone(initialEpk)));

	// The whole kit travels as one JSON field, decoded server-side by
	// `jsonObjectField` so malformed input is an issue on this field rather than
	// a whole-page 400.
	const epkJson = $derived(JSON.stringify(epk));

	function addQuote() {
		epk.pressQuotes = [...epk.pressQuotes, { quote: '', publication: '' }];
	}
	function addAchievement() {
		epk.achievements = [...epk.achievements, ''];
	}
	function addBacklineItem() {
		epk.backline = [...epk.backline, { instrument: '', details: '', provided: true }];
	}
	function removeAt<T>(list: T[], i: number): T[] {
		return list.filter((_, n) => n !== i);
	}

	const PROVIDED_BY = [
		{ value: 'band', label: 'We bring it' },
		{ value: 'venue', label: 'Venue provides' }
	];
</script>

<Form
	remote={saveBandEpk}
	onsuccess={() => toast.success('Press kit saved')}
	onfailure={() => toast.error('Failed to save')}
>
	<input {...saveBandEpk.fields.slug.as('hidden', band.slug)} />
	<input {...saveBandEpk.fields.epk.as('hidden', epkJson)} />

	<Alert type="info">
		Everything on this page is free for every act. Contacts, phone numbers and stage requirements go
		only in the press kit you download and send — they are never published on your public page,
		where a booker reaches you through a contact form instead.
	</Alert>

	<!-- Public: what a stranger reads -->
	<InfoCard title="Press quotes">
		<p class="text-muted">Shown on your public page.</p>
		{#if epk.pressQuotes.length === 0}
			<p class="text-muted">Nothing quoted yet.</p>
		{/if}
		<div class="space-y-4">
			{#each epk.pressQuotes as _quote, i (i)}
				<div class="space-y-2 inset p-3">
					<FormField type="textarea" label="Quote" bind:value={epk.pressQuotes[i].quote} />
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						<FormField
							type="text"
							label="Publication"
							bind:value={epk.pressQuotes[i].publication}
						/>
						<FormField type="text" label="Date" bind:value={epk.pressQuotes[i].date} />
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onclick={() => (epk.pressQuotes = removeAt(epk.pressQuotes, i))}
					>
						Remove quote
					</Button>
				</div>
			{/each}
		</div>
		<Button type="button" variant="default" size="sm" outline onclick={addQuote}>
			Add a quote
		</Button>
	</InfoCard>

	<InfoCard title="Highlights">
		<p class="text-muted">
			Awards, notable supports, festivals, milestones. Shown on your public page.
		</p>
		{#if epk.achievements.length === 0}
			<p class="text-muted">Nothing listed yet.</p>
		{/if}
		<div class="space-y-2">
			{#each epk.achievements as _, i (i)}
				<div class="flex items-end gap-2">
					<div class="flex-1">
						<FormField type="text" label="Highlight" bind:value={epk.achievements[i]} />
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onclick={() => (epk.achievements = removeAt(epk.achievements, i))}
					>
						Remove
					</Button>
				</div>
			{/each}
		</div>
		<Button type="button" variant="default" size="sm" outline onclick={addAchievement}>
			Add a highlight
		</Button>
	</InfoCard>

	<!-- Package only: what a venue is sent -->
	<InfoCard title="Who to contact">
		<p class="text-muted">
			Package only. Your public page offers a contact form instead, so none of this is published.
		</p>
		<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
			<ContactRoleFields
				label="Booking"
				description="Where a booking enquiry from your public page is delivered."
				bind:contact={epk.bookingContact}
			/>
			<ContactRoleFields
				label="Management"
				description="If someone else handles the business."
				bind:contact={epk.managementContact}
			/>
			<ContactRoleFields
				label="Press"
				description="Who a journalist should ask for."
				bind:contact={epk.prContact}
				withPhone={false}
			/>
		</div>
	</InfoCard>

	<InfoCard title="Backline">
		<p class="text-muted">
			What you bring and what you need from the room. Package only — a venue gets this by asking.
		</p>
		{#if epk.backline.length === 0}
			<p class="text-muted">Nothing listed yet.</p>
		{/if}
		<div class="space-y-4">
			{#each epk.backline as _, i (i)}
				<div class="grid grid-cols-1 gap-2 inset p-3 sm:grid-cols-[1fr_1fr_auto]">
					<FormField type="text" label="Instrument" bind:value={epk.backline[i].instrument} />
					<FormField type="text" label="Details" bind:value={epk.backline[i].details} />
					<FormField
						type="select"
						label="Provided by"
						options={PROVIDED_BY}
						value={epk.backline[i].provided ? 'band' : 'venue'}
						onchange={(e: Event) => {
							epk.backline[i].provided = (e.currentTarget as HTMLSelectElement).value === 'band';
						}}
					/>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="sm:col-span-3"
						onclick={() => (epk.backline = removeAt(epk.backline, i))}
					>
						Remove item
					</Button>
				</div>
			{/each}
		</div>
		<Button type="button" variant="default" size="sm" outline onclick={addBacklineItem}>
			Add an item
		</Button>
	</InfoCard>

	<div class="flex justify-end">
		<SubmitButton>Save press kit</SubmitButton>
	</div>
</Form>

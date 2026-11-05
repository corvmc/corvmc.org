<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import ContactRoleFields from './ContactRoleFields.svelte';
	import { resolve } from '$app/paths';
	import { saveBandEpk } from '#lib/remote/press-kit.remote.js';
	import type { getBandLayout } from '#lib/remote/layout.remote.js';
	import type { FullPressKit } from '#lib/types/band-page.js';

	let {
		band,
		epk: initialEpk,
		premium = false
	}: {
		band: Awaited<ReturnType<typeof getBandLayout>>['band'];
		epk: FullPressKit;
		/** Whether the video section is available — a band site, and the flag on. */
		premium?: boolean;
	} = $props();

	/** Four is a section, not an archive. A booker watches one. */
	const MAX_VIDEOS = 4;

	// Seeded once. `$state` is deeply reactive, so `bind:value` into a nested
	// array element is enough — no per-field oninput plumbing.
	let epk = $state<FullPressKit>(untrack(() => structuredClone(initialEpk)));

	// The whole kit travels as one JSON field, decoded server-side by
	// `jsonObjectField` so malformed input is an issue on this field rather than
	// a whole-page 400.
	const epkJson = $derived(JSON.stringify(epk));

	const riderHref = $derived(resolve('/band/[slug]/rider', { slug: band.slug }));

	function addQuote() {
		epk.pressQuotes = [...epk.pressQuotes, { quote: '', publication: '' }];
	}
	function addAchievement() {
		epk.achievements = [...epk.achievements, ''];
	}
	function addVideo() {
		epk.videos = [...epk.videos, { url: '' }];
	}
	function removeAt<T>(list: T[], i: number): T[] {
		return list.filter((_, n) => n !== i);
	}
</script>

<Form
	remote={saveBandEpk}
	onsuccess={() => toast.success(m.band_slug_press_kit_press_kit_form_toast())}
>
	<input {...saveBandEpk.fields.slug.as('hidden', band.slug)} />
	<input {...saveBandEpk.fields.epk.as('hidden', epkJson)} />

	<Alert type="info">
		<ParaglideMessage
			message={m.band_slug_press_kit_press_kit_form_everything_page_free_ever}
			inputs={{}}
			>{#snippet a({ children })}<a href={riderHref} class="link">{@render children?.()}</a
				>{/snippet}</ParaglideMessage
		>
	</Alert>

	<!-- Public: what a stranger reads -->
	<InfoCard title={m.band_slug_press_kit_press_kit_form_press_quotes()}>
		<p class="text-muted">{m.band_slug_press_kit_press_kit_form_shown_public_page()}</p>
		{#if epk.pressQuotes.length === 0}
			<p class="text-muted">{m.band_slug_press_kit_press_kit_form_nothing_quoted_yet()}</p>
		{/if}
		<div class="space-y-4">
			{#each epk.pressQuotes as _quote, i (i)}
				<div class="space-y-2 inset p-3">
					<FormField
						type="textarea"
						label={m.band_slug_press_kit_press_kit_form_quote()}
						bind:value={epk.pressQuotes[i].quote}
					/>
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						<FormField
							type="text"
							label={m.band_slug_press_kit_press_kit_form_publication()}
							bind:value={epk.pressQuotes[i].publication}
						/>
						<FormField type="text" label={m.band_date()} bind:value={epk.pressQuotes[i].date} />
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onclick={() => (epk.pressQuotes = removeAt(epk.pressQuotes, i))}
					>
						{m.band_slug_press_kit_press_kit_form_remove_quote()}
					</Button>
				</div>
			{/each}
		</div>
		<Button type="button" variant="default" size="sm" outline onclick={addQuote}>
			{m.band_slug_press_kit_press_kit_form_add_quote()}
		</Button>
	</InfoCard>

	<InfoCard title={m.band_slug_press_kit_press_kit_form_highlights()}>
		<p class="text-muted">
			{m.band_slug_press_kit_press_kit_form_awards_notable_supports_f()}
		</p>
		{#if epk.achievements.length === 0}
			<p class="text-muted">{m.band_slug_press_kit_press_kit_form_nothing_listed_yet()}</p>
		{/if}
		<div class="space-y-2">
			{#each epk.achievements as _, i (i)}
				<div class="flex items-end gap-2">
					<div class="flex-1">
						<FormField
							type="text"
							label={m.band_slug_press_kit_press_kit_form_highlight()}
							bind:value={epk.achievements[i]}
						/>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onclick={() => (epk.achievements = removeAt(epk.achievements, i))}
					>
						{m.band_remove()}
					</Button>
				</div>
			{/each}
		</div>
		<Button type="button" variant="default" size="sm" outline onclick={addAchievement}>
			{m.band_slug_press_kit_press_kit_form_add_highlight()}
		</Button>
	</InfoCard>

	{#if premium}
		<InfoCard title={m.band_slug_press_kit_press_kit_form_video()}>
			<p class="text-muted">
				{m.band_slug_press_kit_press_kit_form_live_clips_page_press_kit()}
			</p>
			{#if epk.videos.length === 0}
				<p class="text-muted">{m.band_slug_press_kit_press_kit_form_no_video_yet()}</p>
			{/if}
			<div class="space-y-4">
				{#each epk.videos as _video, i (i)}
					<div class="grid grid-cols-1 gap-2 inset p-3 sm:grid-cols-2">
						<FormField
							type="text"
							label={m.band_slug_press_kit_press_kit_form_video_url()}
							bind:value={epk.videos[i].url}
						/>
						<FormField
							type="text"
							label={m.band_slug_press_kit_press_kit_form_label()}
							bind:value={epk.videos[i].label}
						/>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="sm:col-span-2"
							onclick={() => (epk.videos = removeAt(epk.videos, i))}
						>
							{m.band_slug_press_kit_press_kit_form_remove_video()}
						</Button>
					</div>
				{/each}
			</div>
			{#if epk.videos.length < MAX_VIDEOS}
				<Button type="button" variant="default" size="sm" outline onclick={addVideo}>
					{m.band_slug_press_kit_press_kit_form_add_video()}
				</Button>
			{/if}
		</InfoCard>
	{/if}

	<!-- Package only: what a venue is sent -->
	<InfoCard title={m.band_slug_press_kit_press_kit_form_who_contact()}>
		<p class="text-muted">
			{m.band_slug_press_kit_press_kit_form_package_only_public_page()}
		</p>
		<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
			<ContactRoleFields
				label={m.band_slug_press_kit_press_kit_form_booking()}
				description={m.band_slug_press_kit_press_kit_form_where_booking_enquiry_fro()}
				bind:contact={epk.bookingContact}
			/>
			<ContactRoleFields
				label={m.band_slug_press_kit_press_kit_form_management()}
				description={m.band_slug_press_kit_press_kit_form_if_someone_else_handles_b()}
				bind:contact={epk.managementContact}
			/>
			<ContactRoleFields
				label={m.band_slug_press_kit_press_kit_form_press()}
				description={m.band_slug_press_kit_press_kit_form_who_journalist_should_ask()}
				bind:contact={epk.prContact}
				withPhone={false}
			/>
		</div>
	</InfoCard>

	<div class="flex justify-end">
		<SubmitButton>{m.band_slug_press_kit_press_kit_form_save_press_kit()}</SubmitButton>
	</div>
</Form>

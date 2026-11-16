<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { createReleaseForm } from '#lib/remote/audio.remote.js';
	import { releaseKinds, releaseKindLabels } from '#lib/config.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	let { bandSlug }: { bandSlug: string } = $props();

	const fields = createReleaseForm.fields;

	const kindOptions = releaseKinds.map((kind) => ({
		value: kind,
		label: releaseKindLabels[kind]
	}));
</script>

<!--
	Create in a modal on the list page, per the house rule — and only the three
	things a record cannot be created without. Price, cover, description and
	radio consent all live on the edit page, because none of them can be
	answered sensibly before the tracks exist.

	The `form` snippet, never `body`: Action checks `{#if body}` before its
	RemoteForm branch, so a `body` snippet renders the fields bare and posts
	nothing.
-->
<Action
	action={createReleaseForm}
	label={m.band_slug_music_create_release_modal_new_release_label()}
	modalTitle={m.band_slug_music_create_release_modal_new_release_title()}
	submitLabel={m.band_slug_music_create_release_modal_submit_label()}
	successToast={m.band_slug_music_create_release_modal_success_toast()}
	size="sm"
	onsuccess={(result) => {
		const releaseId = (result as { releaseId?: string } | undefined)?.releaseId;
		if (releaseId) goto(resolve(`band/${bandSlug}/music/${releaseId}`));
	}}
>
	{#snippet form()}
		<div class="space-y-4">
			<!-- The band this release belongs to. The guard resolves the group from
			     this rather than from the route's params, which a remote function
			     takes from a client-supplied header. -->
			<input {...fields.slug.as('hidden', bandSlug)} />

			<FormField field={fields.title} label={m.band_title_label()} required />
			<FormField
				field={fields.kind}
				label={m.band_type_label()}
				type="select"
				options={kindOptions}
				required
			/>
			<FormField
				field={fields.releasedAt}
				label={m.band_release_date_label()}
				type="date"
				description={m.band_slug_music_create_release_modal_description_body()}
			/>
		</div>
	{/snippet}
</Action>

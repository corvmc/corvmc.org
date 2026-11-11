<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createBandApi } from '#lib/remote/bands.remote.js';
	import { Field } from '../ui/Form';
	import SearchSelect from '../ui/Form/SearchSelect.svelte';

	const { fields } = createBandApi;

	let {
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: (result?: unknown) => void;
		[key: string]: unknown;
	} = $props();

	let selectedOwner = $state<{ id: string; name: string; email: string } | null>(null);

	async function searchUsers(q: string): Promise<{ id: string; name: string; email: string }[]> {
		const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
		return res.json();
	}
</script>

<Action
	action={createBandApi}
	label={m.actions_create_band_new_band_label()}
	modalTitle={m.actions_create_band_new_band_title()}
	submitLabel={m.actions_create_band_submit_label()}
	canSubmit={!!selectedOwner}
	maxWidth="max-w-md"
	successToast={m.actions_create_band_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ??
		(async (result) => {
			const r = result as { bandId?: string };
			await refreshAll();
			if (r?.bandId) goto(resolve(`staff/groups/${r.bandId}`));
		})}
	{...rest}
>
	{#snippet form()}
		{#if selectedOwner}
			<input {...fields.ownerId.as('hidden', selectedOwner.id)} />
		{/if}
		<Field field={createBandApi.fields.name} type="text" label={m.actions_name_label()} />
		<Field
			field={createBandApi.fields.bio}
			type="textarea"
			label={m.actions_create_band_bio_label()}
		/>
		<fieldset class="fieldset">
			<legend class="fieldset-legend">{m.actions_create_band_owner_title()}</legend>
			<SearchSelect
				search={searchUsers}
				bind:value={selectedOwner}
				placeholder={m.actions_create_band_placeholder()}
			/>
		</fieldset>
	{/snippet}
</Action>

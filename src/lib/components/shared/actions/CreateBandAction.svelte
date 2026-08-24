<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createBandApi } from '$lib/remote/bands.remote';
	import { Field } from '../Form';
	import SearchSelect from '../Form/SearchSelect.svelte';

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
	label="New Band"
	modalTitle="New Band"
	submitLabel="Create Band"
	canSubmit={!!selectedOwner}
	maxWidth="max-w-md"
	successToast="Band created"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ??
		(async (result) => {
			const r = result as { bandId?: string };
			await invalidateAll();
			if (r?.bandId) goto(resolve(`/staff/bands/${r.bandId}`));
		})}
	{...rest}
>
	{#snippet form()}
		{#if selectedOwner}
			<input {...fields.ownerId.as('hidden', selectedOwner.id)} />
		{/if}
		<Field name="name" type="text" label="Name" />
		<Field name="bio" type="textarea" label="Bio" />
		<fieldset class="fieldset">
			<legend class="fieldset-legend">Owner</legend>
			<SearchSelect
				search={searchUsers}
				bind:value={selectedOwner}
				placeholder="Search by name or email..."
			/>
		</fieldset>
	{/snippet}
</Action>

<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { addBandMember } from '$lib/remote/bands.remote';
	import Button from '$lib/components/ui/Button.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';

	const { fields } = addBandMember;

	const ROLE_OPTIONS = [
		{ value: 'member', label: 'Member' },
		{ value: 'admin', label: 'Admin' }
	];

	let {
		bandId,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		bandId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	let query = $state('');
	let userId = $state('');
	let userName = $state('');
	let searchResults = $state<{ id: string; name: string; email: string }[]>([]);

	async function handleSearch() {
		if (query.length < 2) {
			searchResults = [];
			return;
		}
		const res = await fetch(`/api/bands/${bandId}/search-members?q=${encodeURIComponent(query)}`);
		searchResults = await res.json();
	}

	function selectUser(u: { id: string; name: string }) {
		userId = u.id;
		userName = u.name;
		searchResults = [];
		query = '';
	}
</script>

<Action
	action={addBandMember}
	label="Add Member"
	modalTitle="Invite Member"
	canSubmit={!!userId}
	successToast="Invitation sent"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.bandId.as('hidden', bandId)} />
		<input {...fields.userId.as('hidden', userId)} />
		<div class="space-y-3">
			{#if userId}
				<div class="flex items-center justify-between rounded bg-base-200 p-2">
					<span class="font-medium">{userName}</span>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						onclick={() => {
							userId = '';
							userName = '';
						}}>Change</Button
					>
				</div>
			{:else}
				<!-- Named `userId` without being the input that carries it: the value
				     posts from the hidden field above, but an issue on it belongs
				     beside the box where the member is picked, which is the only
				     thing on screen when `userId` is still empty. -->
				<FormField name="userId" label="Search members">
					{#snippet input(id)}
						<input
							{id}
							type="text"
							class="input w-full"
							bind:value={query}
							oninput={handleSearch}
							placeholder="Name or email..."
						/>
					{/snippet}
				</FormField>
				{#if searchResults.length > 0}
					<div class="max-h-40 overflow-y-auto rounded bg-base-200">
						{#each searchResults as u (u.id)}
							<button
								type="button"
								class="w-full px-3 py-2 text-left text-sm hover:bg-base-300"
								onclick={() => selectUser(u)}
							>
								<span class="font-medium">{u.name}</span>
								<span class="ml-1 opacity-60">{u.email}</span>
							</button>
						{/each}
					</div>
				{/if}
			{/if}
			<FormField field={fields.role} type="select" label="Role" options={ROLE_OPTIONS} />
			<FormField field={fields.position} label="Position (optional)" placeholder="e.g. Guitarist" />
		</div>
	{/snippet}
</Action>

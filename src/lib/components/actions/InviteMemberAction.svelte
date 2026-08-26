<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { addBandMember } from '$lib/remote/bands.remote';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';

	const { fields } = addBandMember;

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
				<label class="form-control w-full">
					<div class="label"><span class="label-text">Search members</span></div>
					<input
						type="text"
						class="input w-full"
						bind:value={query}
						oninput={handleSearch}
						placeholder="Name or email..."
					/>
				</label>
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
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Role</span></div>
				<Select class="w-full" {...fields.role.as('select')}>
					<option value="member">Member</option>
					<option value="admin">Admin</option>
				</Select>
			</label>
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Position (optional)</span></div>
				<input {...fields.position.as('text')} class="input w-full" placeholder="e.g. Guitarist" />
			</label>
		</div>
	{/snippet}
</Action>

<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { createLoan, getAvailableEquipment } from '$lib/remote/equipment.remote';
	import { Field } from '../Form';
	import Button from '$lib/components/shared/Button.svelte';

	const { fields } = createLoan;

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
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	let query = $state('');
	let userId = $state('');
	let userName = $state('');
	let memberResults = $state<{ id: string; name: string; email: string }[]>([]);

	async function handleMemberSearch() {
		if (query.length < 2) {
			memberResults = [];
			return;
		}
		const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
		memberResults = await res.json();
	}

	function selectMember(u: { id: string; name: string }) {
		userId = u.id;
		userName = u.name;
		memberResults = [];
		query = '';
	}
</script>

<Action
	action={createLoan}
	label="New Loan"
	modalTitle="Create Loan Request"
	successToast="Loan request created"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<svelte:boundary>
			<div class="space-y-3">
				<input {...fields.userId.as('hidden', userId)} />
				{#if userId}
					<div class="flex items-center justify-between bg-base-200 rounded p-2">
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
						<div class="label"><span class="label-text">Member</span></div>
						<input
							type="text"
							class="input w-full"
							bind:value={query}
							oninput={handleMemberSearch}
							placeholder="Search by name or email..."
						/>
					</label>
					{#if memberResults.length > 0}
						<div class="bg-base-200 rounded max-h-40 overflow-y-auto">
							{#each memberResults as u (u.id)}
								<button
									type="button"
									class="w-full text-left px-3 py-2 hover:bg-base-300 text-sm"
									onclick={() => selectMember(u)}
								>
									<span class="font-medium">{u.name}</span>
									<span class="opacity-60 ml-1">{u.email}</span>
								</button>
							{/each}
						</div>
					{/if}
				{/if}
				<!--
				Awaited here rather than fetched from `/api/equipment` — that route
				does not exist, so the select silently stayed empty and every
				staff-created loan quietly became a free-form request.
			-->
				<Field field={fields.equipmentId} type="select" label="Equipment">
					<option value="">-- Select equipment --</option>
					{#each await getAvailableEquipment() as eq (eq.id)}
						<option value={eq.id}>{eq.name}</option>
					{/each}
				</Field>
				<Field field={fields.quantity} type="number" label="Quantity" value={1} />
				<Field field={fields.requestedPickupDate} type="date" label="Requested pickup date" />
				<Field field={fields.estimatedReturnDate} type="date" label="Estimated return date" />
				<Field field={fields.memberNotes} type="textarea" label="Notes (optional)" />
			</div>

			{#snippet pending()}
				<div class="flex items-center justify-center p-8">
					<span class="loading loading-md loading-spinner"></span>
				</div>
			{/snippet}
		</svelte:boundary>
	{/snippet}
</Action>

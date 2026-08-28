<script lang="ts">
	import Button from './Button.svelte';

	/**
	 * Search for a person and bind their id to a hidden form field.
	 *
	 * A search-and-pick rather than a `<select>`: the member list is thousands
	 * long, so the options cannot be shipped to the page. That is also why this
	 * is not a `FormField` — the visible control is a search box whose value is
	 * never submitted, and the submitted value is the hidden id beside it.
	 *
	 * Domain-free by the folder's rule: it imports nothing from `$lib/remote` or
	 * `$lib/server`, and reaches the staff-guarded `/api/users/search` over HTTP
	 * the same way the rest of the app's pickers do.
	 */
	let {
		field,
		label = 'Member',
		placeholder = 'Search by name or email...',
		value = $bindable(''),
		name = $bindable('')
	}: {
		/** The remote form field whose value is the selected user's id. */
		field: { as: (type: 'hidden', value: string) => Record<string, unknown> };
		label?: string;
		placeholder?: string;
		/** The selected user's id. */
		value?: string;
		/** The selected user's display name, for the chip. */
		name?: string;
	} = $props();

	let query = $state('');
	let results = $state<{ id: string; name: string; email: string }[]>([]);

	async function search() {
		if (query.length < 2) {
			results = [];
			return;
		}
		const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
		results = await res.json();
	}

	function select(u: { id: string; name: string }) {
		value = u.id;
		name = u.name;
		results = [];
		query = '';
	}
</script>

<input {...field.as('hidden', value)} />
{#if value}
	<div class="flex items-center justify-between rounded bg-base-200 p-2">
		<span class="font-medium">{name}</span>
		<Button
			type="button"
			variant="ghost"
			size="xs"
			onclick={() => {
				value = '';
				name = '';
			}}>Change</Button
		>
	</div>
{:else}
	<label class="form-control w-full">
		<div class="label"><span class="label-text">{label}</span></div>
		<input type="text" class="input w-full" bind:value={query} oninput={search} {placeholder} />
	</label>
	{#if results.length > 0}
		<div class="max-h-40 overflow-y-auto rounded bg-base-200">
			{#each results as u (u.id)}
				<button
					type="button"
					class="w-full px-3 py-2 text-left text-sm hover:bg-base-300"
					onclick={() => select(u)}
				>
					<span class="font-medium">{u.name}</span>
					<span class="ml-1 opacity-60">{u.email}</span>
				</button>
			{/each}
		</div>
	{/if}
{/if}

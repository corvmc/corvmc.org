<script lang="ts">
	import { IconX } from '@tabler/icons-svelte';
	import { Combobox } from 'bits-ui';
	import Button from '$lib/components/shared/Button.svelte';

	let {
		options,
		value = [],
		name,
		placeholder = 'Type to search...',
		onchange,
		disabled = false
	}: {
		options: { id: string; label: string }[];
		value?: string[];
		name: string;
		placeholder?: string;
		onchange?: () => void;
		disabled?: boolean;
	} = $props();

	// Working copy synced from the prop; resets whenever `value` changes (e.g. after a save).
	let selected = $derived([...value]);
	let query = $state('');

	let filtered = $derived(
		query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options
	);

	let selectedOptions = $derived(options.filter((o) => selected.includes(o.id)));

	function remove(id: string) {
		selected = selected.filter((s) => s !== id);
		onchange?.();
	}

	function handleValueChange(vals: string[]) {
		selected = vals;
		onchange?.();
	}
</script>

<!-- Hidden input for form submission (JSON array to avoid duplicate key errors) -->
<input type="hidden" {name} value={JSON.stringify(selected)} />

<Combobox.Root
	type="multiple"
	bind:value={selected}
	onValueChange={handleValueChange}
	inputValue={query}
	{disabled}
>
	<div class="space-y-2 rounded bg-base-200 p-2">
		{#if selectedOptions.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each selectedOptions as opt (opt.id)}
					<Button variant="default" size="xs" type="button" onclick={() => remove(opt.id)}>
						{opt.label}
						<IconX class="size-3" />
					</Button>
				{/each}
			</div>
		{/if}

		<div class="relative">
			<Combobox.Input
				{placeholder}
				class="input w-full"
				oninput={(e: Event) => (query = (e.target as HTMLInputElement).value)}
			/>

			<Combobox.Content
				class="menu z-10 max-h-60 w-full overflow-y-auto rounded-box bg-base-100 p-1 shadow-lg"
				sideOffset={4}
			>
				{#each filtered as opt (opt.id)}
					<Combobox.Item
						value={opt.id}
						label={opt.label}
						class="rounded-btn cursor-pointer px-3 py-2 data-[highlighted]:bg-base-200 data-[selected]:font-bold"
					>
						{opt.label}
					</Combobox.Item>
				{:else}
					<div class="px-3 py-2 opacity-60">No results</div>
				{/each}
			</Combobox.Content>
		</div>
	</div>
</Combobox.Root>

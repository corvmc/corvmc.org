<script lang="ts" generics="T extends Record<string, any>">
	import { Combobox } from 'bits-ui';
	import Button from '$lib/components/shared/Button.svelte';

	let {
		search,
		value = $bindable(null),
		labelKey = 'name' as keyof T & string,
		descriptionKey = 'email' as keyof T & string,
		placeholder = 'Search by name or email...',
		minChars = 2,
		name,
		onselect
	}: {
		search: (query: string) => Promise<T[]>;
		value?: T | null;
		labelKey?: keyof T & string;
		descriptionKey?: keyof T & string;
		placeholder?: string;
		minChars?: number;
		name?: string;
		/** Fires when a result is picked, and with `null` when the choice is cleared. */
		onselect?: (value: T | null) => void;
	} = $props();

	let query = $state('');
	let comboValue = $state<string[]>([]);

	const results = $derived(query.length >= minChars ? await search(query) : []);

	/**
	 * Commits the pick in the handler bits-ui calls, not in an `$effect`.
	 *
	 * An effect lands a tick *after* the click. Every caller posts the choice
	 * through a hidden input, and a submit inside that tick sends an empty one —
	 * which a remote form reads as a deliberate blank, not as "nothing picked".
	 * The form then reports success having saved the opposite of what was
	 * clicked. `e2e/messages.e2e.ts` had to work around the window; the event
	 * picker in `e2e/volunteering.e2e.ts` failed on it outright.
	 *
	 * `onValueChange` covers the keyboard too — bits-ui selects on Enter without
	 * dispatching a click, so an `onclick` on the item would not have.
	 */
	function commit(ids: string[]) {
		const found = results.find((r) => r.id === ids[0]);
		if (!found) return;
		value = found;
		query = '';
		onselect?.(found);
	}

	function clear() {
		value = null;
		comboValue = [];
		onselect?.(null);
	}
</script>

{#if name && value}
	<input type="hidden" {name} value={value.id} />
{/if}

{#if value}
	<div class="flex items-center gap-2">
		<div class="badge gap-2 badge-lg">
			{value[labelKey]}
			<!-- Named, because a bare ✕ is indistinguishable from the enclosing
			     modal's own close button to a screen reader and to a test. -->
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="circle"
				aria-label="Clear {value[labelKey]}"
				onclick={clear}>✕</Button
			>
		</div>
		{#if value[descriptionKey]}
			<span class="text-muted">{value[descriptionKey]}</span>
		{/if}
	</div>
{:else}
	<svelte:boundary>
		<Combobox.Root
			type="multiple"
			bind:value={comboValue}
			onValueChange={commit}
			inputValue={query}
		>
			<div class="relative">
				<Combobox.Input
					{placeholder}
					class="input w-full"
					oninput={(e: Event) => {
						query = (e.target as HTMLInputElement).value;
					}}
				/>
				<!--
					`flex-nowrap` is load bearing. daisyUI's `.menu` is `flex-flow: column
					wrap`, so a capped height makes the list wrap into a *second column*
					rather than scroll — and since `.menu` is also `width: fit-content`,
					that column runs off the side of the popover where it cannot be
					reached. Invisible until a search returns more than a few results.
				-->
				<Combobox.Content
					class="menu z-10 max-h-60 w-full flex-nowrap overflow-y-auto rounded-box bg-base-100 p-1 shadow-lg"
					sideOffset={4}
				>
					{#each results as item (item.id)}
						<Combobox.Item
							value={item.id}
							label={item[labelKey]}
							class="rounded-btn cursor-pointer px-3 py-2 data-[highlighted]:bg-base-200"
						>
							<span class="font-medium">{item[labelKey]}</span>
							{#if item[descriptionKey]}
								<span class="ml-2 text-muted">{item[descriptionKey]}</span>
							{/if}
						</Combobox.Item>
					{:else}
						{#if query.length >= minChars}
							<div class="px-3 py-2 opacity-60">No results</div>
						{:else}
							<div class="px-3 py-2 opacity-60">Type to search...</div>
						{/if}
					{/each}
				</Combobox.Content>
			</div>
		</Combobox.Root>

		{#snippet pending()}
			<div class="flex items-center gap-2 p-2">
				<span class="loading loading-spinner loading-sm"></span>
				<span class="text-muted">Searching...</span>
			</div>
		{/snippet}
	</svelte:boundary>
{/if}

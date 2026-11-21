<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Free text in, new tags out: whatever is typed becomes a tag, lowercased.
	 * `suggestions` only autocompletes — it never constrains, so a value not on
	 * that list is still accepted. Use `Form/TagSelect` instead when the value has
	 * to come from a known set; that one cannot invent a tag and this one cannot
	 * refuse to.
	 */
	import { IconX } from '@tabler/icons-svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { uniqueTags } from '#lib/utils/unique-tags.js';

	let {
		value = $bindable<string[]>([]),
		suggestions = [],
		placeholder = m.ui_freeform_tag_input_placeholder(),
		name,
		field
	}: {
		value?: string[];
		suggestions?: string[];
		placeholder?: string;
		name?: string;
		/** The remote form field the JSON list submits as, in place of `name`. */
		field?: { as: (type: 'hidden', value: string) => Record<string, unknown> };
	} = $props();

	let input = $state('');
	let showSuggestions = $state(false);

	// Only addTag checks for a repeat; a list handed in can still hold one, so
	// the row and the submitted list both read this.
	const shown = $derived(uniqueTags(value));

	let filteredSuggestions = $derived(
		uniqueTags(
			input.length >= 1
				? suggestions
						.filter(
							(s) =>
								s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s.toLowerCase())
						)
						.slice(0, 8)
				: []
		)
	);

	function addTag(tag: string) {
		const normalized = tag.trim().toLowerCase();
		if (normalized && !value.includes(normalized)) {
			value = [...value, normalized];
		}
		input = '';
		showSuggestions = false;
	}

	function removeTag(tag: string) {
		value = value.filter((t) => t.toLowerCase() !== tag.toLowerCase());
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			if (input.trim()) addTag(input);
		} else if (e.key === 'Backspace' && !input && value.length > 0) {
			value = value.slice(0, -1);
		}
	}
</script>

{#if field}
	<input {...field.as('hidden', JSON.stringify(shown))} />
{:else if name}
	<input type="hidden" {name} value={JSON.stringify(shown)} />
{/if}

<div class="space-y-2 rounded bg-base-200 p-2">
	{#if shown.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each shown as tag (tag)}
				<Button variant="default" size="xs" type="button" onclick={() => removeTag(tag)}>
					{tag}
					<IconX class="size-3" />
				</Button>
			{/each}
		</div>
	{/if}

	<div class="relative">
		<input
			type="text"
			class="input w-full"
			{placeholder}
			bind:value={input}
			onkeydown={handleKeydown}
			onfocus={() => (showSuggestions = true)}
			onblur={() => setTimeout(() => (showSuggestions = false), 150)}
		/>

		{#if showSuggestions && filteredSuggestions.length > 0}
			<ul
				class="menu absolute z-10 max-h-40 w-full overflow-y-auto rounded-box bg-base-100 p-1 shadow-lg"
			>
				{#each filteredSuggestions as suggestion (suggestion)}
					<li>
						<button
							type="button"
							class="rounded-btn px-3 py-2"
							onmousedown={(e: MouseEvent) => {
								e.preventDefault();
								addTag(suggestion);
							}}
						>
							{suggestion}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

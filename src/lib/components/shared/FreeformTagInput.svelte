<script lang="ts">
	import { IconX } from '@tabler/icons-svelte';
	import Button from '$lib/components/shared/Button.svelte';

	let {
		value = $bindable<string[]>([]),
		suggestions = [],
		placeholder = 'Type and press Enter...',
		name
	}: {
		value?: string[];
		suggestions?: string[];
		placeholder?: string;
		name?: string;
	} = $props();

	let input = $state('');
	let showSuggestions = $state(false);

	let filteredSuggestions = $derived(
		input.length >= 1
			? suggestions
					.filter(
						(s) => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s.toLowerCase())
					)
					.slice(0, 8)
			: []
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
		value = value.filter((t) => t !== tag);
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

{#if name}
	<input type="hidden" {name} value={JSON.stringify(value)} />
{/if}

<div class="space-y-2 rounded bg-base-200 p-2">
	{#if value.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each value as tag (tag)}
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
				class="menu z-10 absolute w-full max-h-40 overflow-y-auto rounded-box bg-base-100 p-1 shadow-lg"
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

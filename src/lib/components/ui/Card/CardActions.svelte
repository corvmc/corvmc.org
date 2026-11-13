<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Slot 3 of the card grammar (ui-patterns, "Card grammar"): labelled buttons,
	 * full width, 44px, two to a row until the card is too narrow for two.
	 *
	 * The size is set here rather than trusted to each caller: a `size="xs"`
	 * passed in still renders at 44px, so no card can drift back to edge buttons.
	 */
	let { class: className = '', children }: { class?: string; children: Snippet } = $props();
</script>

<div
	class="card-action-row grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2 [&_.btn]:w-full [&_.btn]:[--btn-p:1rem] [&_.btn]:[--fontsize:.875rem] [&_.btn]:[--size:2.75rem] {className}"
>
	{@render children()}
</div>

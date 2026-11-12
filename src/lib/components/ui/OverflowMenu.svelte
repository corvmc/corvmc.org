<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import { IconDots } from '@tabler/icons-svelte';
	import { setButtonsAsMenuItems } from './Button.svelte';

	let {
		label = m.ui_overflow_menu_label(),
		icon,
		triggerClass = 'btn-ghost',
		class: className = '',
		children
	}: {
		/** The trigger's accessible name; it shows no text of its own. */
		label?: string;
		/** The trigger's glyph; ••• by default. */
		icon?: Snippet;
		/** The trigger's colour, and `join-item` for the half of a split button. */
		triggerClass?: string;
		class?: string;
		children: Snippet;
	} = $props();

	// Any Button or Action inside is a menu row, whatever variant it was written with.
	setButtonsAsMenuItems(true);
</script>

<details class="dropdown dropdown-end {className}">
	<summary class="btn btn-square btn-sm {triggerClass}" aria-label={label}>
		{#if icon}{@render icon()}{:else}<IconDots size={16} />{/if}
	</summary>
	<div class="dropdown-content dropdown-panel flex w-60 flex-col gap-1">
		{@render children()}
	</div>
</details>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { IconDots } from '@tabler/icons-svelte';
	import { setButtonsAsMenuItems } from './Button.svelte';

	let {
		label = 'More actions',
		children
	}: {
		/** The trigger's accessible name; it shows no text of its own. */
		label?: string;
		children: Snippet;
	} = $props();

	// Any Button or Action inside is a menu row, whatever variant it was written with.
	setButtonsAsMenuItems(true);
</script>

<details class="dropdown dropdown-end">
	<summary class="btn btn-square btn-ghost btn-sm" aria-label={label}>
		<IconDots size={16} />
	</summary>
	<div class="dropdown-content dropdown-panel flex w-60 flex-col gap-1">
		{@render children()}
	</div>
</details>

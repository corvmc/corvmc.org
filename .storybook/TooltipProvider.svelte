<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Snippet } from 'svelte';

	/**
	 * Mirrors the single `Tooltip.Provider` in `src/routes/+layout.svelte`.
	 *
	 * `Button` renders its `title` as a bits-ui tooltip, and `Tooltip.Root`
	 * throws outright without a provider above it — so any story containing a
	 * button with a tooltip failed to render, not merely looked wrong. Storybook
	 * mounts components outside the app's layout, so it has to reproduce the
	 * layout's global providers, the same way `preview.ts` imports the app's
	 * stylesheet.
	 */
	let { children }: { children: Snippet } = $props();
</script>

<Tooltip.Provider delayDuration={300}>
	{@render children()}
</Tooltip.Provider>

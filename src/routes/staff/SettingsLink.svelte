<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import { hasCapability } from '#lib/config.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';

	/** A module header's link to its settings page, for holders of `settings.read`. */
	let { href }: { href: string } = $props();

	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
</script>

{#if hasCapability(caps, 'settings.read')}
	<Button variant="ghost" size="sm" {href}>{m.staff_module_settings_label()}</Button>
{/if}

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { RemoteFormField, RemoteFormFieldValue } from '$app/server';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { capabilityLabel, everyCapability } from '#lib/capability-label.js';

	/**
	 * Rendered only for a staff-tier article, the tier its capabilities narrow.
	 * Below it the picker is left out, so nothing is submitted and the remote
	 * keeps what is stored (`[]` would clear it).
	 */
	let {
		field,
		audience,
		value = []
	}: {
		field: RemoteFormField<RemoteFormFieldValue>;
		audience: string | null | undefined;
		value?: readonly string[] | null;
	} = $props();

	// `admin` is the legacy staff value `normalizeAudience` maps up.
	const staffTier = $derived(audience === 'staff' || audience === 'admin');

	const options = everyCapability.flatMap((g) =>
		g.caps.map((cap) => ({ id: cap, label: capabilityLabel(cap) }))
	);
</script>

{#if staffTier}
	<FormField
		{field}
		type="tags"
		label={m.staff_help_capabilities_label()}
		description={m.staff_help_capabilities_description()}
		{options}
		value={[...(value ?? [])]}
	/>
{/if}

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { statusLabel } from '#lib/components/ui/StatusBadge.svelte';

	/** The same business's other applications to this market (#2822): flagged, never refused. */
	let {
		others
	}: {
		others: { id: string; status: string; tableLabel: string | null }[];
	} = $props();
</script>

{#if others.length > 0}
	<div class="text-sm text-warning" data-testid="also-applied">
		{m.market_also_applied_text()}
		{others
			.map((o) =>
				o.tableLabel
					? `${statusLabel(o.status)}, ${m.market_also_applied_table_text({ label: o.tableLabel })}`
					: statusLabel(o.status)
			)
			.join('; ')}
	</div>
{/if}

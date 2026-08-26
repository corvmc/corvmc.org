<script lang="ts">
	export type Fact = { label: string; value?: string | null };

	let { facts }: { facts: Fact[] } = $props();

	const shown = $derived(facts.filter((f) => f.value != null && String(f.value).trim() !== ''));
</script>

{#if shown.length > 0}
	<dl class="quick-facts">
		{#each shown as fact (fact.label)}
			<div class="quick-fact">
				<dt>{fact.label}</dt>
				<dd>{fact.value}</dd>
			</div>
		{/each}
	</dl>
{/if}

<style>
	.quick-facts {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
		margin: 0;
	}
	@media (max-width: 640px) {
		.quick-facts {
			grid-template-columns: 1fr 1fr;
		}
	}
	.quick-fact {
		border: 1px solid var(--surface-border);
		border-radius: var(--radius, 8px);
		background: var(--bg-section);
		padding: 8px 12px;
	}
	.quick-fact dt {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg-3);
		margin: 0 0 3px;
	}
	.quick-fact dd {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--fg-1);
	}
</style>

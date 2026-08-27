<script lang="ts">
	import { getAudienceOptions } from '$lib/remote/marketing.remote';

	/**
	 * The audience checkboxes and their recipient total, owning the query behind them.
	 *
	 * `getAudienceOptions` is an alias for `getAudiences`, which the audience mutations refresh by
	 * name. A campaign-keyed page query could not be refreshed from there, so this is a push-down
	 * rather than a compose — the same call as `CategoryOptions` in the equipment tranche.
	 *
	 * `total` is bindable because the page needs the number outside this markup: the send handler
	 * puts it in a confirm dialog.
	 */
	let {
		selected = $bindable<string[]>([]),
		total = $bindable(0)
	}: { selected?: string[]; total?: number } = $props();

	const audiences = $derived(await getAudienceOptions());

	const computed = $derived(
		audiences.filter((a) => selected.includes(a.id)).reduce((sum, a) => sum + a.subscriberCount, 0)
	);

	$effect(() => {
		total = computed;
	});

	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((a) => a !== id) : [...selected, id];
	}
</script>

<div class="flex flex-wrap gap-2">
	{#each audiences as a (a.id)}
		<label
			class="label cursor-pointer gap-2 rounded-lg border px-3 py-1.5 {selected.includes(a.id)
				? 'border-primary bg-primary/10'
				: 'border-base-300'}"
		>
			<input
				type="checkbox"
				class="checkbox checkbox-sm checkbox-primary"
				checked={selected.includes(a.id)}
				onchange={() => toggle(a.id)}
			/>
			<span class="text-sm">{a.name}</span>
			{#if a.systemKey}
				<span class="badge badge-xs badge-info">Built-in</span>
			{/if}
			<span class="text-subtle">({a.subscriberCount})</span>
		</label>
	{/each}
</div>
{#if selected.length > 0}
	<p class="mt-1 text-subtle">~{total} recipients (before deduplication)</p>
{/if}

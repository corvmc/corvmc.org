<script lang="ts">
	let {
		label,
		count,
		class: className = ''
	}: {
		label: string;
		count?: number | null;
		class?: string;
	} = $props();
</script>

<div class="sl {className}">
	{label}
	{#if count != null}
		<span class="sl__count">{count}</span>
	{/if}
</div>

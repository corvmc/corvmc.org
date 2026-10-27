<script lang="ts">
	import type { Crumb } from './breadcrumbs';

	let { crumbs, class: className = '' }: { crumbs: Crumb[]; class?: string } = $props();

	// At phone width only the last two show, behind an ellipsis, rather than wrapping.
	const collapses = $derived(crumbs.length > 2);
</script>

{#if crumbs.length > 0}
	<nav aria-label="Breadcrumb" class="breadcrumbs py-0 text-xs text-base-content/60 {className}">
		<ol>
			{#if collapses}
				<li class="sm:hidden" aria-hidden="true"><span class="cursor-default">…</span></li>
			{/if}
			{#each crumbs as crumb, i (i)}
				{@const last = i === crumbs.length - 1}
				<!-- The ellipsis is still the first child above `sm`, where it is hidden, so the
				     first real crumb drops the separator daisyUI draws after any `li`. -->
				<li
					class={[
						collapses && i < crumbs.length - 2 && 'max-sm:hidden',
						collapses && i === 0 && 'sm:before:hidden'
					]}
				>
					{#if crumb.href && !last}
						<a href={crumb.href}>{crumb.label}</a>
					{:else}
						<span
							class="cursor-default truncate {last ? 'text-base-content/80' : ''}"
							aria-current={last ? 'page' : undefined}>{crumb.label}</span
						>
					{/if}
				</li>
			{/each}
		</ol>
	</nav>
{/if}

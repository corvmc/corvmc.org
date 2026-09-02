<script lang="ts">
	/**
	 * Filter combinations this reader keeps.
	 *
	 * Its own query — the saved list is not keyed by the current filters, and
	 * `saveInboxView` / `removeInboxView` refresh it by name. Awaited here rather
	 * than in the page so the tabs above it paint first.
	 */
	import { IconX } from '@tabler/icons-svelte';
	import { getInboxSavedViews, removeInboxView } from '$lib/remote/inbox.remote';
	import { applySaved } from './filters.svelte';
</script>

{#await getInboxSavedViews() then views}
	{#if views.length}
		<div class="-mx-1 flex flex-wrap gap-1.5 px-1">
			{#each views as v (v.id)}
				<span class="badge gap-1 badge-ghost">
					<button
						type="button"
						class="cursor-pointer"
						onclick={() => applySaved(v.filters as Record<string, unknown>)}
					>
						{v.name}
					</button>
					<button
						type="button"
						class="cursor-pointer opacity-50 hover:opacity-100"
						aria-label="Remove {v.name}"
						onclick={() => removeInboxView(v.id)}
					>
						<IconX size={12} />
					</button>
				</span>
			{/each}
		</div>
	{/if}
{/await}

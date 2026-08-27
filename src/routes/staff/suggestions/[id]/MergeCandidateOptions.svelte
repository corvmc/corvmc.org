<script lang="ts">
	import { getMergeCandidates } from '$lib/remote/suggestions.remote';

	/**
	 * The merge target `<option>` list, owning its own query.
	 *
	 * On the page this query had to be declared *above* the awaits, because a `$derived` declared
	 * after one is compiled as "blocked" and `{#each await candidates}` then becomes
	 * `$.async(node, [blocker], [expression], …)` — the shape that crashes with
	 * `null is not an object (evaluating 'c.async_deriveds')` and takes the page down
	 * (JAVASCRIPT-SVELTEKIT-25, guarded by `async-effect-shape.spec.ts`).
	 *
	 * Here there is nothing to be blocked by: one query, no awaits above it. The page keeps its
	 * one load-bearing query and this stops being a hazard rather than a managed one.
	 */
	let { id }: { id: string } = $props();

	const candidates = $derived(await getMergeCandidates(id));
</script>

{#each candidates as c (c.id)}
	<option value={c.id}>{c.title} ({c.voteCount})</option>
{/each}

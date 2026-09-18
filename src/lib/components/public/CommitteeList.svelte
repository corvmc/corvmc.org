<script lang="ts">
	import { getPublicCommittees } from '$lib/remote/committees.remote';

	/**
	 * The committees and their remits, read from the `group` rows staff edit.
	 *
	 * Three surfaces described these: a literal array on `/contribute`, prose
	 * in the manual, and nothing at all on `/about` — which is the page the
	 * paper application points applicants at (#1167).
	 */
	let { class: className = '' }: { class?: string } = $props();

	const committees = $derived(await getPublicCommittees());
</script>

<ul class={className}>
	{#each committees as committee (committee.name)}
		<li>
			<strong>{committee.name}</strong>
			{#if committee.bio}
				— {committee.bio}
			{/if}
		</li>
	{/each}
</ul>

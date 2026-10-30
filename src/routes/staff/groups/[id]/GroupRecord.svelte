<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { GroupKind } from '$lib/config';
	import BandRecord from './BandRecord.svelte';
	import ClubRecord from './ClubRecord.svelte';
	import CommitteeRecord from './CommitteeRecord.svelte';

	// Each kind keeps the query, and so the guard, its own list had.
	let {
		kind,
		id,
		variant = 'page',
		actions
	}: { kind: GroupKind; id: string; variant?: 'page' | 'panel'; actions?: Snippet } = $props();
</script>

{#if kind === 'band'}
	<BandRecord {id} {variant} {actions} />
{:else if kind === 'club'}
	<ClubRecord {id} {variant} {actions} />
{:else}
	<CommitteeRecord {id} {variant} {actions} />
{/if}

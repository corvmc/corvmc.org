<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import type { RosterImportResult } from '$lib/types/roster-import';

	/**
	 * What the last roster import did with every address, so staff can see who
	 * was added, who was emailed, and which lines need fixing and re-pasting.
	 * Held in page state only: it is the answer to one submit, not a record.
	 */
	let { result, ondismiss }: { result: RosterImportResult; ondismiss: () => void } = $props();

	const rows = $derived([
		{ label: 'Added', hint: 'had an account, now active', emails: result.added },
		{ label: 'Invited', hint: 'no account, invitation emailed', emails: result.invited },
		{ label: 'Already members', hint: 'left as they were', emails: result.alreadyMembers },
		{
			label: 'Already invited',
			hint: 'invitation still live, not re-sent',
			emails: result.alreadyInvited
		}
	]);
</script>

<InfoCard title="Import results">
	{#snippet action()}
		<Button variant="ghost" size="sm" onclick={ondismiss}>Dismiss</Button>
	{/snippet}
	<DefinitionList>
		{#each rows as row (row.label)}
			<Fact label={row.label}>
				<span class="font-medium">{row.emails.length}</span>
				<span class="text-muted">· {row.hint}</span>
				{#if row.emails.length > 0}
					<details class="mt-1">
						<summary class="cursor-pointer text-xs text-fg-2">Show addresses</summary>
						<ul class="mt-1 font-mono text-xs break-all">
							{#each row.emails as email (email)}<li>{email}</li>{/each}
						</ul>
					</details>
				{/if}
			</Fact>
		{/each}
		<Fact label="Invalid">
			<span class="font-medium">{result.invalid.length}</span>
			{#if result.invalid.length > 0}
				<ul class="mt-1 text-xs">
					{#each result.invalid as bad, i (i)}
						<li><span class="font-mono break-all">{bad.entry}</span> — {bad.reason}</li>
					{/each}
				</ul>
			{/if}
		</Fact>
		{#if result.duplicates > 0}
			<Fact label="Duplicates" value="{result.duplicates} repeated, counted once" />
		{/if}
	</DefinitionList>
</InfoCard>

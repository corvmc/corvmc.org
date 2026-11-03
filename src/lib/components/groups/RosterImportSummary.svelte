<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { RosterImportResult } from '#lib/types/roster-import.js';

	/**
	 * What the last roster import did with every address, so staff can see who
	 * was added, who was emailed, and which lines need fixing and re-pasting.
	 * Held in page state only: it is the answer to one submit, not a record.
	 */
	let { result, ondismiss }: { result: RosterImportResult; ondismiss: () => void } = $props();

	const rows = $derived([
		{ label: m.groups_added(), hint: 'had an account, now active', emails: result.added },
		{
			label: m.groups_roster_import_summary_invited(),
			hint: 'no account, invitation emailed',
			emails: result.invited
		},
		{
			label: m.groups_roster_import_summary_already_members(),
			hint: 'left as they were',
			emails: result.alreadyMembers
		},
		{
			label: m.groups_roster_import_summary_already_invited(),
			hint: 'invitation still live, not re-sent',
			emails: result.alreadyInvited
		}
	]);
</script>

<InfoCard title={m.groups_roster_import_summary_title()}>
	{#snippet action()}
		<Button variant="ghost" size="sm" onclick={ondismiss}
			>{m.groups_roster_import_summary_dismiss()}</Button
		>
	{/snippet}
	<DefinitionList>
		{#each rows as row (row.label)}
			<Fact label={row.label}>
				<span class="font-medium">{row.emails.length}</span>
				<span class="text-muted">· {row.hint}</span>
				{#if row.emails.length > 0}
					<details class="mt-1">
						<summary class="cursor-pointer text-xs text-fg-2"
							>{m.groups_roster_import_summary_show_addresses()}</summary
						>
						<ul class="mt-1 font-mono text-xs break-all">
							{#each row.emails as email (email)}<li>{email}</li>{/each}
						</ul>
					</details>
				{/if}
			</Fact>
		{/each}
		<Fact label={m.groups_roster_import_summary_invalid()}>
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
			<Fact
				label={m.groups_roster_import_summary_duplicates()}
				value="{result.duplicates} repeated, counted once"
			/>
		{/if}
	</DefinitionList>
</InfoCard>

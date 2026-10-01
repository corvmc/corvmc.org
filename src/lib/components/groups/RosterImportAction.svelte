<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { ROSTER_IMPORT_MAX } from '$lib/config';
	import { importStaffGroupRoster } from '$lib/remote/groups.remote';
	import type { RosterImportResult } from '$lib/types/roster-import';

	/**
	 * Staff only: a pasted list or a CSV (a Zeffy export) onto a roster. An
	 * account is added active with nothing to accept; anyone else is emailed an
	 * invitation. `onresult` hands the per-address outcome to the page.
	 */
	let { groupId, onresult }: { groupId: string; onresult: (outcome: RosterImportResult) => void } =
		$props();

	const fields = importStaffGroupRoster.fields;
	const PLACEHOLDER = ['ada@example.com', 'bo@example.com'].join('\n');
</script>

<Action
	action={importStaffGroupRoster}
	label="Import emails"
	modalTitle="Import emails"
	submitLabel="Import"
	successToast="Import finished"
	variant="ghost"
	size="sm"
	onsuccess={(result) => {
		const { success: _, ...outcome } = result as RosterImportResult & { success: true };
		onresult(outcome);
		invalidateAll();
	}}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.groupId.as('hidden', groupId)} />
			<!-- The `input` snippet: `type="textarea"` drops `rows` and `placeholder`. -->
			<FormField
				field={fields.emails}
				label="Email addresses"
				description="One per line, or separated by commas or semicolons."
			>
				{#snippet input(id)}
					<textarea
						{id}
						{...fields.emails.as('text')}
						class="textarea w-full font-mono text-sm"
						rows="6"
						placeholder={PLACEHOLDER}></textarea>
				{/snippet}
			</FormField>
			<FormField
				field={fields.file}
				type="file"
				label="Or a CSV"
				accept=".csv,text/csv"
				emptyLabel="Choose a CSV"
				replaceLabel="Choose a different CSV"
				description="A Zeffy export works as is: the column whose header says “email” is used and the rest are ignored."
			/>
			<p class="text-subtle">
				Anyone with an account joins straight away, with nothing to accept. Everyone else is emailed
				an invitation. Up to {ROSTER_IMPORT_MAX} addresses at a time.
			</p>
		</div>
	{/snippet}
</Action>

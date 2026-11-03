<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
	label={m.groups_roster_import_import_emails()}
	modalTitle={m.groups_roster_import_import_emails()}
	submitLabel={m.groups_roster_import_submit_label()}
	successToast={m.groups_roster_import_success_toast()}
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
				label={m.groups_roster_import_email_addresses()}
				description={m.groups_roster_import_one_per_line_separated_by()}
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
				label={m.groups_roster_import_csv()}
				accept=".csv,text/csv"
				emptyLabel={m.groups_roster_import_empty_label()}
				replaceLabel={m.groups_roster_import_replace_label()}
				description={m.groups_roster_import_zeffy_export_works_as_column()}
			/>
			<p class="text-subtle">
				{m.groups_roster_import_anyone_with_account_joins_straight({ ROSTER_IMPORT_MAX })}
			</p>
		</div>
	{/snippet}
</Action>

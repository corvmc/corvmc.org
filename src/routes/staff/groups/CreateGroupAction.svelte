<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import { searchMembers } from '$lib/remote/reservations.remote';
	import { createStaffGroup } from '$lib/remote/groups.remote';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	/**
	 * The only door a club or committee comes through.
	 *
	 * A leader is picked here rather than invited afterwards: staff are recording
	 * an arrangement that already exists offline, so the owner row lands active
	 * with nothing for the appointee to accept. It is a required field for the
	 * same reason — a program created with an empty owner seat is a program
	 * nobody has been told they run.
	 *
	 * Synchronous script: `fields` is read at module scope, and the page above
	 * holds the awaited query.
	 */
	const fields = createStaffGroup.fields;

	let leader = $state<{ id: string; name: string; email: string } | null>(null);

	const kindOptions = [
		{ value: 'club', label: 'Club' },
		{ value: 'committee', label: 'Committee' }
	];
</script>

<Action
	action={createStaffGroup}
	label="New group"
	modalTitle="New group"
	submitLabel="Create group"
	successToast="Group created"
	size="sm"
	onsuccess={(result) => {
		const id = (result as { id?: string } | undefined)?.id;
		if (id) goto(resolve(`/staff/groups/${id}`));
	}}
>
	{#snippet form()}
		<div class="space-y-4">
			<FormField
				field={fields.kind}
				type="select"
				label="Kind"
				value="club"
				options={kindOptions}
				description="A club is a program members drop into; a committee does the Collective's work."
				required
			/>

			<FormField
				field={fields.name}
				type="text"
				label="Name"
				placeholder="Real Book Club"
				required
			/>

			<FormField
				field={fields.bio}
				type="textarea"
				label="What this program is"
				description="Shown on the group's public page and in the group directory."
			/>

			<fieldset class="fieldset">
				<legend class="fieldset-legend">Leader</legend>
				<SearchSelect
					search={searchMembers}
					bind:value={leader}
					name="leaderId"
					placeholder="Search by name or email..."
				/>
				<p class="text-subtle">
					They become the owner immediately — there is nothing for them to accept.
				</p>
			</fieldset>
		</div>
	{/snippet}
</Action>

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

			<!-- `FormField` with the remote field, not a raw fieldset with a plain
			     `name`: a remote form encodes its own field names, so the hidden
			     input arrived as nothing and Zod rejected `leaderId` with no
			     control to render the issue against — a toast about highlighted
			     fields, and nothing highlighted (#1019). -->
			<FormField
				name="leaderId"
				label="Leader"
				required
				description="They become the owner immediately — there is nothing for them to accept."
			>
				<SearchSelect
					search={searchMembers}
					bind:value={leader}
					field={fields.leaderId}
					placeholder="Search by name or email..."
				/>
			</FormField>
		</div>
	{/snippet}
</Action>

<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import { searchMembers } from '$lib/remote/reservations.remote';
	import { setStaffGroupRole } from '$lib/remote/groups.remote';
	import { invalidateAll } from '$app/navigation';

	/**
	 * Staff add a chair to a club or committee: any member, on the roster or not.
	 * Someone not on it joins active, with nothing to accept. Existing chairs
	 * keep their seats; a program may have several.
	 */
	let { groupId }: { groupId: string } = $props();

	const fields = setStaffGroupRole.fields;

	let chair = $state<{ id: string; name: string; email: string } | null>(null);
</script>

<Action
	action={setStaffGroupRole}
	label="Add chair"
	modalTitle="Add chair"
	submitLabel="Add chair"
	successToast="Chair added"
	variant="ghost"
	size="sm"
	onsuccess={() => invalidateAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.groupId.as('hidden', groupId)} />
			<input {...fields.role.as('hidden', 'admin')} />

			<FormField name="userId" label="Member" required>
				<SearchSelect
					search={searchMembers}
					bind:value={chair}
					field={fields.userId}
					placeholder="Search by name or email..."
				/>
			</FormField>

			<p class="text-subtle">
				Chairs run the program: they manage its roster, positions, announcements and applications.
			</p>
		</div>
	{/snippet}
</Action>

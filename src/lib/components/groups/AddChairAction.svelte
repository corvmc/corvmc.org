<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '#lib/components/ui/Form/SearchSelect.svelte';
	import { searchMembers } from '#lib/remote/reservations.remote.js';
	import { setStaffGroupRole } from '#lib/remote/groups.remote.js';
	import { refreshAll } from '$app/navigation';

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
	label={m.groups_add_chair_add_chair()}
	modalTitle={m.groups_add_chair_add_chair()}
	submitLabel={m.groups_add_chair_add_chair()}
	successToast={m.groups_add_chair_success_toast()}
	variant="ghost"
	size="sm"
	onsuccess={() => refreshAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.groupId.as('hidden', groupId)} />
			<input {...fields.role.as('hidden', 'admin')} />

			<FormField field={setStaffGroupRole.fields.userId} label={m.groups_member()} required>
				<SearchSelect
					search={searchMembers}
					bind:value={chair}
					field={fields.userId}
					placeholder={m.groups_search_by_name_email()}
				/>
			</FormField>

			<p class="text-subtle">
				{m.groups_add_chair_chairs_run_program_they_manage()}
			</p>
		</div>
	{/snippet}
</Action>

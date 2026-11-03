<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '#lib/components/ui/Form/SearchSelect.svelte';
	import { searchMembers } from '#lib/remote/reservations.remote.js';
	import { grantInstructor } from '#lib/remote/instructors.remote.js';
	import { invalidateAll } from '$app/navigation';

	/**
	 * Grant teaching status to a member who never applied — the staffer already
	 * knows them. Also the way back from paused or retired, because reinstating
	 * and granting are the same decision made twice.
	 */
	const fields = grantInstructor.fields;

	let member = $state<{ id: string; name: string; email: string } | null>(null);
</script>

<Action
	action={grantInstructor}
	label={m.staff_members_instructors_grant_instructor_add_instructor()}
	modalTitle={m.staff_members_instructors_grant_instructor_add_instructor()}
	submitLabel={m.staff_grant()}
	successToast={m.staff_members_instructors_grant_instructor_success_toast()}
	variant="primary"
	size="sm"
	onsuccess={() => invalidateAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<FormField name="userId" label={m.staff_member()} required>
				<SearchSelect
					search={searchMembers}
					bind:value={member}
					field={fields.userId}
					placeholder={m.staff_search_by_name_email()}
				/>
			</FormField>

			<p class="text-subtle">
				{m.staff_members_instructors_grant_instructor_they_can_book_roo()}
			</p>
		</div>
	{/snippet}
</Action>

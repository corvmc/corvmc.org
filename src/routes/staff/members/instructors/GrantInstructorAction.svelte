<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { getReservationPolicy } from '#lib/remote/reservations.remote.js';
	import { formatCents } from '#lib/utils/format.js';
	import { errorMessage } from '#lib/error-message.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '#lib/components/ui/Form/SearchSelect.svelte';
	import { grantInstructor, searchMembersToGrant } from '#lib/remote/instructors.remote.js';
	import { refreshAll } from '$app/navigation';

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
	label={m.staff_members_instructors_grant_instructor_add_instructor_label()}
	modalTitle={m.staff_members_instructors_grant_instructor_add_instructor_title()}
	submitLabel={m.staff_grant_label()}
	successToast={m.staff_members_instructors_grant_instructor_success_toast()}
	variant="primary"
	size="sm"
	onsuccess={() => refreshAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<FormField field={grantInstructor.fields.userId} label={m.staff_member_label()} required>
				<SearchSelect
					search={searchMembersToGrant}
					bind:value={member}
					field={fields.userId}
					placeholder={m.staff_search_by_name_email_placeholder()}
				/>
			</FormField>

			<p class="text-subtle">
				{#await getReservationPolicy('instructor') then teaching}{m.staff_members_instructors_grant_instructor_they_can_book_roo_text(
						{ rate: formatCents(teaching.hourlyRateCents) }
					)}{:catch error}{m.ui_load_failed_body({ error: errorMessage(error) })}{/await}
			</p>
		</div>
	{/snippet}
</Action>

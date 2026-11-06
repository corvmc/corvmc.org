<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { updateStaffGroup } from '#lib/remote/groups.remote.js';
	import { refreshAll } from '$app/navigation';

	/**
	 * How this program is found and joined. Two settings, one form, because they
	 * are the same decision from two sides: whether people can see it, and what
	 * happens when they try to get in.
	 *
	 * Fully synchronous, and the page above passes resolved props — a top-level
	 * await here would mark every `fields.X` expression below "blocked" and
	 * compile it into an async derived.
	 */
	let {
		groupId,
		joinPolicy,
		joinInstructions,
		visibility,
		policyFixed = false
	}: {
		groupId: string;
		joinPolicy: string;
		joinInstructions: string | null;
		visibility: string;
		/** Committees all take applications (#1700): the policy is shown, not edited. */
		policyFixed?: boolean;
	} = $props();

	const fields = updateStaffGroup.fields;

	const policyOptions = [
		{ value: 'invite_only', label: m.groups_invite_only_someone_adds() },
		{ value: 'open', label: m.groups_open_any_member_joins_themselves() },
		{ value: 'by_application', label: m.groups_by_application_ask_chair_approves() }
	];

	const visibilityOptions = [
		{ value: 'public', label: m.groups_public_anyone_can_find() },
		{ value: 'members', label: m.groups_members_signed_members_only() },
		{ value: 'hidden', label: m.groups_hidden_not_listed_anywhere() }
	];
</script>

<InfoCard title={m.groups_group_settings_form_title()}>
	<Form
		remote={updateStaffGroup}
		guard
		successToast={m.groups_saved()}
		onsuccess={() => refreshAll()}
	>
		<input {...fields.groupId.as('hidden', groupId)} />

		<div class="space-y-4">
			{#if policyFixed}
				<input {...fields.joinPolicy.as('hidden', joinPolicy)} />
				<p class="text-sm text-fg-2">
					{policyOptions.find((o) => o.value === joinPolicy)?.label ?? joinPolicy}
				</p>
			{:else}
				<FormField
					field={fields.joinPolicy}
					type="select"
					label={m.groups_group_settings_form_how_people_join()}
					value={joinPolicy}
					options={policyOptions}
					description={m.groups_group_settings_form_invitations_work_same_way_under()}
				/>
			{/if}

			<FormField
				field={fields.joinInstructions}
				type="textarea"
				label={m.groups_group_settings_form_joining_instructions()}
				value={joinInstructions ?? ''}
				description={m.groups_group_settings_form_shown_beside_join_button_over()}
			/>

			<FormField
				field={fields.visibility}
				type="select"
				label={m.groups_visibility()}
				value={visibility}
				options={visibilityOptions}
			/>

			<div class="flex justify-end">
				<SubmitButton label={m.groups_save()} />
			</div>
		</div>
	</Form>
</InfoCard>

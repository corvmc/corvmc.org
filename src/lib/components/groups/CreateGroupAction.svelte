<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '#lib/components/ui/Form/SearchSelect.svelte';
	import { searchMembers } from '#lib/remote/reservations.remote.js';
	import { createStaffGroup } from '#lib/remote/groups.remote.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	/**
	 * The only door a club or committee comes through.
	 *
	 * A first chair is picked here rather than invited: staff are recording an
	 * arrangement that exists offline, so they land as an active admin with
	 * nothing to accept. Optional: more chairs are added from the group's page.
	 */
	// Synchronous script: `fields` is read at module scope, and the page above
	// holds the awaited query.
	const fields = createStaffGroup.fields;

	/** Which kind the form starts on: the page it is opened from. */
	let { kind = 'club' }: { kind?: 'club' | 'committee' } = $props();

	let chair = $state<{ id: string; name: string; email: string } | null>(null);

	const kindOptions = [
		{ value: 'club', label: m.groups_create_group_club() },
		{ value: 'committee', label: m.groups_create_group_committee() }
	];

	// Same wording as GroupSettingsForm, which is the other writer of both.
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

	let selectedKind = $state(kind);
	let joinPolicy = $state('invite_only');
	// Committees all join by application (#1700), so a committee is not asked.
	const showsInstructions = $derived(selectedKind === 'committee' || joinPolicy !== 'invite_only');
</script>

<Action
	action={createStaffGroup}
	label={kind === 'committee'
		? m.groups_create_group_new_committee()
		: m.groups_create_group_new_club()}
	modalTitle={kind === 'committee'
		? m.groups_create_group_new_committee()
		: m.groups_create_group_new_club()}
	submitLabel={kind === 'committee'
		? m.groups_create_group_create_committee()
		: m.groups_create_group_create_club()}
	successToast={kind === 'committee'
		? m.groups_create_group_committee_created()
		: m.groups_create_group_club_created()}
	size="sm"
	data-testid="create-group"
	onsuccess={(result) => {
		const made = result as { id?: string } | undefined;
		if (made?.id) goto(resolve(`staff/groups/${made.id}`));
	}}
>
	{#snippet form()}
		<div class="space-y-4">
			<FormField
				field={fields.kind}
				type="select"
				label={m.groups_create_group_kind()}
				bind:value={selectedKind}
				options={kindOptions}
				description={m.groups_create_group_club_program_members_drop_into()}
				required
			/>

			<FormField
				field={fields.name}
				type="text"
				label={m.groups_create_group_name()}
				placeholder={m.groups_create_group_real_book_club()}
				required
			/>

			<FormField
				field={fields.bio}
				type="textarea"
				label={m.groups_create_group_what_program()}
				description={m.groups_create_group_shown_group_s_public_page()}
			/>

			<!-- Asked at creation, not left to the column defaults: those make a
			     group public and invite-only at once, so it is advertised and
			     unjoinable until someone finds the settings form (#1106). -->
			{#if selectedKind === 'committee'}
				<input {...fields.joinPolicy.as('hidden', 'by_application')} />
				<p class="text-muted">{m.groups_create_group_committees_take_members_by_application()}</p>
			{:else}
				<FormField
					field={fields.joinPolicy}
					type="select"
					label={m.groups_create_group_who_can_join()}
					bind:value={joinPolicy}
					options={policyOptions}
					required
				/>
			{/if}

			{#if showsInstructions}
				<FormField
					field={fields.joinInstructions}
					type="textarea"
					label={m.groups_create_group_how_works()}
					placeholder={m.groups_create_group_third_thursday_7pm_bring_horn()}
					description={m.groups_create_group_shown_beside_join_button_chair()}
				/>
			{/if}

			<FormField
				field={fields.visibility}
				type="select"
				label={m.groups_visibility()}
				value="public"
				options={visibilityOptions}
				required
			/>

			<!-- `FormField` with the remote field, not a raw fieldset with a plain
			     `name`: a remote form encodes its own field names, so the hidden
			     input arrived as nothing and Zod rejected the field with no
			     control to render the issue against — a toast about highlighted
			     fields, and nothing highlighted (#1019). -->
			<FormField
				field={createStaffGroup.fields.chairId}
				label={m.groups_create_group_chair()}
				description={m.groups_create_group_they_become_chair_immediately_there()}
			>
				<SearchSelect
					search={searchMembers}
					bind:value={chair}
					field={fields.chairId}
					placeholder={m.groups_search_by_name_email()}
				/>
			</FormField>
		</div>
	{/snippet}
</Action>

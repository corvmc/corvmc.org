<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { onDestroy } from 'svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import {
		inviteGroupByEmail,
		inviteGroupMember,
		searchGroupUsers
	} from '$lib/remote/groups.remote';

	/**
	 * The door an `invite_only` group did not have.
	 *
	 * Two triggers rather than a mode switch inside one modal: each `Action`
	 * owns its modal, so flipping between them would unmount the dialog the
	 * leader was typing in.
	 */
	let { slug, groupName, onchanged }: { slug: string; groupName: string; onchanged: () => void } =
		$props();

	const memberFields = inviteGroupMember.fields;
	const emailFields = inviteGroupByEmail.fields;

	let searchQuery = $state('');
	let results = $state<{ id: string; name: string; email: string }[]>([]);
	let selected = $state<{ id: string; name: string; email: string } | null>(null);
	let searching = $state(false);
	let debounce: ReturnType<typeof setTimeout>;

	const roleOptions = [
		{ value: 'member', label: m.groups_member() },
		{ value: 'admin', label: m.groups_admin() }
	];

	async function search() {
		if (searchQuery.trim().length < 2) {
			results = [];
			return;
		}
		searching = true;
		results = await searchGroupUsers({ slug, q: searchQuery }).catch(() => []);
		searching = false;
	}

	function onInput(e: Event) {
		searchQuery = (e.target as HTMLInputElement).value;
		selected = null;
		clearTimeout(debounce);
		debounce = setTimeout(search, 300);
	}

	function reset() {
		searchQuery = '';
		results = [];
		selected = null;
		onchanged();
	}

	onDestroy(() => clearTimeout(debounce));
</script>

<Action
	action={inviteGroupMember}
	label={m.groups_invite_group_member_invite()}
	aria-label={m.groups_invite_group_member_invite_someone({ groupName })}
	modalTitle={m.groups_invite_group_member_invite_2({ groupName })}
	submitLabel={m.groups_invite_group_member_submit_label()}
	successToast={m.groups_invite_group_member_success_toast()}
	variant="primary"
	size="sm"
	onsuccess={reset}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...memberFields.slug.as('hidden', slug)} />
			<input {...memberFields.userId.as('hidden', selected?.id ?? '')} />

			<FormField
				label={m.groups_invite_group_member_who()}
				type="text"
				value={searchQuery}
				oninput={onInput}
				autocomplete="off"
				placeholder={m.groups_invite_group_member_search_members_by_name_email()}
				description={selected
					? m.groups_invite_group_member_inviting({ name: selected.name })
					: m.groups_invite_group_member_pick_somebody_from_results()}
			/>

			{#if searching}
				<p class="text-subtle">{m.groups_invite_group_member_searching()}</p>
			{:else if results.length > 0}
				<ul class="menu w-full rounded-box bg-base-200">
					{#each results as candidate (candidate.id)}
						<li>
							<button type="button" onclick={() => ((selected = candidate), (results = []))}>
								<span class="font-medium">{candidate.name}</span>
								<span class="text-subtle">{candidate.email}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else if searchQuery.trim().length >= 2}
				<p class="text-subtle">
					{m.groups_invite_group_member_nobody_with_account_by_name()}
				</p>
			{/if}

			<FormField
				field={memberFields.role}
				type="select"
				label={m.groups_role()}
				value="member"
				options={roleOptions}
			/>
			<FormField
				field={memberFields.position}
				type="text"
				label={m.groups_position()}
				maxlength="100"
				placeholder={m.groups_invite_group_member_optional()}
			/>
		</div>
	{/snippet}
</Action>

<!-- Its own trigger, because somebody with no account has no row to search for
     — this writes a `group_invite` that resolves when they sign up. -->
<Action
	action={inviteGroupByEmail}
	label={m.groups_invite_group_member_invite_by_email()}
	aria-label={m.groups_invite_group_member_invite_someone_by_email({ groupName })}
	modalTitle={m.groups_invite_group_member_invite_by_email_2({ groupName })}
	submitLabel={m.groups_invite_group_member_submit_label()}
	successToast={m.groups_invite_group_member_success_toast()}
	variant="default"
	size="sm"
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...emailFields.slug.as('hidden', slug)} />
			<FormField
				field={emailFields.email}
				type="email"
				label={m.groups_invite_group_member_email()}
				placeholder={m.groups_invite_group_member_them_example_com()}
				description={m.groups_invite_group_member_they_join_roster_when_they()}
				required
			/>
			<FormField
				field={emailFields.role}
				type="select"
				label={m.groups_role()}
				value="member"
				options={roleOptions}
			/>
			<FormField
				field={emailFields.position}
				type="text"
				label={m.groups_position()}
				maxlength="100"
				placeholder={m.groups_invite_group_member_optional()}
			/>
		</div>
	{/snippet}
</Action>

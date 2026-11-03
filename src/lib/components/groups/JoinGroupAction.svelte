<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { joinGroupForm } from '#lib/remote/groups.remote.js';
	import { applyToGroups } from '#lib/remote/group-applications.remote.js';
	import { groupApplicationQuestions } from '#lib/config.js';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';

	/**
	 * One control for both self-service doors, mounted on the member index and
	 * the public group page.
	 *
	 * `open` joins. `by_application` applies: a club in a dialog here, a
	 * committee in the member Groups page's dialog, where one application can name
	 * several. The services re-read the policy, so this only picks the door.
	 */
	let {
		groupId,
		groupName,
		slug,
		kind,
		policy,
		instructions
	}: {
		groupId: string;
		groupName: string;
		slug: string;
		kind: string;
		policy: 'open' | 'by_application';
		instructions: string | null;
	} = $props();

	const joinFields = joinGroupForm.fields;
	const applyForm = $derived(applyToGroups.for(groupId));
	const notePrompt = groupApplicationQuestions.club[0].prompt;
</script>

<!-- `aria-label` names the group: the discovery list renders one per card, and
     "Join", "Join", "Apply" alone gives a screen reader nothing to tell apart. -->
{#if policy === 'open'}
	<Action
		action={joinGroupForm}
		label={m.groups_join_2()}
		aria-label={m.groups_join({ groupName })}
		modalTitle={m.groups_join({ groupName })}
		submitLabel={m.groups_join_2()}
		successToast={m.groups_join_group_have_joined()}
		variant="primary"
		size="sm"
		onsuccess={() => invalidateAll()}
	>
		{#snippet form()}
			<div class="space-y-3">
				<input {...joinFields.groupId.as('hidden', groupId)} />
				{#if instructions}
					<p class="text-sm">{instructions}</p>
				{/if}
				<p class="text-subtle">
					{m.groups_join_group_will_member_straight_away_no()}
				</p>
			</div>
		{/snippet}
	</Action>
{:else if kind === 'committee'}
	<Button
		href={withQuery(resolve('/member/groups'), new URLSearchParams({ committee: slug }))}
		variant="primary"
		size="sm"
		aria-label={m.groups_join_group_apply({ groupName })}
	>
		{m.groups_join_group_apply_2()}
	</Button>
{:else}
	<Action
		action={applyForm}
		label={m.groups_join_group_apply_2()}
		aria-label={m.groups_join_group_apply({ groupName })}
		modalTitle={m.groups_join_group_apply({ groupName })}
		submitLabel={m.groups_join_group_send_application()}
		successToast={m.groups_join_group_application_sent()}
		variant="primary"
		size="sm"
		onsuccess={() => invalidateAll()}
	>
		{#snippet form()}
			<div class="space-y-3">
				<input {...applyForm.fields.groupIds[0].as('hidden', groupId)} />
				{#if instructions}
					<!-- The group's own words: the prompt over the box, where it earns the most. -->
					<p class="text-sm">{instructions}</p>
				{/if}
				<FormField field={applyForm.fields.note} type="textarea" label={notePrompt} />
				<p class="text-subtle">
					{m.groups_join_group_group_s_chairs_will_see()}
				</p>
			</div>
		{/snippet}
	</Action>
{/if}

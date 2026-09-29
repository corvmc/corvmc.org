<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { joinGroupForm } from '$lib/remote/groups.remote';
	import { applyToGroups } from '$lib/remote/group-applications.remote';
	import { groupApplicationQuestions } from '$lib/config';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';

	/**
	 * One control for both self-service doors, mounted on the member index and
	 * the public group page.
	 *
	 * `open` joins. `by_application` applies: a club in a dialog here, a
	 * committee on the committee apply page, where one application can name
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
		label="Join"
		aria-label={`Join ${groupName}`}
		modalTitle={`Join ${groupName}`}
		submitLabel="Join"
		successToast="You have joined"
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
					You will be a member straight away — no approval, and you can leave whenever you like.
				</p>
			</div>
		{/snippet}
	</Action>
{:else if kind === 'committee'}
	<Button
		href={withQuery(
			resolve('/member/volunteer/committees'),
			new URLSearchParams({ committee: slug })
		)}
		variant="primary"
		size="sm"
		aria-label={`Apply to ${groupName}`}
	>
		Apply
	</Button>
{:else}
	<Action
		action={applyForm}
		label="Apply"
		aria-label={`Apply to ${groupName}`}
		modalTitle={`Apply to ${groupName}`}
		submitLabel="Send application"
		successToast="Application sent"
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
					The group's leaders will see your application and answer it. You are not a member until
					they invite you and you accept.
				</p>
			</div>
		{/snippet}
	</Action>
{/if}

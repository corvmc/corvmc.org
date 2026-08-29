<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { joinGroupForm } from '$lib/remote/groups.remote';
	import { invalidateAll } from '$app/navigation';

	/**
	 * One control for both self-service doors.
	 *
	 * Which door a group opens is the group's own fact: the service re-reads
	 * `joinPolicy` from the resolved group rather than trusting anything here, so
	 * the only thing this component decides is what the button says.
	 */
	let {
		groupId,
		groupName,
		policy,
		instructions
	}: {
		groupId: string;
		groupName: string;
		policy: 'open' | 'by_application';
		instructions: string | null;
	} = $props();

	const fields = joinGroupForm.fields;

	const isApplication = $derived(policy === 'by_application');
</script>

<Action
	action={joinGroupForm}
	label={isApplication ? 'Apply' : 'Join'}
	modalTitle={isApplication ? `Apply to ${groupName}` : `Join ${groupName}`}
	submitLabel={isApplication ? 'Send application' : 'Join'}
	successToast={isApplication ? 'Application sent' : 'You have joined'}
	variant="primary"
	size="sm"
	onsuccess={() => invalidateAll()}
>
	{#snippet form()}
		<div class="space-y-3">
			<input {...fields.groupId.as('hidden', groupId)} />

			{#if instructions}
				<!-- The group's own words. Under `open` this is the practical note
				     beside the button; under `by_application` it is the prompt over
				     the box, which is where it earns the most. -->
				<p class="text-sm">{instructions}</p>
			{/if}

			<p class="text-subtle">
				{#if isApplication}
					An owner or admin will see your request and answer it. You are not a member until they do.
				{:else}
					You will be a member straight away — no approval, and you can leave whenever you like.
				{/if}
			</p>
		</div>
	{/snippet}
</Action>

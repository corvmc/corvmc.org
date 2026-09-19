<script lang="ts">
	/**
	 * Open a named topic. Any active member, like posting — a room the whole
	 * group reads is not an admin's to ration.
	 */
	import { goto } from '$app/navigation';
	import { IconPlus } from '@tabler/icons-svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { createGroupChatTopic } from '$lib/remote/group-chat.remote';

	let { slug, hrefFor }: { slug: string; hrefFor?: (threadId: string) => string } = $props();

	const action = $derived(createGroupChatTopic.for(slug));
</script>

<Action
	{action}
	label="New topic"
	iconOnly
	modalTitle="New topic"
	submitLabel="Create"
	successToast="Topic created"
	variant="ghost"
	size="xs"
	onsuccess={async (result) => {
		const { threadId } = (result ?? {}) as { threadId?: string };
		if (threadId && hrefFor) await goto(hrefFor(threadId));
	}}
>
	{#snippet icon()}<IconPlus size={16} />{/snippet}
	{#snippet form()}
		{@const fields = createGroupChatTopic.for(slug).fields}
		<div class="space-y-3">
			<input {...fields.slug.as('hidden', slug)} />
			<FormField
				field={fields.subject}
				label="What is it about?"
				description="Everyone in the group reads every topic. This just keeps one conversation out of another."
			/>
		</div>
	{/snippet}
</Action>

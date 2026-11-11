<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Open a named topic. Any active member, like posting — a room the whole
	 * group reads is not an admin's to ration.
	 */
	import { goto } from '$app/navigation';
	import { IconPlus } from '@tabler/icons-svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { createGroupChatTopic } from '#lib/remote/group-chat.remote.js';

	let { slug, hrefFor }: { slug: string; hrefFor?: (threadId: string) => string } = $props();

	const action = $derived(createGroupChatTopic.for(slug));
</script>

<Action
	{action}
	label={m.inbox_new_topic_new_topic_label()}
	iconOnly
	modalTitle={m.inbox_new_topic_new_topic_title()}
	submitLabel={m.inbox_new_topic_submit_label()}
	successToast={m.inbox_new_topic_success_toast()}
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
				label={m.inbox_new_topic_what_about_label()}
				description={m.inbox_new_topic_description_body()}
			/>
		</div>
	{/snippet}
</Action>

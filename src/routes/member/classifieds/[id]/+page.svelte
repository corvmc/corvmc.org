<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import PostDetail from '$lib/components/classified/PostDetail.svelte';
	import EditClassifiedAction from './EditClassifiedAction.svelte';
	import MessageMemberAction from '$lib/components/actions/MessageMemberAction.svelte';
	import { EntityChip } from '$lib/components/ui/entity';
	import { IconFlag, IconRefresh, IconCircleCheck } from '@tabler/icons-svelte';
	import {
		getClassifiedDetail,
		renewClassified,
		closeClassified,
		reportClassified
	} from '$lib/remote/classifieds.remote';

	const id = $derived(page.params.id!);
	const post = $derived(await getClassifiedDetail(id));
	const open = $derived(post.displayStatus === 'open');

	function refresh() {
		void getClassifiedDetail(id).refresh();
	}

	// Only the author and staff reach a post in these states; everyone else gets a 404.
	const withheldCopy: Record<string, string> = {
		pending_review: 'This is waiting for staff before it goes on the board. Only you can see it.',
		under_review:
			'Someone reported this, so it is off the board while staff look. If they dismiss the report, it goes straight back up.',
		hidden: 'Staff took this off the board. Edit it and it goes back to them for another look.',
		closed: 'You closed this post. It is no longer on the board.',
		expired: 'This post has expired. Renew it to put it back on the board.'
	};
</script>

<PageHeader width="3xl" title={post.title} subtitle="Classifieds" backHref="/member/classifieds">
	{#if post.isMine}
		{#if post.status === 'open'}
			<EditClassifiedAction {post} onsuccess={refresh} />
		{/if}
		{#if post.status === 'open' && post.visibility !== 'hidden'}
			<Action
				action={renewClassified}
				label="Renew"
				modalTitle="Renew this post?"
				successToast="Renewed"
				variant="ghost"
				size="sm"
				onsuccess={refresh}
			>
				{#snippet icon()}<IconRefresh size={16} />{/snippet}
				{#snippet form()}
					<input {...renewClassified.fields.postId.as('hidden', post.id)} />
					<p class="py-2">It will stay up for another 30 days from today.</p>
				{/snippet}
			</Action>
			<Action
				action={closeClassified}
				label="Close"
				modalTitle="Close this post?"
				successToast="Closed"
				variant="ghost"
				size="sm"
				onsuccess={refresh}
			>
				{#snippet icon()}<IconCircleCheck size={16} />{/snippet}
				{#snippet form()}
					<input {...closeClassified.fields.postId.as('hidden', post.id)} />
					<p class="py-2">
						Filled, or no longer needed? It comes off the board and stays in your posts.
					</p>
				{/snippet}
			</Action>
		{/if}
	{:else if open}
		{#if post.canMessage}
			<MessageMemberAction
				recipientId={post.authorUserId}
				recipientName={post.authorName ?? 'the author'}
			/>
		{/if}
		<Action
			action={reportClassified}
			label="Report"
			iconOnly
			modalTitle="Report this post"
			submitLabel="Send report"
			successToast="Reported. Staff will take a look"
			variant="ghost"
			size="sm"
			onsuccess={refresh}
		>
			{#snippet icon()}<IconFlag size={16} />{/snippet}
			{#snippet form()}
				<input {...reportClassified.fields.postId.as('hidden', post.id)} />
				<p class="mb-3 text-muted">
					This takes the post off the board while staff look. If they disagree, it goes back up.
				</p>
				<FormField name="reason" type="text" label="What's the problem?" />
				<FormField name="description" type="textarea" label="Anything else? (optional)" />
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if !open && withheldCopy[post.displayStatus]}
		<Alert type={post.visibility === 'hidden' ? 'error' : 'warning'}>
			<p>
				{withheldCopy[post.displayStatus]}
				{#if post.visibilityNote}
					Staff's note: <span class="italic">{post.visibilityNote}</span>
				{/if}
			</p>
		</Alert>
	{/if}

	{#if !post.isMine && open && !post.canMessage}
		<Alert type="info">
			<p>To answer this, get in touch through <EntityChip ref={post.band ?? post.author} />.</p>
		</Alert>
	{/if}

	<PostDetail {post} />
</PageContent>

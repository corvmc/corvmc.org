<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { page } from '$app/state';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import PostDetail from '#lib/components/classified/PostDetail.svelte';
	import EditClassifiedAction from './EditClassifiedAction.svelte';
	import MessageMemberAction from '#lib/components/actions/MessageMemberAction.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import { IconFlag, IconRefresh, IconCircleCheck } from '@tabler/icons-svelte';
	import {
		getClassifiedDetail,
		renewClassified,
		closeClassified,
		reportClassified
	} from '#lib/remote/classifieds.remote.js';

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

<PageHeader width="3xl" title={post.title} subtitle={m.member_classifieds()}>
	{#if post.isMine}
		{#if post.status === 'open'}
			<EditClassifiedAction {post} onsuccess={refresh} />
		{/if}
		{#if post.status === 'open' && post.visibility !== 'hidden'}
			<Action
				action={renewClassified}
				label={m.member_classifieds_id_renew()}
				modalTitle={m.member_classifieds_id_renew_post()}
				successToast={m.member_classifieds_id_renewed()}
				variant="ghost"
				size="sm"
				onsuccess={refresh}
			>
				{#snippet icon()}<IconRefresh size={16} />{/snippet}
				{#snippet form()}
					<input {...renewClassified.fields.postId.as('hidden', post.id)} />
					<p class="py-2">{m.member_classifieds_id_will_stay_up_another_30()}</p>
				{/snippet}
			</Action>
			<Action
				action={closeClassified}
				label={m.member_classifieds_id_close()}
				modalTitle={m.member_classifieds_id_close_post()}
				successToast={m.member_classifieds_id_closed()}
				variant="ghost"
				size="sm"
				onsuccess={refresh}
			>
				{#snippet icon()}<IconCircleCheck size={16} />{/snippet}
				{#snippet form()}
					<input {...closeClassified.fields.postId.as('hidden', post.id)} />
					<p class="py-2">
						{m.member_classifieds_id_filled_no_longer_needed_comes()}
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
			label={m.member_report()}
			iconOnly
			modalTitle={m.member_classifieds_id_report_post()}
			submitLabel={m.member_send_report()}
			successToast={m.member_classifieds_id_reported_staff_will_take_look()}
			variant="ghost"
			size="sm"
			onsuccess={refresh}
		>
			{#snippet icon()}<IconFlag size={16} />{/snippet}
			{#snippet form()}
				<input {...reportClassified.fields.postId.as('hidden', post.id)} />
				<p class="mb-3 text-muted">
					{m.member_classifieds_id_takes_post_off_board_while()}
				</p>
				<FormField name="reason" type="text" label={m.member_what_s_problem()} />
				<FormField name="description" type="textarea" label={m.member_anything_else_optional()} />
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
					<ParaglideMessage
						message={m.member_staff_s_note}
						inputs={{ visibilityNote: post.visibilityNote }}
						>{#snippet span({ children })}<span class="italic">{@render children?.()}</span
							>{/snippet}</ParaglideMessage
					>
				{/if}
			</p>
		</Alert>
	{/if}

	{#if !post.isMine && open && !post.canMessage}
		<Alert type="info">
			<p>
				{m.member_classifieds_id_answer_get_touch_through()}
				<EntityChip ref={post.band ?? post.author} />.
			</p>
		</Alert>
	{/if}

	<PostDetail {post} />
</PageContent>

<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import AppealPanel from '$lib/components/moderation/AppealPanel.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import BallotLine from '$lib/components/ballot/BallotLine.svelte';
	import { IconFlag, IconCaretUpFilled, IconPencil } from '@tabler/icons-svelte';
	import { formatDateTime } from '$lib/utils/format';
	import { suggestionCategories, suggestionCategoryLabels } from '$lib/config';
	import {
		getMemberSuggestionDetailPage,
		toggleSuggestionVote,
		flagSuggestion,
		editSuggestion,
		cancelSuggestionEdit
	} from '$lib/remote/suggestions.remote';

	let id = $derived(page.params.id!);
	const data = $derived(await getMemberSuggestionDetailPage(id));
	const s = $derived(data.suggestion);
	const standing = $derived(data.standing);
	const editState = $derived(data.editState);
	const project = $derived(data.project);
	const ballots = $derived(data.ballots);

	const isMine = $derived(s.authorUserId === standing.viewerUserId);
	let vote = $derived(toggleSuggestionVote.for(s.id));
	let flag = $derived(flagSuggestion.for(s.id));

	function refresh() {
		void getMemberSuggestionDetailPage(id).refresh();
	}

	// Only the author ever sees these — everyone else 404s before reaching here.
	const withheldCopy: Record<string, string> = {
		pending_review:
			'This is waiting for staff to look at it before it goes on the board. Only you can see it right now.',
		under_review:
			"Someone reported this, so it's off the board while staff take a look. Most reports are dismissed — if this one is, it goes straight back up.",
		hidden: 'Staff took this off the board.'
	};
</script>

<PageHeader width="3xl" title={s.title} subtitle={m.member_suggestions_id_subtitle()}>
	{#if s.status !== 'open'}
		<StatusBadge status={s.status} label />
	{/if}
</PageHeader>

<PageContent width="3xl">
	<!--
		What the idea became. Read-only, and deliberately no budget: the member is
		being told their suggestion turned into work, which is the payoff the board
		never had, not given a window onto what it costs.
	-->
	{#if project}
		<Alert type="success">
			<ParaglideMessage
				message={m.member_suggestions_id_staff_started_work}
				inputs={{ name: project.name }}
				>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{/if}

	<!-- A certified result is every member's to read; before that the ballot's
	     own page is its electors', so the link waits for certification. -->
	{#if ballots.length > 0}
		<InfoCard title={ballots.length === 1 ? m.member_suggestions_id_ballot() : m.member_ballots()}>
			<ul class="space-y-2">
				{#each ballots as b (b.id)}
					<li>
						<BallotLine
							ballot={b}
							href={b.status === 'certified'
								? resolve(`/member/ballots/${b.id}`)
								: b.status === 'open'
									? resolve('/member/ballots')
									: null}
						/>
					</li>
				{/each}
			</ul>
		</InfoCard>
	{/if}

	{#if s.mergedIntoId}
		<Alert type="info" href={resolve(`/member/suggestions/${s.mergedIntoId}`)}>
			<ParaglideMessage
				message={m.member_suggestions_id_merged_into_votes_moved_across}
				inputs={{
					mergedIntoTitle: s.mergedIntoTitle ?? m.member_suggestions_id_another_suggestion()
				}}
				>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{:else if s.visibility !== 'visible'}
		<Alert type={s.visibility === 'hidden' ? 'error' : 'warning'}>
			<p>
				{withheldCopy[s.visibility] ?? m.member_suggestions_id_not_board_right_now()}
				{#if s.visibilityNote}
					<ParaglideMessage
						message={m.member_staff_s_note}
						inputs={{ visibilityNote: s.visibilityNote }}
						>{#snippet span({ children })}<span class="italic">{@render children?.()}</span
							>{/snippet}</ParaglideMessage
					>
				{/if}
			</p>
			{#if isMine && s.visibility === 'hidden'}
				<AppealPanel target={{ kind: 'suggestion', suggestionId: s.id }} />
			{/if}
		</Alert>
	{/if}

	{#if editState.pendingEdit}
		<Alert type="info">
			<div class="flex w-full flex-wrap items-center justify-between gap-2">
				<p>
					{m.member_suggestions_id_edit_with_staff_suggestion_below()}
				</p>
				<Action
					action={cancelSuggestionEdit}
					label={m.member_withdraw()}
					submitLabel={m.member_suggestions_id_withdraw_edit()}
					modalTitle={m.member_suggestions_id_withdraw_edit_2()}
					successToast={m.member_suggestions_id_edit_withdrawn()}
					variant="ghost"
					size="xs"
					onsuccess={refresh}
				>
					{#snippet form()}
						<input {...cancelSuggestionEdit.fields.suggestionId.as('hidden', s.id)} />
						<input
							{...cancelSuggestionEdit.fields.editId.as('hidden', editState.pendingEdit?.id ?? '')}
						/>
						<p class="py-2">{m.member_suggestions_id_take_edit_back_can_submit()}</p>
					{/snippet}
				</Action>
			</div>
		</Alert>
	{/if}

	<InfoCard title={m.member_suggestions_id_subtitle()}>
		<div class="flex items-start gap-4">
			<Form remote={vote} class="shrink-0" onsuccess={refresh}>
				<input {...vote.fields.suggestionId.as('hidden', s.id)} />
				<!-- See SuggestionCard: the visible label is the count, so without these
				     the control reads `button "11"` and says neither what it does nor
				     that a vote is already cast (#903). -->
				<SubmitButton
					label={String(s.voteCount)}
					disabled={s.visibility !== 'visible' || !!s.mergedIntoId}
					aria-pressed={!!s.hasVoted}
					aria-label={s.hasVoted
						? m.member_suggestions_id_remove_vote()
						: m.member_suggestions_id_vote_suggestion()}
					class="h-auto flex-col gap-0 py-1 btn-sm {s.hasVoted ? 'btn-primary' : 'btn-outline'}"
				>
					{#snippet icon()}<IconCaretUpFilled size={16} />{/snippet}
				</SubmitButton>
			</Form>

			<div class="min-w-0 grow space-y-3">
				<Badge size="sm" variant="outline">
					{suggestionCategoryLabels[s.category as keyof typeof suggestionCategoryLabels] ??
						s.category}
				</Badge>
				<p class="whitespace-pre-wrap">{s.body}</p>
				<div class="text-muted">
					{m.member_suggestions_id_suggested_by({
						authorName: s.authorName ?? m.member_suggestions_id_former_member(),
						formatDateTime: formatDateTime(s.createdAt)
					})}
					{#if s.editedAt}
						{m.member_suggestions_id_edited({ formatDateTime: formatDateTime(s.editedAt) })}
					{/if}
				</div>
			</div>

			{#if isMine && editState.canEdit && !editState.pendingEdit}
				<Action
					action={editSuggestion}
					data-testid="edit-suggestion"
					label={editState.direct ? m.member_edit() : m.member_suggestions_id_request_edit()}
					iconOnly
					modalTitle={editState.direct
						? m.member_suggestions_id_edit_suggestion()
						: m.member_suggestions_id_request_edit()}
					submitLabel={editState.direct ? m.member_save() : m.member_send_staff()}
					successToast={editState.direct
						? m.member_suggestions_id_updated()
						: m.member_sent_staff()}
					variant="ghost"
					size="sm"
					class="shrink-0"
					onsuccess={refresh}
				>
					{#snippet icon()}<IconPencil size={16} />{/snippet}
					{#snippet form()}
						<input {...editSuggestion.fields.suggestionId.as('hidden', s.id)} />
						{#if !editState.direct}
							<!-- Say why, plainly. Being told "this needs review" without a
							     reason reads as the site distrusting you personally. -->
							<p class="mb-3 text-muted">
								{m.member_suggestions_id_other_members_have_already_voted()}
							</p>
						{/if}
						<FormField
							name="title"
							type="text"
							label={m.member_what_should_we_do()}
							value={s.title}
						/>
						<FormField
							name="body"
							type="textarea"
							label={m.member_tell_us_bit_more()}
							value={s.body}
						/>
						<FormField
							name="category"
							type="select"
							label={m.member_category()}
							value={s.category}
							options={suggestionCategories.map((c) => ({
								value: c,
								label: suggestionCategoryLabels[c]
							}))}
						/>
					{/snippet}
				</Action>
			{/if}

			{#if !isMine && s.visibility === 'visible'}
				<Action
					action={flag}
					data-testid="flag-suggestion"
					label={m.member_flag_review()}
					iconOnly
					modalTitle={m.member_flag_review()}
					submitLabel={m.member_send_report()}
					successToast={m.member_reported_staff_will_take_look()}
					variant="ghost"
					size="sm"
					class="shrink-0"
					onsuccess={refresh}
				>
					{#snippet icon()}<IconFlag size={16} />{/snippet}
					{#snippet form()}
						<input {...flag.fields.suggestionId.as('hidden', s.id)} />
						<p class="mb-3 text-muted">
							{m.member_takes_suggestion_off_board_straight()}
						</p>
						<FormField name="reason" type="text" label={m.member_what_s_problem()} />
						<FormField
							name="description"
							type="textarea"
							label={m.member_anything_else_optional()}
						/>
					{/snippet}
				</Action>
			{/if}
		</div>
	</InfoCard>

	{#if s.responseBody}
		<InfoCard title={m.member_suggestions_id_official_response()}>
			<p class="whitespace-pre-wrap">{s.responseBody}</p>
			<p class="mt-2 text-muted">
				{s.responderName ?? m.member_suggestions_id_staff()}{s.responseAt
					? ` · ${formatDateTime(s.responseAt)}`
					: ''}
			</p>
		</InfoCard>
	{/if}
</PageContent>

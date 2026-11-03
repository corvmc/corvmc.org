<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import type { EntityRef } from '$lib/types/entity';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { IconFlag, IconCaretUpFilled } from '@tabler/icons-svelte';
	import { relativeDay } from '$lib/utils/format';
	import { suggestionCategoryLabels } from '$lib/config';
	import { toggleSuggestionVote, flagSuggestion } from '$lib/remote/suggestions.remote';

	// No `mergedIntoId`: merged suggestions are filtered out of the board query,
	// so a card never renders one.
	let {
		suggestion,
		isMine,
		onchanged
	}: {
		suggestion: {
			id: string;
			ref: EntityRef;
			body: string;
			category: string;
			status: string;
			authorName: string | null;
			responseBody: string | null;
			createdAt: Date;
			voteCount: number;
			hasVoted: number;
		};
		/** Hides the report button on the member's own post. */
		isMine: boolean;
		onchanged: () => void;
	} = $props();

	// `.for(id)` gives each card its own form instance; without it every card on
	// the board would share one submission state.
	let vote = $derived(toggleSuggestionVote.for(suggestion.id));
	let flag = $derived(flagSuggestion.for(suggestion.id));
</script>

<li class="card bg-base-100 shadow">
	<CardBody padding="sm" class="flex-row items-start gap-4">
		<!-- The vote control is a Form whose only field is hidden. SubmitButton has
		     no dirty gate, so a fields-free form still submits.

		     `aria-label` and `aria-pressed` because the visible label is the count
		     and nothing else: without them the row reads `button "11"`, which says
		     neither what pressing it does nor that a vote is already cast (#903). -->
		<Form remote={vote} class="shrink-0" onsuccess={onchanged}>
			<input {...vote.fields.suggestionId.as('hidden', suggestion.id)} />
			<SubmitButton
				label={String(suggestion.voteCount)}
				aria-pressed={!!suggestion.hasVoted}
				aria-label={(suggestion.hasVoted
					? m.member_suggestions_unvote_label
					: m.member_suggestions_vote_label)({ title: suggestion.ref.title })}
				class="h-auto flex-col gap-0 py-1 btn-sm {suggestion.hasVoted
					? 'btn-primary'
					: 'btn-outline'}"
			>
				{#snippet icon()}<IconCaretUpFilled size={16} />{/snippet}
			</SubmitButton>
		</Form>

		<div class="min-w-0 grow space-y-1">
			<div class="flex min-w-0 items-center gap-2">
				<Badge size="sm" variant="outline" class="shrink-0">
					{suggestionCategoryLabels[suggestion.category as keyof typeof suggestionCategoryLabels] ??
						suggestion.category}
				</Badge>
				<EntityIdentity ref={suggestion.ref} class="min-w-0" />
				{#if suggestion.status !== 'open'}
					<span class="shrink-0"><StatusBadge status={suggestion.status} label /></span>
				{/if}
			</div>

			<p class="line-clamp-3 text-sm opacity-80">{suggestion.body}</p>

			{#if suggestion.responseBody}
				<!-- The same three lines as the body above. A reply is the answer to
				     that text, so clamping it shorter would rank the two; leaving it
				     unclamped made one row several times taller than its neighbours,
				     and it was the only unclamped text on the board (#1046). -->
				<p class="line-clamp-3 border-l-2 border-primary/40 pl-3 text-sm">
					<span class="font-medium">{m.member_suggestions_suggestion_card_staff()}</span>
					{suggestion.responseBody}
				</p>
			{/if}

			<p class="text-muted">
				{suggestion.authorName ?? m.member_suggestions_suggestion_card_former_member()} · {relativeDay(
					suggestion.createdAt
				)}
			</p>
		</div>

		{#if !isMine}
			<Action
				action={flag}
				label={m.member_suggestions_suggestion_card_flag()}
				iconOnly
				modalTitle={m.member_flag_review()}
				submitLabel={m.member_send_report()}
				successToast={m.member_reported_staff_will_take_look()}
				variant="ghost"
				size="xs"
				class="shrink-0"
				onsuccess={onchanged}
			>
				{#snippet icon()}<IconFlag size={16} />{/snippet}
				{#snippet form()}
					<input {...flag.fields.suggestionId.as('hidden', suggestion.id)} />
					<p class="mb-3 text-muted">
						{m.member_takes_suggestion_off_board_straight()}
					</p>
					<FormField name="reason" type="text" label={m.member_what_s_problem()} />
					<FormField name="description" type="textarea" label={m.member_anything_else_optional()} />
				{/snippet}
			</Action>
		{/if}
	</CardBody>
</li>

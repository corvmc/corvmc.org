<script lang="ts">
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import type { EntityRef } from '$lib/types/entity';
	import Action from '$lib/components/shared/Action.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
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
		     no dirty gate, so a fields-free form still submits. -->
		<Form remote={vote} class="shrink-0" onsuccess={onchanged}>
			<input {...vote.fields.suggestionId.as('hidden', suggestion.id)} />
			<SubmitButton
				label={String(suggestion.voteCount)}
				class="btn-sm flex-col gap-0 h-auto py-1 {suggestion.hasVoted
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
				<p class="border-l-2 border-primary/40 pl-3 text-sm">
					<span class="font-medium">Staff:</span>
					{suggestion.responseBody}
				</p>
			{/if}

			<p class="text-muted">
				{suggestion.authorName ?? 'A former member'} · {relativeDay(suggestion.createdAt)}
			</p>
		</div>

		{#if !isMine}
			<Action
				action={flag}
				label="Flag"
				iconOnly
				modalTitle="Flag for review"
				submitLabel="Send report"
				successToast="Reported — staff will take a look"
				variant="ghost"
				size="xs"
				class="shrink-0"
				onsuccess={onchanged}
			>
				{#snippet icon()}<IconFlag size={16} />{/snippet}
				{#snippet form()}
					<input {...flag.fields.suggestionId.as('hidden', suggestion.id)} />
					<p class="mb-3 text-muted">
						This takes the suggestion off the board straight away while staff look at it. If they
						don't agree with the report, it goes back up.
					</p>
					<FormField name="reason" type="text" label="What's the problem?" />
					<FormField name="description" type="textarea" label="Anything else? (optional)" />
				{/snippet}
			</Action>
		{/if}
	</CardBody>
</li>

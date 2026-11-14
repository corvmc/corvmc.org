<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import type { ReviewDecision, ReviewItem } from '#lib/types/review.js';
	import { decisionsFor } from './review-decisions';

	/**
	 * A feed row's own decisions, through the forms the kind's page submits. A
	 * decision whose form needs a written reason asks for it in a dialog; the
	 * rest are one click.
	 */
	let {
		item,
		kindLabel,
		ondecided
	}: {
		item: Pick<ReviewItem, 'id' | 'kind' | 'subjectId' | 'ref'>;
		kindLabel: string;
		ondecided: () => void;
	} = $props();

	/** Each decision's own words, so a new decision cannot borrow another's. */
	const words: Record<
		ReviewDecision,
		{ label: () => string; title?: (kind: string) => string; toast: () => string }
	> = {
		approve: { label: m.staff_approve_label, toast: m.staff_review_approved_toast },
		decline: {
			label: m.staff_review_decline_label,
			title: (kind) => m.staff_review_decline_title({ kind }),
			toast: m.staff_review_declined_toast
		},
		return: {
			label: m.staff_return_label,
			title: (kind) => m.staff_review_return_title({ kind }),
			toast: m.staff_returned_toast
		}
	};

	let decisions = $derived(
		decisionsFor(item).map(([decision, bound]) => ({
			decision,
			words: words[decision],
			bound,
			form: bound.form.for(`${item.id}:${decision}`),
			values: Object.entries(bound.values(item))
		}))
	);
</script>

{#if decisions.length > 0}
	<div class="flex justify-end gap-1" data-testid="review-decisions">
		{#each decisions as d (d.decision)}
			{#if d.bound.message}
				<Action
					action={d.form}
					label={d.words.label()}
					variant="ghost"
					size="sm"
					class="text-error"
					modalTitle={d.words.title?.(kindLabel.toLowerCase())}
					submitLabel={d.words.label()}
					submitVariant="error"
					successToast={d.words.toast()}
					onsuccess={ondecided}
					data-review-decision={d.decision}
				>
					{#snippet form()}
						{#each d.values as [name, value] (name)}
							<input {...d.form.fields[name].as('hidden', value)} />
						{/each}
						<FormField
							field={d.form.fields[d.bound.message!]}
							label={m.staff_reason_label()}
							type="textarea"
						/>
					{/snippet}
				</Action>
			{:else}
				<Form remote={d.form} successToast={d.words.toast()} onsuccess={ondecided}>
					{#each d.values as [name, value] (name)}
						<input {...d.form.fields[name].as('hidden', value)} />
					{/each}
					<SubmitButton
						label={d.words.label()}
						variant="ghost"
						size="sm"
						class={d.decision === 'approve' ? 'text-success' : 'text-error'}
						data-review-decision={d.decision}
					/>
				</Form>
			{/if}
		{/each}
	</div>
{/if}

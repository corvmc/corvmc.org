<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import { fileAppeal, getMyAppeal } from '$lib/remote/appeals.remote';
	import Action from '$lib/components/ui/Action.svelte';
	import { APPEAL_BODY_MAX, appealVerdictLabels, type StandingScope } from '$lib/config';
	import { formatDate } from '$lib/utils/format';

	type Target =
		| { kind: 'suggestion'; suggestionId: string }
		| { kind: 'listing'; eventId: string }
		| { kind: 'standing'; scope: StandingScope };

	/**
	 * The appeal half of a moderation notice: a button while there is an upheld
	 * decision to contest, then its pending state, then the answer. Renders
	 * nothing when there is nothing appealable here, so a notice can mount it
	 * unconditionally. Owns its query so the host page keeps one load-bearing read.
	 */
	let { target, fallback }: { target: Target; fallback?: Snippet } = $props();

	const targetId = $derived(
		target.kind === 'suggestion'
			? target.suggestionId
			: target.kind === 'listing'
				? target.eventId
				: target.scope
	);
	const view = $derived(await getMyAppeal(target));
	const instance = $derived(fileAppeal.for(`${target.kind}:${targetId}`));
</script>

{#if view}
	<div class="mt-3 space-y-2 text-sm">
		{#if !view.appeal}
			<p class="text-wrap">
				{m.moderation_appeal_panel_if_think_decision_was_wrong()}
			</p>
			<Action
				action={instance}
				label={m.moderation_appeal_panel_label()}
				modalTitle={m.moderation_appeal_panel_label()}
				submitLabel={m.moderation_appeal_panel_submit_label()}
				successToast={m.moderation_appeal_panel_success_toast()}
				variant="default"
				size="sm"
				outline
			>
				{#snippet form()}
					<input {...instance.fields.kind.as('hidden', target.kind)} />
					<input {...instance.fields.targetId.as('hidden', targetId)} />
					<div class="space-y-3">
						{#if view.upheld.notes}
							<p class="text-muted text-wrap">
								Staff's reason: <span class="italic">{view.upheld.notes}</span>
							</p>
						{/if}
						<label class="fieldset w-full">
							<span class="fieldset-legend"
								>{m.moderation_appeal_panel_why_do_think_was_wrong()}</span
							>
							<textarea
								class="textarea w-full"
								rows="5"
								maxlength={APPEAL_BODY_MAX}
								{...instance.fields.body.as('text')}></textarea>
						</label>
						<p class="text-muted text-wrap">
							{m.moderation_appeal_panel_nothing_changes_while_appeal_looked()}
						</p>
					</div>
				{/snippet}
			</Action>
		{:else if !view.appeal.decision}
			<p class="text-wrap">
				{m.moderation_appeal_panel_appealed_member_staff_will_look({
					formatDate: formatDate(view.appeal.createdAt)
				})}
			</p>
		{:else}
			<p class="text-wrap">
				<span class="font-medium"
					>{m.moderation_appeal_panel_appeal({
						toLowerCase: appealVerdictLabels[view.appeal.decision.verdict].toLowerCase()
					})}</span
				>
				on {formatDate(view.appeal.decision.decidedAt)}.
			</p>
		{/if}
	</div>
{:else if fallback}
	{@render fallback()}
{/if}

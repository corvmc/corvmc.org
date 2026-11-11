<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { decideAppeal, reopenAppeal } from '#lib/remote/appeals.remote.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDateTime } from '#lib/utils/format.js';
	import { appealVerdictLabels, type AppealOutcome } from '#lib/config.js';

	interface Appeal {
		body: string;
		createdAt: Date;
		appellantUserId: string | null;
		appellantName: string | null;
		decision: {
			contentOutcome: AppealOutcome;
			standingOutcome: AppealOutcome;
			verdict: keyof typeof appealVerdictLabels;
			notes: string | null;
			decidedAt: Date;
		} | null;
		contentApplicable: boolean;
		standingApplicable: boolean;
		canDeny: boolean;
	}

	let { flagId, appeal }: { flagId: string; appeal: Appeal } = $props();

	const outcomeLabels: Record<AppealOutcome, string> = {
		restored: 'Restored',
		upheld: 'Upheld',
		not_applicable: 'Not affected'
	};

	const { fields } = decideAppeal;
</script>

<InfoCard title={m.staff_flags_id_appeal_card_title()} class="lg:col-span-2">
	<DefinitionList>
		<Fact label={m.staff_from_label()}>
			{#if appeal.appellantUserId}
				<a class="link" href={resolve(`staff/members/${appeal.appellantUserId}`)}>
					{appeal.appellantName}
				</a>
			{:else}
				{m.staff_flags_id_appeal_card_deleted_account_text()}
			{/if}
		</Fact>
		<Fact label={m.staff_flags_id_appeal_card_filed_label()}
			>{formatDateTime(appeal.createdAt)}</Fact
		>
		<Fact label={m.staff_flags_id_appeal_card_their_case_label()} wrap>{appeal.body}</Fact>
	</DefinitionList>

	{#if appeal.decision}
		<div class="mt-4">
			<DefinitionList>
				<Fact label={m.staff_flags_id_appeal_card_verdict_label()}
					>{appealVerdictLabels[appeal.decision.verdict]}</Fact
				>
				<Fact label={m.staff_content_label()}>{outcomeLabels[appeal.decision.contentOutcome]}</Fact>
				<Fact label={m.staff_flags_id_appeal_card_standing_label()}
					>{outcomeLabels[appeal.decision.standingOutcome]}</Fact
				>
				{#if appeal.decision.notes}
					<Fact label={m.staff_flags_id_appeal_card_reason_staff_only_label()} wrap
						>{appeal.decision.notes}</Fact
					>
				{/if}
				<Fact label={m.staff_flags_id_appeal_card_decided_label()}
					>{formatDateTime(appeal.decision.decidedAt)}</Fact
				>
			</DefinitionList>
		</div>
		<div class="mt-3">
			<Action
				action={reopenAppeal}
				label={m.staff_flags_id_appeal_card_reopen_appeal_label()}
				modalTitle={m.staff_flags_id_appeal_card_reopen_appeal_2_title()}
				submitLabel={m.staff_reopen_label()}
				successToast={m.staff_flags_id_appeal_card_appeal_reopened_toast()}
				variant="default"
				size="sm"
				outline
			>
				{#snippet form()}
					<input {...reopenAppeal.fields.flagId.as('hidden', flagId)} />
					<p class="text-muted text-wrap">
						{m.staff_flags_id_appeal_card_puts_appeal_back_queue_fresh_text()}
					</p>
				{/snippet}
			</Action>
		</div>
	{:else}
		{#if !appeal.canDeny}
			<Alert type="info" class="mt-4">
				{m.staff_flags_id_appeal_card_upheld_report_so_can_grant_body()}
			</Alert>
		{/if}
		<div class="mt-3">
			<Action
				action={decideAppeal}
				label={m.staff_flags_id_appeal_card_decide_appeal_label()}
				modalTitle={m.staff_flags_id_appeal_card_decide_appeal_2_title()}
				submitLabel={m.staff_flags_id_appeal_card_record_decision_label()}
				successToast={m.staff_flags_id_appeal_card_appeal_decided_toast()}
				variant="primary"
				size="sm"
			>
				{#snippet form()}
					<input {...fields.flagId.as('hidden', flagId)} />
					<div class="space-y-3">
						<p class="text-muted text-wrap">
							{m.staff_flags_id_appeal_card_each_box_tick_applied_as_text()}
						</p>
						{#if appeal.contentApplicable}
							<label class="label cursor-pointer justify-start gap-2">
								<input class="checkbox checkbox-sm" {...fields.restoreContent.as('checkbox')} />
								<span class="fieldset-legend text-wrap"
									>{m.staff_flags_id_appeal_card_put_content_back_up_label()}</span
								>
							</label>
						{/if}
						{#if appeal.standingApplicable}
							<label class="label cursor-pointer justify-start gap-2">
								<input class="checkbox checkbox-sm" {...fields.restoreStanding.as('checkbox')} />
								<span class="fieldset-legend text-wrap">
									{m.staff_flags_id_appeal_card_restore_member_s_standing_their_label()}
								</span>
							</label>
						{/if}
						{#if !appeal.contentApplicable && !appeal.standingApplicable}
							<p class="text-muted text-wrap">
								{m.staff_flags_id_appeal_card_nothing_from_report_still_force_text()}
							</p>
						{/if}
						<label class="fieldset w-full">
							<span class="fieldset-legend"
								>{m.staff_flags_id_appeal_card_reason_staff_only_member_told_label()}</span
							>
							<textarea class="textarea w-full" rows="3" {...fields.notes.as('text')}></textarea>
						</label>
					</div>
				{/snippet}
			</Action>
		</div>
	{/if}
</InfoCard>

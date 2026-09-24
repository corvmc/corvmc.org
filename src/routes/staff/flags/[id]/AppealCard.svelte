<script lang="ts">
	import { resolve } from '$app/paths';
	import { decideAppeal, reopenAppeal } from '$lib/remote/appeals.remote';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDateTime } from '$lib/utils/format';
	import { appealVerdictLabels, type AppealOutcome } from '$lib/config';

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

<InfoCard title="Appeal" class="lg:col-span-2">
	<DefinitionList>
		<Fact label="From">
			{#if appeal.appellantUserId}
				<a class="link" href={resolve(`/staff/users/${appeal.appellantUserId}`)}>
					{appeal.appellantName}
				</a>
			{:else}
				Deleted account
			{/if}
		</Fact>
		<Fact label="Filed">{formatDateTime(appeal.createdAt)}</Fact>
		<Fact label="Their case" wrap>{appeal.body}</Fact>
	</DefinitionList>

	{#if appeal.decision}
		<div class="mt-4">
			<DefinitionList>
				<Fact label="Verdict">{appealVerdictLabels[appeal.decision.verdict]}</Fact>
				<Fact label="Content">{outcomeLabels[appeal.decision.contentOutcome]}</Fact>
				<Fact label="Standing">{outcomeLabels[appeal.decision.standingOutcome]}</Fact>
				{#if appeal.decision.notes}
					<Fact label="Told the member" wrap>{appeal.decision.notes}</Fact>
				{/if}
				<Fact label="Decided">{formatDateTime(appeal.decision.decidedAt)}</Fact>
			</DefinitionList>
		</div>
		<div class="mt-3">
			<Action
				action={reopenAppeal}
				label="Reopen appeal"
				modalTitle="Reopen this appeal"
				submitLabel="Reopen"
				successToast="Appeal reopened"
				variant="default"
				size="sm"
				outline
			>
				{#snippet form()}
					<input {...reopenAppeal.fields.flagId.as('hidden', flagId)} />
					<p class="text-muted text-wrap">
						This puts the appeal back in the queue for a fresh decision. Anything the last decision
						restored stays restored.
					</p>
				{/snippet}
			</Action>
		</div>
	{:else}
		{#if !appeal.canDeny}
			<Alert type="info" class="mt-4">
				You upheld this report, so you can grant this appeal but a different staffer has to be the
				one to deny it.
			</Alert>
		{/if}
		<div class="mt-3">
			<Action
				action={decideAppeal}
				label="Decide appeal"
				modalTitle="Decide this appeal"
				submitLabel="Record decision"
				successToast="Appeal decided"
				variant="primary"
				size="sm"
			>
				{#snippet form()}
					<input {...fields.flagId.as('hidden', flagId)} />
					<div class="space-y-3">
						<p class="text-muted text-wrap">
							Each box you tick is applied as soon as you save. Leave both unticked to deny.
						</p>
						{#if appeal.contentApplicable}
							<label class="label cursor-pointer justify-start gap-2">
								<input class="checkbox checkbox-sm" {...fields.restoreContent.as('checkbox')} />
								<span class="fieldset-legend text-wrap">Put the content back up</span>
							</label>
						{/if}
						{#if appeal.standingApplicable}
							<label class="label cursor-pointer justify-start gap-2">
								<input class="checkbox checkbox-sm" {...fields.restoreStanding.as('checkbox')} />
								<span class="fieldset-legend text-wrap">
									Restore the member's standing (their posts stop going to review)
								</span>
							</label>
						{/if}
						{#if !appeal.contentApplicable && !appeal.standingApplicable}
							<p class="text-muted text-wrap">
								Nothing from this report is still in force, so this only records your answer.
							</p>
						{/if}
						<label class="fieldset w-full">
							<span class="fieldset-legend">Reason (the member is shown this)</span>
							<textarea class="textarea w-full" rows="3" {...fields.notes.as('text')}></textarea>
						</label>
					</div>
				{/snippet}
			</Action>
		</div>
	{/if}
</InfoCard>

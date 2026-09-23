<script lang="ts">
	/** One grant or sponsorship: what is agreed, and what comes due. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import AgreementFields from '$lib/components/agreement/AgreementFields.svelte';
	import {
		getAgreementDetail,
		updateAgreement,
		deleteAgreement
	} from '$lib/remote/agreements.remote';
	import {
		agreementKindLabels,
		agreementStatusLabels,
		agreementStatusBadge,
		agreementDeadlineLabels
	} from '$lib/config';
	import { formatCents, formatDateShortYear } from '$lib/utils/format';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	const id = $derived(page.params.id!);
	const agreement = $derived(await getAgreementDetail(id));
	const editForm = $derived(updateAgreement.for(id));

	/** A `YYYY-MM-DD` read as that calendar day, not as UTC midnight. */
	function day(iso: string | null): string {
		return iso ? formatDateShortYear(new Date(`${iso}T12:00:00`)) : '—';
	}

	const contact = $derived(
		[agreement.contactName, agreement.contactEmail].filter(Boolean).join(' · ')
	);
</script>

<PageHeader
	width="3xl"
	title={agreement.counterparty}
	subtitle={agreementKindLabels[agreement.kind]}
	backHref="/staff/agreements"
>
	<Action
		action={editForm}
		label="Edit"
		variant="ghost"
		size="sm"
		modalTitle="Edit {agreement.counterparty}"
		submitLabel="Save"
		successToast="Saved"
	>
		{#snippet form()}
			<input type="hidden" name="id" value={agreement.id} />
			<AgreementFields fields={editForm.fields} value={agreement} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="3xl">
	{#if agreement.deadline?.overdue}
		<Alert type="warning">
			{agreementDeadlineLabels[agreement.deadline.kind]}
			{day(agreement.deadline.on)} has passed. Move the status on once it is dealt with.
		</Alert>
	{/if}

	<InfoCard title={agreement.title}>
		<DefinitionList>
			<Fact label="Status">
				<Badge variant={agreementStatusBadge[agreement.status]} size="sm">
					{agreementStatusLabels[agreement.status]}
				</Badge>
			</Fact>
			<Fact
				label="Amount"
				value={agreement.amountCents != null ? formatCents(agreement.amountCents) : '—'}
			/>
			{#if agreement.tier}
				<Fact label="Tier" value={agreement.tier} />
			{/if}
			<Fact label="Apply by" value={day(agreement.applyBy)} />
			<Fact label="Term" value="{day(agreement.startsOn)} – {day(agreement.endsOn)}" />
			<Fact label="Report due" value={day(agreement.reportDueOn)} />
			<Fact label="Contact" value={contact || '—'} />
			{#if agreement.notes}
				<Fact label="Notes" wrap>{agreement.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<div class="flex flex-wrap gap-2">
		<Action
			action={deleteAgreement.for(agreement.id)}
			label="Delete"
			variant="ghost"
			size="sm"
			class="text-error"
			modalTitle="Delete {agreement.counterparty}?"
			submitLabel="Delete"
			submitVariant="error"
			successToast="Deleted"
			onsuccess={() => goto(resolve('/staff/agreements'))}
		>
			{#snippet form()}
				<input type="hidden" name="id" value={agreement.id} />
				<p class="text-sm">
					For a row that should never have existed. A grant that was turned down is Declined, and a
					sponsorship that ran its course is Ended.
				</p>
			{/snippet}
		</Action>
	</div>
</PageContent>

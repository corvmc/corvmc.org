<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { EntityChip } from '$lib/components/ui/entity';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import RoleOptions from '$lib/components/volunteer/RoleOptions.svelte';
	import { formatDateShort, formatDateTime } from '$lib/utils/format';
	import {
		getEquipmentReport,
		dismissEquipmentReport,
		sendEquipmentReportToWorkOrder
	} from '$lib/remote/work-requests.remote';

	let id = $derived(page.params.id!);
	let report = $derived(await getEquipmentReport(id));

	const dismissFields = dismissEquipmentReport.fields;
	const sendFields = sendEquipmentReportToWorkOrder.fields;

	// Empty means "raise a new one"; the role picker only matters then.
	let workOrderId = $state('');
</script>

<PageHeader
	width="3xl"
	subtitle="Equipment Report"
	title={report.asset.title}
	backHref="/staff/flags/equipment"
>
	<StatusBadge status={report.stage === 'in_work_order' ? 'in_progress' : report.status} label />
</PageHeader>
<PageContent width="3xl">
	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<InfoCard title="Report">
			<DefinitionList>
				<Fact label="Unit"><EntityChip ref={report.asset} /></Fact>
				<Fact label="Note" wrap>{report.note}</Fact>
				<Fact label="Still usable?">{report.blocksUse ? 'No — out of use' : 'Yes'}</Fact>
				{#if report.condition}
					<Fact label="Condition" class="capitalize">{report.condition}</Fact>
				{/if}
				<Fact label="Reported by">
					{#if report.reporterName}
						{report.reporterName} <span class="opacity-60">({report.reporterEmail})</span>
					{:else}
						Deleted account
					{/if}
				</Fact>
				<Fact label="Reported">{formatDateTime(report.createdAt)}</Fact>
			</DefinitionList>
		</InfoCard>

		<InfoCard title="Other open reports on this unit" state={report.otherPending.length}>
			{#if report.otherPending.length === 0}
				<p class="text-muted">None. Sending this to a work order takes any that arrive first.</p>
			{:else}
				<ul class="space-y-2">
					{#each report.otherPending as o (o.id)}
						<li>
							<a class="link" href={resolve(`/staff/flags/equipment/${o.id}`)}>{o.note}</a>
							<div class="text-subtle">
								{o.reporterName ?? 'Deleted account'} · {formatDateShort(o.createdAt)}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</InfoCard>

		<InfoCard title="Triage" class="bg-base-200 shadow-none">
			{#if report.stage === 'untriaged'}
				<p class="mb-3 text-muted">
					Send it to the work that will fix it, or dismiss it if there is nothing to do.
				</p>
				<div class="flex gap-2">
					<Action
						action={sendEquipmentReportToWorkOrder}
						label="Send to work order"
						modalTitle="Send to a work order"
						submitLabel="Send"
						successToast="Sent to a work order"
						variant="primary"
						size="sm"
					>
						{#snippet form()}
							<input {...sendFields.id.as('hidden', id)} />
							<label class="fieldset w-full">
								<span class="fieldset-legend">Work order</span>
								<Select class="w-full" name="workOrderId" bind:value={workOrderId}>
									<option value="">Raise a new work order</option>
									{#each report.openWorkOrders as w (w.id)}
										<option value={w.id}>{w.roleName}: {w.notes ?? 'No notes'}</option>
									{/each}
								</Select>
							</label>
							{#if !workOrderId}
								<label class="fieldset w-full">
									<span class="fieldset-legend">Who does the work</span>
									<Select class="w-full" name="volunteerRoleId">
										<option value="" disabled selected>Choose a role</option>
										<RoleOptions activeOnly />
									</Select>
								</label>
								<Field field={sendFields.dueAt} type="date" label="Needed by (optional)" />
								<Field
									field={sendFields.notes}
									type="textarea"
									label="Notes"
									description="Leave blank to use the member's note."
								/>
							{/if}
							<p class="text-muted text-wrap">
								Every other open report on this unit goes with it, and all of them close when the
								work order is resolved.
							</p>
						{/snippet}
					</Action>
					<Action
						action={dismissEquipmentReport}
						label="Dismiss"
						modalTitle="Dismiss this report"
						submitLabel="Dismiss — nothing to do"
						successToast="Report dismissed"
						size="sm"
					>
						{#snippet form()}
							<input {...dismissFields.id.as('hidden', id)} />
							<Field field={dismissFields.notes} type="textarea" label="Why (optional)" />
							{#if report.blocksUse}
								<p class="text-muted text-wrap">
									Dismissing does not put the unit back in service — do that from its page.
								</p>
							{/if}
						{/snippet}
					</Action>
				</div>
			{:else if report.stage === 'in_work_order' && report.workOrderId}
				<p class="text-muted">
					Waiting on
					<a class="link" href={resolve(`/staff/volunteer/shifts/${report.workOrderId}`)}>
						its work order</a
					>. It closes when that does.
				</p>
			{:else}
				<DefinitionList>
					<Fact label="Outcome"><StatusBadge status={report.status} label /></Fact>
					{#if report.resolutionNotes}
						<Fact label="Notes" wrap>{report.resolutionNotes}</Fact>
					{/if}
					{#if report.resolvedAt}
						<Fact label="Closed">{formatDateTime(report.resolvedAt)}</Fact>
					{/if}
				</DefinitionList>
			{/if}
		</InfoCard>
	</div>
</PageContent>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import RoleOptions from '#lib/components/volunteer/RoleOptions.svelte';
	import { formatDateShort, formatDateTime } from '#lib/utils/format.js';
	import { NO_ROLE_LABEL } from '#lib/utils/shift-label.js';
	import {
		getEquipmentReport,
		dismissEquipmentReport,
		sendEquipmentReportToWorkOrder
	} from '#lib/remote/work-requests.remote.js';

	let id = $derived(page.params.id!);
	let report = $derived(await getEquipmentReport(id));

	const dismissFields = dismissEquipmentReport.fields;
	const sendFields = sendEquipmentReportToWorkOrder.fields;

	// Empty means "raise a new one"; the role picker only matters then.
	let workOrderId = $state('');
</script>

<PageHeader
	width="3xl"
	subtitle={m.staff_inventory_problems_id_subtitle()}
	title={report.asset?.title ?? report.location ?? m.staff_inventory_problems_id_building_problem()}
>
	<StatusBadge status={report.stage === 'in_work_order' ? 'in_progress' : report.status} label />
</PageHeader>
<PageContent width="3xl">
	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<InfoCard title={m.staff_report()}>
			<DefinitionList>
				{#if report.asset}
					<Fact label={m.staff_unit()}><EntityChip ref={report.asset} /></Fact>
				{:else}
					<Fact label={m.staff_inventory_problems_id_where()}>{report.location}</Fact>
				{/if}
				<Fact label={m.staff_note()} wrap>{report.note}</Fact>
				<Fact label={m.staff_inventory_problems_id_still_usable()}
					>{report.blocksUse ? m.staff_inventory_problems_id_no_out_use() : m.staff_yes()}</Fact
				>
				{#if report.condition}
					<Fact label={m.staff_condition()} class="capitalize">{report.condition}</Fact>
				{/if}
				<Fact label={m.staff_inventory_problems_id_reported_by()}>
					{#if report.reporterName}
						{report.reporterName} <span class="opacity-60">({report.reporterEmail})</span>
					{:else}
						{m.staff_inventory_problems_id_deleted_account()}
					{/if}
				</Fact>
				<Fact label={m.staff_reported()}>{formatDateTime(report.createdAt)}</Fact>
			</DefinitionList>
		</InfoCard>

		{#if report.asset}
			<InfoCard
				title={m.staff_inventory_problems_id_other_open_reports_unit()}
				state={report.otherPending.length}
			>
				{#if report.otherPending.length === 0}
					<p class="text-muted">{m.staff_inventory_problems_id_none_sending_work_order_takes()}</p>
				{:else}
					<ul class="space-y-2">
						{#each report.otherPending as o (o.id)}
							<li>
								<a class="link" href={resolve(`/staff/inventory/problems/${o.id}`)}>{o.note}</a>
								<div class="text-subtle">
									{o.reporterName ?? m.staff_inventory_problems_id_deleted_account()} · {formatDateShort(
										o.createdAt
									)}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</InfoCard>
		{/if}

		<InfoCard title={m.staff_inventory_problems_id_triage()} class="bg-base-200 shadow-none">
			{#if report.stage === 'untriaged'}
				<p class="mb-3 text-muted">
					{m.staff_inventory_problems_id_send_work_will_fix_dismiss()}
				</p>
				<div class="flex gap-2">
					<Action
						action={sendEquipmentReportToWorkOrder}
						label={m.staff_inventory_problems_id_send_work_order()}
						modalTitle={m.staff_inventory_problems_id_send_work_order_2()}
						submitLabel={m.staff_inventory_problems_id_send()}
						successToast={m.staff_inventory_problems_id_sent_work_order()}
						variant="primary"
						size="sm"
					>
						{#snippet form()}
							<input {...sendFields.id.as('hidden', id)} />
							<label class="fieldset w-full">
								<span class="fieldset-legend">{m.staff_inventory_problems_id_work_order()}</span>
								<Select class="w-full" name="workOrderId" bind:value={workOrderId}>
									<option value="">{m.staff_inventory_problems_id_raise_new_work_order()}</option>
									{#each report.openWorkOrders as w (w.id)}
										<option value={w.id}
											>{w.roleName ?? NO_ROLE_LABEL}: {w.notes ??
												m.staff_inventory_problems_id_no_notes()}</option
										>
									{/each}
								</Select>
							</label>
							{#if !workOrderId}
								<label class="fieldset w-full">
									<span class="fieldset-legend"
										>{m.staff_inventory_problems_id_who_does_work()}</span
									>
									<Select class="w-full" name="volunteerRoleId">
										<option value="" disabled selected
											>{m.staff_inventory_problems_id_choose_role()}</option
										>
										<RoleOptions activeOnly />
									</Select>
								</label>
								<Field
									field={sendFields.dueAt}
									type="date"
									label={m.staff_inventory_problems_id_needed_by_optional()}
								/>
								<Field
									field={sendFields.notes}
									type="textarea"
									label={m.staff_notes()}
									description={m.staff_inventory_problems_id_description()}
								/>
							{/if}
							<p class="text-muted text-wrap">
								{report.asset
									? m.staff_inventory_problems_id_every_other_open_report_unit()
									: m.staff_inventory_problems_id_closes_when_work_order_resolved()}
							</p>
						{/snippet}
					</Action>
					<Action
						action={dismissEquipmentReport}
						label={m.staff_inventory_problems_id_dismiss()}
						modalTitle={m.staff_inventory_problems_id_dismiss_report()}
						submitLabel={m.staff_inventory_problems_id_dismiss_nothing_do()}
						successToast={m.staff_inventory_problems_id_report_dismissed()}
						size="sm"
					>
						{#snippet form()}
							<input {...dismissFields.id.as('hidden', id)} />
							<Field
								field={dismissFields.notes}
								type="textarea"
								label={m.staff_inventory_problems_id_why_optional()}
							/>
							{#if report.blocksUse}
								<p class="text-muted text-wrap">
									{m.staff_inventory_problems_id_dismissing_does_not_put_unit()}
								</p>
							{/if}
						{/snippet}
					</Action>
				</div>
			{:else if report.stage === 'in_work_order' && report.workOrderId}
				<p class="text-muted">
					<ParaglideMessage
						message={m.staff_inventory_problems_id_waiting_closes_when_does}
						inputs={{
							staff_inventory_problems_id_its_work_order:
								m.staff_inventory_problems_id_its_work_order()
						}}
						>{#snippet a({ children })}<a
								class="link"
								href={resolve(`/staff/volunteer/shifts/${report.workOrderId}`)}
								>{@render children?.()}</a
							>{/snippet}</ParaglideMessage
					>
				</p>
			{:else}
				<DefinitionList>
					<Fact label={m.staff_outcome()}><StatusBadge status={report.status} label /></Fact>
					{#if report.resolutionNotes}
						<Fact label={m.staff_notes()} wrap>{report.resolutionNotes}</Fact>
					{/if}
					{#if report.resolvedAt}
						<Fact label={m.staff_closed()}>{formatDateTime(report.resolvedAt)}</Fact>
					{/if}
				</DefinitionList>
			{/if}
		</InfoCard>
	</div>
</PageContent>

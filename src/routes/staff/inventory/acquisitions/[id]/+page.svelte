<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { IconDeviceFloppy, IconFileText, IconUpload } from '@tabler/icons-svelte';
	import {
		addAcquisitionLineForm,
		getStaffAcquisitionDetail,
		editAcquisition
	} from '#lib/remote/inventory.remote.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Field, FileUpload, MoneyField } from '#lib/components/ui/Form/index.js';
	import Action from '#lib/components/ui/Action.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import MemberPicker from '#lib/components/ui/MemberPicker.svelte';
	import { RecordForm8283Action, MarkReimbursedAction } from '#lib/components/actions/index.js';
	import { resolve } from '$app/paths';
	import { formatCents, formatDateShort, toLocalDate } from '#lib/utils/format.js';
	import {
		acquisitionKinds,
		acquisitionKindLabels,
		stockReasonLabels,
		type AcquisitionKind
	} from '#lib/config.js';
	import { toast } from 'svelte-sonner';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	/**
	 * One acquisition: what arrived, from whom, for how much, and the paperwork.
	 *
	 * The disclosure fields are editable here rather than only at receiving
	 * because that is when their answers exist. A Form 8283 is signed weeks after
	 * the gift walks in; whether a gift was sold or used is decided later still.
	 * Capturing them only at the door is why they sat empty in production.
	 *
	 * The **lines are deliberately read-only.** They have already emitted their
	 * `receive` movements, so rewriting a quantity here would put the ledger and
	 * the paperwork into permanent disagreement. A miscount is corrected the way
	 * every other stock error is — with an `adjust` movement against the item.
	 */
	const { fields } = editAcquisition;

	let id = $derived(params.id);
	const data = $derived(await getStaffAcquisitionDetail(id));

	/**
	 * The kind currently selected, which drives which disclosure fields show.
	 * Seeded from the stored value and owned by the select from then on.
	 */
	// svelte-ignore state_referenced_locally
	let kind = $state<AcquisitionKind>(data.kind);

	/**
	 * Only a gift owes the FASB ASU 2020-07 disclosure. An allow-list rather
	 * than `!== 'purchase'`, which was correct with three kinds and wrong the
	 * moment `opening_balance` arrived — it would ask how the fair value of a
	 * decade-old amp was determined and file the answer as a gift in kind.
	 */
	const isGift = $derived(kind === 'donation' || kind === 'grant');

	const addLineFields = addAcquisitionLineForm.fields;
	const itemOptions = $derived(data.items.map((i) => ({ value: i.id, label: i.name })));

	let donorUserId = $state('');
	let donorName = $state('');
	let paidByUserId = $state('');
	let paidByName = $state('');
	// Seeded from the record once, so the picker shows who is already on the row
	// without clobbering a choice the staffer has started making.
	$effect(() => {
		donorUserId = data.donorUserId ?? '';
		donorName = data.donorName ?? '';
		paidByUserId = data.paidByUserId ?? '';
		paidByName = data.paidByName ?? '';
	});

	async function uploadReceipt(file: File) {
		const body = new FormData();
		body.append('file', file);
		body.append('slot', 'receipt');
		body.append('attachableId', id);

		const res = await fetch('/api/inventory/media', { method: 'POST', body });
		if (!res.ok) {
			const detail = (await res.json().catch(() => null)) as { message?: string } | null;
			throw new Error(detail?.message ?? 'Upload failed');
		}
		await getStaffAcquisitionDetail(id).refresh();
		toast.success(m.staff_inventory_acquisitions_id_toast());
	}
</script>

<PageHeader
	width="3xl"
	subtitle={m.staff_acquisition_body()}
	title={`${acquisitionKindLabels[data.kind]} — ${formatDateShort(data.occurredAt)}`}
>
	{#if data.awaitingReimbursement}
		<Badge variant="warning">{m.staff_awaiting_reimbursement_label()}</Badge>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if data.awaitingReimbursement}
		<!-- Above the record because it is the only thing here that somebody is
		     waiting on. The app moves no money; this records that a person did. -->
		<Alert type="warning" class="mb-4">
			<div>
				<p>
					<ParaglideMessage
						message={m.staff_inventory_acquisitions_id_fronted_has_not_been_paid_text}
						inputs={{
							paidByName: data.paidByName ?? '',
							formatCents: formatCents(data.totalCents ?? data.linesTotalCents)
						}}
						>{#snippet strong({ children })}<strong>{@render children?.()}</strong
							>{/snippet}</ParaglideMessage
					>
				</p>
				<div class="mt-3">
					<MarkReimbursedAction
						acquisitionId={id}
						paidByName={data.paidByName}
						amountCents={data.totalCents ?? data.linesTotalCents}
					/>
				</div>
			</div>
		</Alert>
	{/if}

	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<Form
			remote={editAcquisition}
			guard
			successToast={m.staff_inventory_acquisitions_id_acquisition_updated_toast()}
		>
			<input {...fields.id.as('hidden', id)} />
			<InfoCard title={m.staff_details_title()}>
				<!--
					Kind and date are editable because both are guessed at entry, and a
					stocktake guesses them a few hundred times. A wrong kind is the
					costly one: it decides whether the row lands in this year's spend,
					in the gifts-in-kind report, or in neither, and the only previous
					fix was to delete the acquisition and re-enter it — which means
					re-entering every unit that hangs off it.
				-->
				<div class="grid grid-cols-2 gap-3">
					<Field
						field={fields.kind}
						type="select"
						label={m.staff_how_arrived_label()}
						bind:value={kind}
						options={acquisitionKinds.map((k) => ({ value: k, label: acquisitionKindLabels[k] }))}
					/>
					<Field
						field={fields.occurredAt}
						type="date"
						label={m.staff_when_arrived_label()}
						value={toLocalDate(data.occurredAt)}
					/>
				</div>
				{#if kind !== 'opening_balance'}
					<Field
						field={fields.sourceName}
						type="text"
						label={kind === 'purchase' ? m.staff_supplier_label() : m.staff_donor_grantor_label()}
						value={data.sourceName ?? ''}
					/>
				{/if}
				<Field
					field={fields.reference}
					type="text"
					label={m.staff_reference_receipt_no_label()}
					value={data.reference ?? ''}
				/>

				<MoneyField
					field={fields.totalCents}
					label={m.staff_receipt_total_label()}
					value={data.totalCents}
					description={m.staff_inventory_acquisitions_id_what_paperwork_says_includin_body()}
				/>

				{#if isGift}
					<MoneyField
						field={fields.fairValueCents}
						label={m.staff_inventory_acquisitions_id_total_fair_value_label()}
						value={data.fairValueCents}
					/>
					<Field
						field={fields.fairValueBasis}
						type="text"
						label={m.staff_inventory_acquisitions_id_how_value_was_determined_label()}
						description={m.staff_inventory_acquisitions_id_required_gifts_kind_disclosu_body()}
						value={data.fairValueBasis ?? ''}
					/>
					<Field
						field={fields.intendedUse}
						type="text"
						label={m.staff_inventory_acquisitions_id_intended_use_label()}
						value={data.intendedUse ?? ''}
					/>
					<Field
						field={fields.monetized}
						type="checkbox"
						label={m.staff_inventory_acquisitions_id_sold_rather_than_used_label()}
						checkboxLabel={m.staff_inventory_acquisitions_id_checkbox_label_checkbox()}
						value={data.monetized}
					/>
				{/if}

				<div class="mt-3">
					<MemberPicker
						field={fields.donorUserId}
						bind:value={donorUserId}
						bind:name={donorName}
						label={m.staff_donated_by_label()}
					/>
				</div>

				<!-- Beside the donor on purpose, and they are opposites: a member
				     who is owed goes here, a member who gave goes above. Filling
				     both turns a gift into a debt. -->
				<div class="mt-3">
					<MemberPicker
						field={fields.paidByUserId}
						bind:value={paidByUserId}
						bind:name={paidByName}
						label={m.staff_inventory_acquisitions_id_paid_by_owed_back_leave_label()}
					/>
				</div>

				<Field
					field={fields.notes}
					type="textarea"
					label={m.staff_notes_label()}
					value={data.notes ?? ''}
				/>

				<div class="mt-3">
					<SubmitButton>
						{#snippet icon()}
							<IconDeviceFloppy size={20} />
						{/snippet}
					</SubmitButton>
				</div>
			</InfoCard>
		</Form>

		<div class="space-y-6">
			<InfoCard title={m.staff_record_title()} class="bg-base-200 shadow-none">
				<DefinitionList>
					<Fact label={m.staff_kind_label()}>{acquisitionKindLabels[data.kind]}</Fact>
					<Fact label={m.staff_inventory_acquisitions_id_occurred_label()}
						>{formatDateShort(data.occurredAt)}</Fact
					>
					<Fact label={m.staff_source_label()}>{data.donorName ?? '—'}</Fact>
					{#if data.fulfils}
						<!-- What a member asked for, and where it came from. The request
						     sat at Planned after the thing was on the shelf (#603). -->
						<Fact label={m.staff_inventory_acquisitions_id_fulfils_label()}>
							<a class="link" href={resolve(`staff/suggestions/${data.fulfils.id}`)}>
								{data.fulfils.title}
							</a>
						</Fact>
					{/if}
					<Fact label={m.staff_inventory_acquisitions_id_lines_total_label()}>
						{formatCents(data.linesTotalCents)}
						{#if data.totalCents != null && data.totalCents !== data.linesTotalCents}
							<span class="text-subtle">
								{m.staff_inventory_acquisitions_id_receipt_says_text({
									formatCents: formatCents(data.totalCents)
								})}
							</span>
						{/if}
					</Fact>
					{#if data.paidByName}
						<Fact label={m.staff_inventory_acquisitions_id_paid_by_label()}>
							{data.paidByName}
							{#if data.reimbursedAt}
								<span class="text-subtle">
									{m.staff_inventory_acquisitions_id_reimbursed_text({
										formatDateShort: formatDateShort(data.reimbursedAt)
									})}
								</span>
							{/if}
						</Fact>
					{/if}
				</DefinitionList>
			</InfoCard>

			{#if data.kind === 'donation'}
				<InfoCard title={m.staff_inventory_acquisitions_id_form_8283_title()}>
					{#if data.acknowledgedAt}
						<DefinitionList>
							<Fact label={m.staff_inventory_acquisitions_id_signed_label()}
								>{formatDateShort(data.acknowledgedAt)}</Fact
							>
							<Fact label={m.staff_inventory_acquisitions_id_appraisal_label()}
								>{data.appraisalRef ?? '—'}</Fact
							>
						</DefinitionList>
					{:else}
						<!-- Said plainly, because the consequence is silence rather than an
						     error: with no 8283 recorded, disposing of this gift raises no
						     Form 8282 warning at all. -->
						<p class="text-subtle">
							{m.staff_inventory_acquisitions_id_nothing_recorded_donor_claim_text()}
						</p>
					{/if}
					<div class="mt-3">
						<RecordForm8283Action
							acquisitionId={id}
							signedOn={data.acknowledgedAt}
							appraisalRef={data.appraisalRef}
							variant={data.acknowledgedAt ? 'ghost' : 'primary'}
						/>
					</div>
				</InfoCard>
			{/if}

			<InfoCard title={m.staff_inventory_acquisitions_id_receipts_title()}>
				{#if data.receipts.length === 0}
					<EmptyState description={m.staff_inventory_acquisitions_id_nothing_attached_yet_body()} />
				{:else}
					<ul class="space-y-2">
						{#each data.receipts as receipt (receipt.attachmentId)}
							<li class="flex items-center gap-2">
								<IconFileText size={18} class="shrink-0 opacity-60" />
								<a
									class="grow link"
									href={receipt.url ?? '#'}
									target="_blank"
									rel="noopener external"
								>
									{receipt.filename ?? m.staff_inventory_acquisitions_id_receipt_text()}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="mt-4">
					<FileUpload
						upload={uploadReceipt}
						accept=".pdf,image/*"
						showPreview={false}
						variant="ghost"
					>
						<IconUpload size={16} />
						{m.staff_inventory_acquisitions_id_attach_receipt_text()}
					</FileUpload>
				</div>
			</InfoCard>
		</div>
	</div>

	<InfoCard title={m.staff_what_arrived_title()} class="mb-6">
		{#snippet header(title)}
			<div class="flex items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				<Action
					action={addAcquisitionLineForm}
					label={m.staff_add_line_label()}
					modalTitle={m.staff_add_line_title()}
					submitLabel={m.staff_add_label()}
					successToast={m.staff_inventory_acquisitions_id_line_added_toast()}
					variant="ghost"
					size="xs"
				>
					{#snippet form()}
						<div class="space-y-4">
							<input {...addLineFields.acquisitionId.as('hidden', id)} />
							<Field
								field={addLineFields.itemId}
								type="select"
								label={m.staff_what_was_label()}
								options={itemOptions}
								required
							/>
							<div class="grid grid-cols-2 gap-3">
								<Field
									field={addLineFields.quantity}
									type="number"
									label={m.staff_inventory_acquisitions_id_how_many_label()}
									value={1}
									required
								/>
								<MoneyField field={addLineFields.unitValueCents} label={m.staff_each_label()} />
							</div>
							<p class="text-subtle">
								{m.staff_inventory_acquisitions_id_adding_line_receives_stock_n_text()}
							</p>
						</div>
					{/snippet}
				</Action>
			</div>
		{/snippet}

		{#if data.lines.length === 0}
			<EmptyState
				description={m.staff_inventory_acquisitions_id_nothing_itemised_yet_receipt_body()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_item_label()}</th>
					<th class="cell-num">{m.staff_quantity_label()}</th>
					<th class="cell-num">{m.staff_unit_value_label()}</th>
					<th class="cell-num">{m.staff_inventory_acquisitions_id_line_total_label()}</th>
				{/snippet}
				{#each data.lines as line (line.id)}
					<tr class="hover">
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`staff/inventory/${line.itemId}`)}>
								{line.item.name}
							</a>
						</td>
						<td class="cell-num">{line.quantity}</td>
						<td class="cell-num">
							{line.unitValueCents === null ? '—' : formatCents(line.unitValueCents)}
						</td>
						<td class="cell-num">
							{formatCents(line.quantity * (line.unitValueCents ?? 0))}
						</td>
					</tr>
				{/each}
				<tr class="font-medium">
					<td>{m.staff_total_text()}</td>
					<td class="cell-num"></td>
					<td class="cell-num"></td>
					<td class="cell-num">{formatCents(data.linesTotalCents)}</td>
				</tr>
			</Table>
		{/if}
	</InfoCard>

	<InfoCard title={m.staff_inventory_acquisitions_id_stock_wrote_title()}>
		{#if data.movements.length === 0}
			<!-- Worth showing rather than hiding: an acquisition whose lines wrote no
			     movements is paperwork with no stock behind it. -->
			<EmptyState
				description={m.staff_inventory_acquisitions_id_no_stock_movements_were_writ_body()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="whitespace-nowrap">{m.staff_when_label()}</th>
					<th>{m.staff_item_label()}</th>
					<th>{m.staff_what_happened_label()}</th>
					<th class="cell-num">{m.staff_quantity_label()}</th>
				{/snippet}
				{#each data.movements as movement (movement.id)}
					<tr>
						<td class="whitespace-nowrap">{formatDateShort(movement.occurredAt)}</td>
						<td class="cell-primary">{movement.item.name}</td>
						<td>{stockReasonLabels[movement.reason]}</td>
						<td class="cell-num">{movement.quantity > 0 ? '+' : ''}{movement.quantity}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>
</PageContent>

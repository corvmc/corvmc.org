<script lang="ts">
	import { page } from '$app/state';
	import { IconDeviceFloppy, IconFileText, IconUpload } from '@tabler/icons-svelte';
	import { getStaffAcquisitionDetail, editAcquisition } from '$lib/remote/inventory.remote';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import { RecordForm8283Action, MarkReimbursedAction } from '$lib/components/actions';
	import { resolve } from '$app/paths';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { acquisitionKindLabels, stockReasonLabels } from '$lib/config';
	import { toast } from 'svelte-sonner';

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

	let id = $derived(page.params.id!);
	const data = $derived(await getStaffAcquisitionDetail(id));

	let paidByUserId = $state('');
	let paidByName = $state('');
	let uploading = $state(false);

	// Seeded from the record once, so the picker shows who is already on the row
	// without clobbering a choice the staffer has started making.
	$effect(() => {
		paidByUserId = data.paidByUserId ?? '';
		paidByName = data.paidByName ?? '';
	});

	async function uploadReceipt(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploading = true;
		try {
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
			toast.success('Receipt attached');
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			uploading = false;
			input.value = '';
		}
	}
</script>

<PageHeader
	subtitle="Acquisition"
	title={`${acquisitionKindLabels[data.kind]} — ${formatDateShort(data.occurredAt)}`}
	backHref={resolve('/staff/inventory/acquisitions')}
>
	{#if data.awaitingReimbursement}
		<Badge variant="warning">Awaiting reimbursement</Badge>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if data.awaitingReimbursement}
		<!-- Above the record because it is the only thing here that somebody is
		     waiting on. The app moves no money; this records that a person did. -->
		<Alert type="warning" class="mb-4">
			<div>
				<p>
					<strong>{data.paidByName}</strong> fronted
					{formatCents(data.totalCents ?? data.linesTotalCents)} for this and has not been paid back.
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
		<Form remote={editAcquisition} guard successToast="Acquisition updated">
			<input {...fields.id.as('hidden', id)} />
			<InfoCard title="Details">
				<Field
					field={fields.sourceName}
					type="text"
					label={data.kind === 'purchase' ? 'Supplier' : 'Donor / grantor'}
					value={data.sourceName ?? ''}
				/>
				<Field
					field={fields.reference}
					type="text"
					label="Reference / receipt no."
					value={data.reference ?? ''}
				/>

				{#if data.kind !== 'purchase'}
					<Field
						field={fields.fairValueCents}
						type="number"
						label="Total fair value (cents)"
						value={data.fairValueCents ?? undefined}
					/>
					<Field
						field={fields.fairValueBasis}
						type="text"
						label="How the value was determined"
						description="Required for the gifts-in-kind disclosure — e.g. comparable sales, appraisal."
						value={data.fairValueBasis ?? ''}
					/>
					<Field
						field={fields.intendedUse}
						type="text"
						label="Intended use"
						value={data.intendedUse ?? ''}
					/>
					<Field
						field={fields.monetized}
						type="checkbox"
						label="Sold rather than used"
						checkboxLabel="The collective converted this gift to cash"
						value={data.monetized}
					/>
				{/if}

				<div class="mt-3">
					<MemberPicker
						field={fields.paidByUserId}
						bind:value={paidByUserId}
						bind:name={paidByName}
						label="Paid by (leave blank if the collective paid)"
					/>
				</div>

				<Field field={fields.notes} type="textarea" label="Notes" value={data.notes ?? ''} />

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
			<InfoCard title="Record" class="bg-base-200 shadow-none">
				<DefinitionList>
					<Fact label="Kind">{acquisitionKindLabels[data.kind]}</Fact>
					<Fact label="Occurred">{formatDateShort(data.occurredAt)}</Fact>
					<Fact label="Source">{data.donorName ?? '—'}</Fact>
					<Fact label="Lines total">{formatCents(data.linesTotalCents)}</Fact>
					{#if data.paidByName}
						<Fact label="Paid by">
							{data.paidByName}
							{#if data.reimbursedAt}
								<span class="text-subtle">
									— reimbursed {formatDateShort(data.reimbursedAt)}
								</span>
							{/if}
						</Fact>
					{/if}
				</DefinitionList>
			</InfoCard>

			{#if data.kind === 'donation'}
				<InfoCard title="Form 8283">
					{#if data.acknowledgedAt}
						<DefinitionList>
							<Fact label="Signed">{formatDateShort(data.acknowledgedAt)}</Fact>
							<Fact label="Appraisal">{data.appraisalRef ?? '—'}</Fact>
						</DefinitionList>
					{:else}
						<!-- Said plainly, because the consequence is silence rather than an
						     error: with no 8283 recorded, disposing of this gift raises no
						     Form 8282 warning at all. -->
						<p class="text-subtle">
							Nothing recorded. A donor claiming over $5,000 asks the collective to sign their Form
							8283 — until that is recorded here, disposing of this gift will raise no Form 8282
							warning.
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

			<InfoCard title="Receipts">
				{#if data.receipts.length === 0}
					<EmptyState description="Nothing attached yet" />
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
									{receipt.filename ?? 'Receipt'}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="mt-4">
					<label class="btn btn-ghost btn-sm">
						<IconUpload size={16} />
						{uploading ? 'Uploading…' : 'Attach a receipt'}
						<input
							type="file"
							class="hidden"
							accept=".pdf,image/*"
							onchange={uploadReceipt}
							disabled={uploading}
						/>
					</label>
				</div>
			</InfoCard>
		</div>
	</div>

	<InfoCard title="What arrived" class="mb-6">
		{#if data.lines.length === 0}
			<EmptyState description="No lines on this acquisition" />
		{:else}
			<Table>
				{#snippet head()}
					<th>Item</th>
					<th class="cell-num">Quantity</th>
					<th class="cell-num">Unit value</th>
					<th class="cell-num">Line total</th>
				{/snippet}
				{#each data.lines as line (line.id)}
					<tr class="hover">
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`/staff/inventory/${line.itemId}`)}>
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
					<td>Total</td>
					<td class="cell-num"></td>
					<td class="cell-num"></td>
					<td class="cell-num">{formatCents(data.linesTotalCents)}</td>
				</tr>
			</Table>
		{/if}
	</InfoCard>

	<InfoCard title="Stock it wrote">
		{#if data.movements.length === 0}
			<!-- Worth showing rather than hiding: an acquisition whose lines wrote no
			     movements is paperwork with no stock behind it. -->
			<EmptyState description="No stock movements were written against this acquisition" />
		{:else}
			<Table>
				{#snippet head()}
					<th class="whitespace-nowrap">When</th>
					<th>Item</th>
					<th class="col-support">What happened</th>
					<th class="cell-num">Quantity</th>
				{/snippet}
				{#each data.movements as movement (movement.id)}
					<tr>
						<td class="whitespace-nowrap">{formatDateShort(movement.occurredAt)}</td>
						<td class="cell-primary">{movement.item.name}</td>
						<td class="col-support">{stockReasonLabels[movement.reason]}</td>
						<td class="cell-num">{movement.quantity > 0 ? '+' : ''}{movement.quantity}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>
</PageContent>

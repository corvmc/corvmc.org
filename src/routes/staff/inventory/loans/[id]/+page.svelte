<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		getStaffLoanDetail,
		scheduleLoanForm as schedule,
		checkoutLoanForm as checkout
	} from '$lib/remote/inventory.remote';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { CancelLoanAction, MarkReturnedAction } from '$lib/components/actions';
	import Form, { Field, SubmitButton, Select } from '$lib/components/ui/Form';
	import { EntityChip } from '$lib/components/ui/entity';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDate, formatCents } from '$lib/utils/format';
	import BarcodeScanner from '$lib/components/ui/BarcodeScanner.svelte';
	import { parseScan } from '$lib/utils/scan';

	const { fields: scheduleFields } = schedule;
	const { fields: checkoutFields } = checkout;

	let id = $derived(page.params.id!);
	const data = $derived(await getStaffLoanDetail(id));
	const loan = $derived(data.loan);
	const availableItems = $derived(data.availableItems);
	/**
	 * The units that could be handed over. Already loaded by
	 * `getStaffLoanDetail` — the page simply never rendered them, which meant the
	 * checkout form submitted no `assetId` and every serialized checkout failed on
	 * `AssetRequiredError`.
	 */
	const availableAssets = $derived(data.availableAssets);
	const needsAsset = $derived(loan.itemKind === 'serialized' && !loan.assetId);

	/** The unit chosen for checkout, so a scan can set it as well as the select. */
	let chosenAssetId = $state('');

	/**
	 * Scanning the tag on the amp being handed over picks that unit.
	 *
	 * This is the moment the spec describes — a staffer at the counter with the
	 * gear in front of them — so the scan resolves against the units actually on
	 * offer. One that is not among them is ignored rather than silently selecting
	 * nothing: it means the wrong thing was scanned.
	 */
	function handleScan(raw: string) {
		const scan = parseScan(raw);
		if (scan.kind !== 'tag') return;
		const match = availableAssets.find((a) => a.assetTag === scan.value);
		if (match) chosenAssetId = match.id;
	}

	let chargePreview = $derived.by(() => {
		if (loan.status !== 'checked_out' || !loan.dailyRateCents || !loan.checkedOutAt) return null;
		const now = new Date();
		const ms = now.getTime() - new Date(loan.checkedOutAt).getTime();
		const days = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
		return { days, total: loan.dailyRateCents * days };
	});
</script>

<PageHeader
	width="3xl"
	subtitle={m.staff_inventory_loans_id_subtitle()}
	title={loan.equipmentName ?? m.staff_inventory_loans_id_free_form_request()}
>
	<StatusBadge status={loan.status} />
	{#if loan.isOverdue}
		<Badge variant="error" size="md">{m.staff_overdue()}</Badge>
	{/if}
</PageHeader>
<PageContent width="3xl">
	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<!-- Loan Details -->
		<InfoCard title={m.staff_inventory_loans_id_loan_details()}>
			<DefinitionList>
				<Fact label={m.staff_inventory_loans_id_loan_id()} mono>{loan.id}</Fact>

				<Fact label={m.staff_member()}>
					<EntityChip ref={loan.member} />
				</Fact>

				<Fact label={m.staff_equipment()}>
					{#if loan.equipmentName}
						<a href={resolve(`/staff/inventory/${loan.itemId}`)} class="link"
							>{loan.equipmentName}</a
						>
						{#if loan.categoryName}
							<Badge variant="outline" size="xs" class="ml-1">{loan.categoryName}</Badge>
						{/if}
					{:else}
						<span class="italic opacity-60">{m.staff_inventory_loans_id_not_yet_assigned()}</span>
					{/if}
				</Fact>

				<Fact label={m.staff_quantity()}>{loan.quantity}</Fact>

				<Fact label={m.staff_inventory_loans_id_requested_pickup()}
					>{formatDate(loan.requestedPickupDate)}</Fact
				>

				{#if loan.scheduledPickupDate}
					<Fact label={m.staff_inventory_loans_id_scheduled_pickup()}
						>{formatDate(loan.scheduledPickupDate)}</Fact
					>
				{/if}

				{#if loan.dueDate}
					<Fact
						label={m.staff_inventory_loans_id_due_date()}
						class={loan.isOverdue ? 'text-error' : ''}>{formatDate(loan.dueDate)}</Fact
					>
				{/if}

				{#if loan.checkedOutAt}
					<Fact label={m.staff_inventory_loans_id_checked_out()}
						>{formatDate(loan.checkedOutAt)}</Fact
					>
				{/if}

				{#if loan.returnedAt}
					<Fact label={m.staff_returned()}>{formatDate(loan.returnedAt)}</Fact>
				{/if}

				{#if loan.dailyRateCents != null}
					<Fact label={m.staff_inventory_loans_id_daily_rate()}
						>{m.staff_inventory_loans_id_day({
							formatCents: formatCents(loan.dailyRateCents)
						})}</Fact
					>
				{/if}

				{#if loan.totalChargeCents != null}
					<Fact label={m.staff_inventory_loans_id_total_charge()}
						>{formatCents(loan.totalChargeCents)}</Fact
					>
				{/if}

				{#if loan.creditsCents != null && loan.creditsCents > 0}
					<Fact label={m.staff_inventory_loans_id_paid_via_credits()}
						>{formatCents(loan.creditsCents)}</Fact
					>
				{/if}

				{#if loan.cashCents != null && loan.cashCents > 0}
					<Fact label={m.staff_inventory_loans_id_paid_via_cash_card()}
						>{formatCents(loan.cashCents)}</Fact
					>
				{/if}
			</DefinitionList>

			{#if loan.memberNotes}
				<div class="mt-4">
					<h4 class="mb-1 text-muted font-semibold">{m.staff_inventory_loans_id_member_notes()}</h4>
					<p class="rounded bg-base-200 p-2 text-sm">{loan.memberNotes}</p>
				</div>
			{/if}

			{#if loan.staffNotes}
				<div class="mt-4">
					<h4 class="mb-1 text-muted font-semibold">{m.staff_inventory_loans_id_staff_notes()}</h4>
					<p class="rounded bg-base-200 p-2 text-sm">{loan.staffNotes}</p>
				</div>
			{/if}
		</InfoCard>

		<!-- No card once the loan is done with: its terminal branch is one
		     sentence, and most historical records are terminal — the right half
		     of the page was a titled box around it (#1078). -->
		{#if loan.status !== 'requested' && loan.status !== 'scheduled' && loan.status !== 'checked_out'}
			<p class="text-muted">
				This loan is <strong>{loan.status}</strong>. No actions available.
			</p>
		{:else}
			<InfoCard title={m.staff_actions()}>
				{#if loan.status === 'requested'}
					<h4 class="mb-3 text-sm font-semibold">{m.staff_inventory_loans_id_schedule_pickup()}</h4>
					<Form
						remote={schedule}
						successToast={m.staff_inventory_loans_id_pickup_scheduled()}
						class="space-y-3"
					>
						<input {...scheduleFields.loanId.as('hidden', id)} />
						{#if !loan.itemId}
							<Field name="itemId" label={m.staff_inventory_loans_id_assign_equipment()}>
								<Select class="w-full" name="itemId" required>
									<option value="" disabled selected
										>{m.staff_inventory_loans_id_select_equipment()}</option
									>
									{#each availableItems as eq (eq.id)}
										{#if eq.availableQuantity > 0}
											<option value={eq.id}
												>{m.staff_inventory_loans_id_available({
													name: eq.name,
													availableQuantity: eq.availableQuantity
												})}</option
											>
										{/if}
									{/each}
								</Select>
							</Field>
						{:else}
							<input {...scheduleFields.itemId.as('hidden', loan.itemId)} />
						{/if}
						<Field
							name="scheduledPickupDate"
							type="date"
							label={m.staff_inventory_loans_id_pickup_date()}
						/>
						<div class="flex gap-2">
							<SubmitButton label={m.staff_schedule()} variant="primary" size="sm" />
							<CancelLoanAction
								loanId={id}
								label={m.staff_inventory_loans_id_cancel_request()}
								confirm="Cancel this loan request?"
							/>
						</div>
					</Form>
					<!-- Warn, record, allow (#2234): skipping the schedule is audited with a reason. -->
					{#if loan.itemId}
						<Action
							action={checkout}
							label={m.staff_inventory_loans_id_check_out_without_scheduling()}
							variant="ghost"
							size="xs"
							class="mt-3"
							modalTitle={m.staff_inventory_loans_id_modal_title()}
							submitLabel={m.staff_inventory_loans_id_submit_label()}
							successToast={m.staff_inventory_loans_id_checked_out()}
						>
							{#snippet form()}
								<input {...checkoutFields.loanId.as('hidden', id)} />
								<Field
									field={checkoutFields.dueDate}
									type="date"
									label={m.staff_inventory_loans_id_due_date_2()}
								/>
								{#if needsAsset}
									<Field name="assetId" label={m.staff_inventory_loans_id_unit_handed_over()}>
										<Select class="w-full" name="assetId" bind:value={chosenAssetId} required>
											<option value="" disabled>{m.staff_inventory_loans_id_select_tag()}</option>
											{#each availableAssets as unit (unit.id)}
												<option value={unit.id}>
													{unit.assetTag ?? unit.serialNumber ?? 'Untagged unit'}
												</option>
											{/each}
										</Select>
									</Field>
								{/if}
								<Field
									field={checkoutFields.reason}
									type="textarea"
									label={m.staff_inventory_loans_id_why_skip_scheduling()}
								/>
							{/snippet}
						</Action>
					{/if}
				{:else if loan.status === 'scheduled'}
					<h4 class="mb-3 text-sm font-semibold">
						{m.staff_inventory_loans_id_mark_as_checked_out()}
					</h4>
					<Form
						remote={checkout}
						successToast={m.staff_inventory_loans_id_checked_out()}
						class="space-y-3"
					>
						<input {...checkoutFields.loanId.as('hidden', id)} />
						<Field name="dueDate" type="date" label={m.staff_inventory_loans_id_due_date_2()} />
						<!-- A serialized loan has to name the unit that actually left, or
					     "which amp came back broken" has no answer. Without this the
					     service throws `AssetRequiredError` and the form goes nowhere. -->
						{#if needsAsset}
							<Field name="assetId" label={m.staff_inventory_loans_id_unit_handed_over()}>
								<Select class="w-full" name="assetId" bind:value={chosenAssetId} required>
									<option value="" disabled>{m.staff_inventory_loans_id_scan_select_tag()}</option>
									{#each availableAssets as unit (unit.id)}
										<option value={unit.id}>
											{unit.assetTag ?? unit.serialNumber ?? 'Untagged unit'}
											{unit.condition ? ` — ${unit.condition}` : ''}
										</option>
									{/each}
								</Select>
							</Field>
							<BarcodeScanner onscan={handleScan} label={m.staff_inventory_loans_id_scan_tag()} />
							{#if availableAssets.length === 0}
								<p class="text-subtle">
									{m.staff_inventory_loans_id_no_unit_item_service_so()}
								</p>
							{/if}
						{/if}
						<div class="flex gap-2">
							<SubmitButton
								label={m.staff_inventory_loans_id_check_out()}
								variant="primary"
								size="sm"
							/>
							<CancelLoanAction loanId={id} />
						</div>
					</Form>
				{:else if loan.status === 'checked_out'}
					<h4 class="mb-3 text-sm font-semibold">
						{m.staff_inventory_loans_id_mark_as_returned()}
					</h4>

					{#if chargePreview}
						<div class="mb-3 rounded bg-base-200 p-3 text-sm">
							<p>
								<strong>{m.staff_inventory_loans_id_charge_preview()}</strong>
								{chargePreview.days} day{chargePreview.days !== 1 ? 's' : ''} × {formatCents(
									loan.dailyRateCents ?? 0
								)}/day = <strong>{formatCents(chargePreview.total)}</strong>
							</p>
						</div>
					{/if}

					<MarkReturnedAction
						loanId={id}
						chargeMessage={chargePreview
							? m.staff_inventory_loans_id_charge_message({
									days: chargePreview.days,
									value: chargePreview.days !== 1 ? 's' : '',
									formatCents: formatCents(loan.dailyRateCents ?? 0),
									formatCents2: formatCents(chargePreview.total)
								})
							: undefined}
					/>
				{/if}
			</InfoCard>
		{/if}
	</div>
</PageContent>

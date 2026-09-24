<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { formatDateTime, formatTime } from '$lib/utils/format';
	import {
		checkInVendorForm,
		getMarketDayCheckIn,
		inviteBackForm,
		markNoShowForm
	} from '$lib/remote/market.remote';

	/**
	 * A market day at the door (#1505): mark each booked vendor arrived or a
	 * no-show, and record whether to ask them back. Shared by the staff and the
	 * owning committee's routes; `getMarketDayCheckIn` carries no contact detail.
	 */
	let { eventId, backHref }: { eventId: string; backHref: string } = $props();

	const data = $derived(await getMarketDayCheckIn(eventId));
	const arrived = $derived(data.vendors.filter((v) => v.checkedInAt).length);
	const noShows = $derived(data.vendors.filter((v) => v.status === 'no_show').length);
	const booked = $derived(data.vendors.length - noShows);

	const inviteOptions = [
		{ value: 'yes', label: 'Invite back' },
		{ value: 'no', label: 'Do not invite back' }
	];
</script>

<PageHeader
	width="3xl"
	title="Market day: {data.event.title}"
	subtitle={formatDateTime(data.event.startsAt)}
	{backHref}
/>
<PageContent width="3xl">
	<div class="flex flex-wrap gap-6">
		<StatCard title="Arrived" value="{arrived} / {booked}" size="sm" class="p-4" />
		<StatCard title="No-shows" value={noShows} size="sm" class="p-4" />
	</div>

	{#if data.vendors.length === 0}
		<EmptyState
			title="No vendors booked"
			description="Accepted vendors appear here to check in on the day."
		/>
	{/if}

	<div class="space-y-2">
		{#each data.vendors as vendor (vendor.id)}
			{@const inviteFields = inviteBackForm.for(vendor.id).fields}
			<Card>
				<CardBody row padding="sm">
					<div>
						<p class="font-medium">
							{vendor.businessName}
							{#if vendor.tableLabel}<span class="text-muted">· table {vendor.tableLabel}</span
								>{/if}
						</p>
						<p class="text-muted text-sm">
							{vendor.tablesRequested}
							{vendor.tablesRequested === 1 ? 'table' : 'tables'}{vendor.needsPower
								? ', needs power'
								: ''}
						</p>
						{#if vendor.inviteBack !== null}
							<p class="text-sm">
								{vendor.inviteBack ? 'Invite back' : 'Do not invite back'}{vendor.inviteBackNote
									? `: “${vendor.inviteBackNote}”`
									: ''}
							</p>
						{/if}
					</div>

					<div class="flex flex-wrap items-center gap-2">
						{#if vendor.status === 'no_show'}
							<StatusBadge status="no_show" />
							<Form
								remote={markNoShowForm.for(`undo-${vendor.id}`)}
								successToast="Restored"
								class="inline"
							>
								<input
									{...markNoShowForm
										.for(`undo-${vendor.id}`)
										.fields.vendorId.as('hidden', vendor.id)}
								/>
								<input
									{...markNoShowForm.for(`undo-${vendor.id}`).fields.noShow.as('hidden', 'no')}
								/>
								<SubmitButton label="Undo" variant="ghost" size="sm" />
							</Form>
						{:else if vendor.checkedInAt}
							<StatusBadge status="checked_in" />
							<span class="text-muted text-sm">{formatTime(vendor.checkedInAt)}</span>
							<Form
								remote={checkInVendorForm.for(`out-${vendor.id}`)}
								successToast="Check-in undone"
								class="inline"
							>
								<input
									{...checkInVendorForm
										.for(`out-${vendor.id}`)
										.fields.vendorId.as('hidden', vendor.id)}
								/>
								<input
									{...checkInVendorForm.for(`out-${vendor.id}`).fields.arrived.as('hidden', 'no')}
								/>
								<SubmitButton label="Undo" variant="ghost" size="sm" />
							</Form>
						{:else}
							<!-- 44px, as at the ticket door: tapped many times in a row, one-handed. -->
							<Form
								remote={checkInVendorForm.for(`in-${vendor.id}`)}
								successToast="Checked in"
								class="inline"
							>
								<input
									{...checkInVendorForm
										.for(`in-${vendor.id}`)
										.fields.vendorId.as('hidden', vendor.id)}
								/>
								<input
									{...checkInVendorForm.for(`in-${vendor.id}`).fields.arrived.as('hidden', 'yes')}
								/>
								<SubmitButton label="Arrived" variant="primary" class="min-h-11" />
							</Form>
							<Form
								remote={markNoShowForm.for(`ns-${vendor.id}`)}
								successToast="Marked no-show"
								class="inline"
							>
								<input
									{...markNoShowForm.for(`ns-${vendor.id}`).fields.vendorId.as('hidden', vendor.id)}
								/>
								<input
									{...markNoShowForm.for(`ns-${vendor.id}`).fields.noShow.as('hidden', 'yes')}
								/>
								<SubmitButton label="No-show" variant="ghost" size="sm" />
							</Form>
						{/if}

						<Action
							action={inviteBackForm.for(vendor.id)}
							label="Invite back?"
							modalTitle="Invite {vendor.businessName} back?"
							submitLabel="Save"
							successToast="Saved"
							variant="ghost"
							size="sm"
						>
							{#snippet form()}
								<div class="space-y-4">
									<input {...inviteFields.vendorId.as('hidden', vendor.id)} />
									<FormField
										field={inviteFields.inviteBack}
										type="select"
										label="Next market"
										options={inviteOptions}
										value={vendor.inviteBack === false ? 'no' : 'yes'}
									/>
									<FormField
										field={inviteFields.note}
										label="Note"
										description="Shown on this vendor's next application. How they sold, anything to know."
										value={vendor.inviteBackNote ?? ''}
									/>
								</div>
							{/snippet}
						</Action>
					</div>
				</CardBody>
			</Card>
		{/each}
	</div>
</PageContent>

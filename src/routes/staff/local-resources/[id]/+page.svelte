<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { formatDateTime } from '$lib/utils/format';
	import {
		getStaffLocalResource,
		updateLocalResourceForm,
		publishLocalResourceForm,
		rejectLocalResourceForm,
		removeLocalResourceForm
	} from '$lib/remote/local-resources.remote';
	import ResourceFields from '../ResourceFields.svelte';

	const data = $derived(await getStaffLocalResource(page.params.id!));
	const r = $derived(data.resource);
	const categoryName = $derived(data.categories.find((c) => c.id === r.categoryId)?.name ?? '—');

	const editFields = updateLocalResourceForm.fields;
	const publishFields = publishLocalResourceForm.fields;
	const rejectFields = rejectLocalResourceForm.fields;
	const removeFields = removeLocalResourceForm.fields;
</script>

<PageHeader title={r.name} subtitle="Local Resource" backHref="/staff/local-resources">
	<StatusBadge status={r.status} label />
	<Action
		action={updateLocalResourceForm}
		label="Edit"
		variant="ghost"
		size="sm"
		modalTitle="Edit {r.name}"
		successToast="Saved"
	>
		{#snippet form()}
			<input {...editFields.id.as('hidden', r.id)} />
			<ResourceFields fields={editFields} categories={data.categories} values={r} />
		{/snippet}
	</Action>
	<Action
		action={removeLocalResourceForm}
		label="Remove"
		variant="ghost"
		size="sm"
		modalTitle="Remove {r.name}"
		submitLabel="Remove"
		successToast="Listing removed"
		onsuccess={() => void goto(resolve('/staff/local-resources'))}
	>
		{#snippet form()}
			<input {...removeFields.id.as('hidden', r.id)} />
			<p>It comes off the public page. The record is kept.</p>
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="3xl">
	<div class="grid gap-6">
		<InfoCard title="Listing">
			<DefinitionList>
				<Fact label="Category">{categoryName}</Fact>
				{#if r.description}<Fact label="Description" wrap>{r.description}</Fact>{/if}
				{#if r.website}<Fact label="Website">{r.website}</Fact>{/if}
				{#if r.phone}<Fact label="Phone">{r.phone}</Fact>{/if}
				{#if r.addressLine}<Fact label="Address">{r.addressLine}</Fact>{/if}
				{#if r.submitterEmail}<Fact label="Suggested by">{r.submitterEmail}</Fact>{/if}
			</DefinitionList>
		</InfoCard>

		<InfoCard title="Review" class="bg-base-200 shadow-none">
			{#if r.status === 'rejected' && r.staffNote}
				<DefinitionList>
					<Fact label="Returned because" wrap>{r.staffNote}</Fact>
				</DefinitionList>
			{/if}
			{#if r.reviewedAt}
				<p class="mb-3 text-muted">Last reviewed {formatDateTime(r.reviewedAt)}.</p>
			{/if}
			<div class="flex gap-2">
				{#if r.status !== 'published'}
					<Action
						action={publishLocalResourceForm}
						label="Publish"
						modalTitle="Publish {r.name}"
						submitLabel="Publish"
						successToast="Published"
						variant="primary"
						size="sm"
					>
						{#snippet form()}
							<input {...publishFields.id.as('hidden', r.id)} />
							<p>It appears on /local-resources straight away.</p>
						{/snippet}
					</Action>
				{/if}
				{#if r.status !== 'rejected'}
					<Action
						action={rejectLocalResourceForm}
						label={r.status === 'published' ? 'Unpublish' : 'Reject'}
						modalTitle="Return {r.name}"
						submitLabel="Return with note"
						successToast="Returned"
						size="sm"
					>
						{#snippet form()}
							<input {...rejectFields.id.as('hidden', r.id)} />
							<Field
								field={rejectFields.note}
								type="textarea"
								label="What needs to change"
								description="Kept with the listing; it can be edited and published later."
							/>
						{/snippet}
					</Action>
				{/if}
			</div>
		</InfoCard>
	</div>
</PageContent>

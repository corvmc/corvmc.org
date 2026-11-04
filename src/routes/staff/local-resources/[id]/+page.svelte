<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { formatDateTime } from '#lib/utils/format.js';
	import {
		getStaffLocalResource,
		updateLocalResourceForm,
		publishLocalResourceForm,
		rejectLocalResourceForm,
		removeLocalResourceForm
	} from '#lib/remote/local-resources.remote.js';
	import ResourceFields from '../ResourceFields.svelte';

	const data = $derived(await getStaffLocalResource(page.params.id!));
	const r = $derived(data.resource);
	const categoryName = $derived(data.categories.find((c) => c.id === r.categoryId)?.name ?? '—');

	const editFields = updateLocalResourceForm.fields;
	const publishFields = publishLocalResourceForm.fields;
	const rejectFields = rejectLocalResourceForm.fields;
	const removeFields = removeLocalResourceForm.fields;
</script>

<PageHeader width="3xl" title={r.name} subtitle={m.staff_local_resources_id_subtitle()}>
	<StatusBadge status={r.status} label />
	<Action
		action={updateLocalResourceForm}
		label={m.staff_edit()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_2({ name: r.name })}
		successToast={m.staff_saved()}
	>
		{#snippet form()}
			<input {...editFields.id.as('hidden', r.id)} />
			<ResourceFields fields={editFields} categories={data.categories} values={r} />
		{/snippet}
	</Action>
	<Action
		action={removeLocalResourceForm}
		label={m.staff_remove()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_remove_2({ name: r.name })}
		submitLabel={m.staff_remove()}
		successToast={m.staff_local_resources_id_listing_removed()}
		onsuccess={() => void goto(resolve('/staff/local-resources'))}
	>
		{#snippet form()}
			<input {...removeFields.id.as('hidden', r.id)} />
			<p>{m.staff_local_resources_id_comes_off_public_page_record()}</p>
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="3xl">
	<div class="grid gap-6">
		<InfoCard title={m.staff_local_resources_id_listing()}>
			<DefinitionList>
				<Fact label={m.staff_category()}>{categoryName}</Fact>
				{#if r.description}<Fact label={m.staff_description()} wrap>{r.description}</Fact>{/if}
				{#if r.website}<Fact label={m.staff_website()}>{r.website}</Fact>{/if}
				{#if r.phone}<Fact label={m.staff_phone()}>{r.phone}</Fact>{/if}
				{#if r.addressLine}<Fact label={m.staff_address()}>{r.addressLine}</Fact>{/if}
				{#if r.submitterEmail}<Fact label={m.staff_suggested_by()}>{r.submitterEmail}</Fact>{/if}
			</DefinitionList>
		</InfoCard>

		<InfoCard title={m.staff_review()} class="bg-base-200 shadow-none">
			{#if r.status === 'rejected' && r.staffNote}
				<DefinitionList>
					<Fact label={m.staff_local_resources_id_returned_because()} wrap>{r.staffNote}</Fact>
				</DefinitionList>
			{/if}
			{#if r.reviewedAt}
				<p class="mb-3 text-muted">
					{m.staff_local_resources_id_last_reviewed({
						formatDateTime: formatDateTime(r.reviewedAt)
					})}
				</p>
			{/if}
			<div class="flex gap-2">
				{#if r.status !== 'published'}
					<Action
						action={publishLocalResourceForm}
						label={m.staff_local_resources_id_publish()}
						modalTitle={m.staff_local_resources_id_publish_2({ name: r.name })}
						submitLabel={m.staff_local_resources_id_publish()}
						successToast={m.staff_published()}
						variant="primary"
						size="sm"
					>
						{#snippet form()}
							<input {...publishFields.id.as('hidden', r.id)} />
							<p>{m.staff_local_resources_id_appears_local_resources_straight_aw()}</p>
						{/snippet}
					</Action>
				{/if}
				{#if r.status !== 'rejected'}
					<Action
						action={rejectLocalResourceForm}
						label={r.status === 'published'
							? m.staff_local_resources_id_unpublish()
							: m.staff_local_resources_id_reject()}
						modalTitle={m.staff_local_resources_id_return({ name: r.name })}
						submitLabel={m.staff_local_resources_id_return_with_note()}
						successToast={m.staff_returned()}
						size="sm"
					>
						{#snippet form()}
							<input {...rejectFields.id.as('hidden', r.id)} />
							<Field
								field={rejectFields.note}
								type="textarea"
								label={m.staff_local_resources_id_what_needs_change()}
								description={m.staff_local_resources_id_description()}
							/>
						{/snippet}
					</Action>
				{/if}
			</div>
		</InfoCard>
	</div>
</PageContent>

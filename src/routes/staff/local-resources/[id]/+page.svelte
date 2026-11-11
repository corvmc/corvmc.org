<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
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
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	const data = $derived(await getStaffLocalResource(params.id));
	const r = $derived(data.resource);
	const categoryName = $derived(data.categories.find((c) => c.id === r.categoryId)?.name ?? '—');

	const editFields = updateLocalResourceForm.fields;
	const publishFields = publishLocalResourceForm.fields;
	const rejectFields = rejectLocalResourceForm.fields;
	const removeFields = removeLocalResourceForm.fields;
</script>

<PageHeader width="3xl" title={r.name} subtitle={m.staff_local_resources_id_subtitle_body()}>
	<StatusBadge status={r.status} label />
	<Action
		action={updateLocalResourceForm}
		label={m.staff_edit_label()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_2_title({ name: r.name })}
		successToast={m.staff_saved_toast()}
	>
		{#snippet form()}
			<input {...editFields.id.as('hidden', r.id)} />
			<ResourceFields fields={editFields} categories={data.categories} values={r} />
		{/snippet}
	</Action>
	<Action
		action={removeLocalResourceForm}
		label={m.staff_remove_label()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_remove_2_title({ name: r.name })}
		submitLabel={m.staff_remove_label()}
		successToast={m.staff_local_resources_id_listing_removed_toast()}
		onsuccess={() => void goto(resolve('staff/local-resources'))}
	>
		{#snippet form()}
			<input {...removeFields.id.as('hidden', r.id)} />
			<p>{m.staff_local_resources_id_comes_off_public_page_record_text()}</p>
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="3xl">
	<div class="grid gap-6">
		<InfoCard title={m.staff_local_resources_id_listing_title()}>
			<DefinitionList>
				<Fact label={m.staff_category_label()}>{categoryName}</Fact>
				{#if r.description}<Fact label={m.staff_description_label()} wrap>{r.description}</Fact
					>{/if}
				{#if r.website}<Fact label={m.staff_website_label()}>{r.website}</Fact>{/if}
				{#if r.phone}<Fact label={m.staff_phone_label()}>{r.phone}</Fact>{/if}
				{#if r.addressLine}<Fact label={m.staff_address_label()}>{r.addressLine}</Fact>{/if}
				{#if r.submitterEmail}<Fact label={m.staff_suggested_by_label()}>{r.submitterEmail}</Fact
					>{/if}
			</DefinitionList>
		</InfoCard>

		<InfoCard title={m.staff_review_title()} class="bg-base-200 shadow-none">
			{#if r.status === 'rejected' && r.staffNote}
				<DefinitionList>
					<Fact label={m.staff_local_resources_id_returned_because_label()} wrap>{r.staffNote}</Fact
					>
				</DefinitionList>
			{/if}
			{#if r.reviewedAt}
				<p class="mb-3 text-muted">
					{m.staff_local_resources_id_last_reviewed_text({
						formatDateTime: formatDateTime(r.reviewedAt)
					})}
				</p>
			{/if}
			<div class="flex gap-2">
				{#if r.status !== 'published'}
					<Action
						action={publishLocalResourceForm}
						label={m.staff_local_resources_id_publish_label()}
						modalTitle={m.staff_local_resources_id_publish_2_title({ name: r.name })}
						submitLabel={m.staff_local_resources_id_publish_label()}
						successToast={m.staff_published_toast()}
						variant="primary"
						size="sm"
					>
						{#snippet form()}
							<input {...publishFields.id.as('hidden', r.id)} />
							<p>{m.staff_local_resources_id_appears_local_resources_straight_aw_text()}</p>
						{/snippet}
					</Action>
				{/if}
				{#if r.status !== 'rejected'}
					<Action
						action={rejectLocalResourceForm}
						label={r.status === 'published'
							? m.staff_local_resources_id_unpublish_label()
							: m.staff_local_resources_id_reject_label()}
						modalTitle={m.staff_local_resources_id_return_title({ name: r.name })}
						submitLabel={m.staff_local_resources_id_return_with_note_label()}
						successToast={m.staff_returned_toast()}
						size="sm"
					>
						{#snippet form()}
							<input {...rejectFields.id.as('hidden', r.id)} />
							<Field
								field={rejectFields.note}
								type="textarea"
								label={m.staff_local_resources_id_what_needs_change_label()}
								description={m.staff_local_resources_id_description_body()}
							/>
						{/snippet}
					</Action>
				{/if}
			</div>
		</InfoCard>
	</div>
</PageContent>

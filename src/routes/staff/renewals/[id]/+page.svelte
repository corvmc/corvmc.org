<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** One permit, license or policy: when it expires, who renews it, and its certificate. */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import RenewalFields from '#lib/components/renewal/RenewalFields.svelte';
	import { IconFileText } from '@tabler/icons-svelte';
	import {
		getRenewalDetail,
		updateRenewal,
		deleteRenewal,
		uploadRenewalDocument,
		removeRenewalDocument
	} from '#lib/remote/renewals.remote.js';
	import { renewalKindLabels } from '#lib/config.js';
	import { formatIsoDay } from '#lib/utils/deadline.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	const id = $derived(params.id);
	const r = $derived(await getRenewalDetail(id));
	const editForm = $derived(updateRenewal.for(id));
	const uploadForm = $derived(uploadRenewalDocument.for(id));

	/** A browser hint; `PRIVATE_ALLOWED_TYPES` on the server decides. */
	const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.docx';
</script>

<PageHeader title={r.name} subtitle={renewalKindLabels[r.kind]}>
	<Action
		action={editForm}
		label={m.staff_edit_label()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_2_title({ name: r.name })}
		submitLabel={m.staff_save_label()}
		successToast={m.staff_saved_toast()}
	>
		{#snippet form()}
			<input {...editForm.fields.id.as('hidden', r.id)} />
			<RenewalFields fields={editForm.fields} assignees={r.assignees} value={r} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if r.deadline.overdue}
		<Alert type="error">
			{m.staff_renewals_id_expired_once_renewed_edit_expiry_body({
				formatIsoDay: formatIsoDay(r.expiresOn)
			})}
		</Alert>
	{:else if r.daysLeft <= 60}
		<Alert type="warning">
			{m.staff_renewals_id_expires_days_body({
				formatIsoDay: formatIsoDay(r.expiresOn),
				daysLeft: r.daysLeft
			})}
		</Alert>
	{/if}

	<InfoCard title={m.staff_details_title()}>
		<DefinitionList>
			<Fact label={m.staff_expires_label()} value={formatIsoDay(r.expiresOn)} />
			<Fact label={m.staff_renewals_id_issued_by_label()} value={r.issuer ?? '—'} />
			<Fact label={m.staff_renewals_id_reference_label()} value={r.reference ?? '—'} />
			<Fact label={m.staff_responsible_label()} value={r.responsibleName ?? 'Nobody named'} />
			{#if r.notes}
				<Fact label={m.staff_notes_label()} wrap>{r.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<InfoCard title={m.staff_renewals_id_documents_title()}>
		{#snippet action()}
			<Action
				action={uploadForm}
				label={m.staff_renewals_id_attach_document_label()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_renewals_id_attach_document_2_title()}
				submitLabel={m.staff_upload_label()}
				successToast={m.staff_renewals_id_attached_toast()}
			>
				{#snippet form()}
					<input {...uploadForm.fields.id.as('hidden', r.id)} />
					<FormField
						field={uploadForm.fields.file}
						type="file"
						label={m.staff_renewals_id_file_label()}
						accept={ACCEPT}
						emptyLabel={m.staff_renewals_id_empty_label_title()}
						replaceLabel={m.staff_renewals_id_replace_label()}
						description={m.staff_renewals_id_certificate_permit_policy_pdf_photo_body()}
						required
					/>
				{/snippet}
			</Action>
		{/snippet}
		{#if r.documents.length === 0}
			<EmptyState description={m.staff_renewals_id_no_certificate_attached_yet_body()} />
		{:else}
			<ul class="space-y-2">
				{#each r.documents as doc (doc.attachmentId)}
					<li class="flex items-center gap-2">
						<IconFileText size={18} class="shrink-0 opacity-60" />
						<a class="grow link" href={doc.url} rel="external"
							>{doc.filename ?? m.staff_renewals_id_document_text()}</a
						>
						<Action
							action={removeRenewalDocument.for(doc.attachmentId)}
							label={m.staff_remove_label()}
							variant="ghost"
							size="sm"
							class="text-error"
							modalTitle={m.staff_renewals_id_remove_title({
								value: doc.filename ?? 'this document'
							})}
							submitLabel={m.staff_remove_label()}
							submitVariant="error"
							successToast={m.staff_removed_toast()}
						>
							{#snippet form()}
								<input
									{...removeRenewalDocument.for(doc.attachmentId).fields.id.as('hidden', r.id)}
								/>
								<input
									{...removeRenewalDocument
										.for(doc.attachmentId)
										.fields.attachmentId.as('hidden', doc.attachmentId)}
								/>
								<p class="text-sm">{m.staff_renewals_id_file_deleted_with_text()}</p>
							{/snippet}
						</Action>
					</li>
				{/each}
			</ul>
		{/if}
	</InfoCard>

	<div class="flex flex-wrap gap-2">
		<Action
			action={deleteRenewal.for(r.id)}
			label={m.staff_renewals_id_delete_renewal_label()}
			variant="ghost"
			size="sm"
			class="text-error"
			modalTitle={m.staff_delete_2_title({ name: r.name })}
			submitLabel={m.staff_delete_label()}
			submitVariant="error"
			successToast={m.staff_deleted_toast()}
			onsuccess={() => goto(resolve('staff/renewals'))}
		>
			{#snippet form()}
				<input {...deleteRenewal.for(r.id).fields.id.as('hidden', r.id)} />
				<p class="text-sm">
					{m.staff_renewals_id_something_collective_no_longer_holds_text()}
				</p>
			{/snippet}
		</Action>
	</div>
</PageContent>

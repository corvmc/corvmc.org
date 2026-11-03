<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/** One permit, license or policy: when it expires, who renews it, and its certificate. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import RenewalFields from '$lib/components/renewal/RenewalFields.svelte';
	import { IconFileText } from '@tabler/icons-svelte';
	import {
		getRenewalDetail,
		updateRenewal,
		deleteRenewal,
		uploadRenewalDocument,
		removeRenewalDocument
	} from '$lib/remote/renewals.remote';
	import { renewalKindLabels } from '$lib/config';
	import { formatIsoDay } from '$lib/utils/deadline';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	const id = $derived(page.params.id!);
	const r = $derived(await getRenewalDetail(id));
	const editForm = $derived(updateRenewal.for(id));
	const uploadForm = $derived(uploadRenewalDocument.for(id));

	/** A browser hint; `PRIVATE_ALLOWED_TYPES` on the server decides. */
	const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.docx';
</script>

<PageHeader title={r.name} subtitle={renewalKindLabels[r.kind]}>
	<Action
		action={editForm}
		label={m.staff_edit()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_2({ name: r.name })}
		submitLabel={m.staff_save()}
		successToast={m.staff_saved()}
	>
		{#snippet form()}
			<input type="hidden" name="id" value={r.id} />
			<RenewalFields fields={editForm.fields} assignees={r.assignees} value={r} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if r.deadline.overdue}
		<Alert type="error">
			{m.staff_renewals_id_expired_once_renewed_edit_expiry({
				formatIsoDay: formatIsoDay(r.expiresOn)
			})}
		</Alert>
	{:else if r.daysLeft <= 60}
		<Alert type="warning">
			Expires {formatIsoDay(r.expiresOn)}, in {r.daysLeft}
			{r.daysLeft === 1 ? 'day' : 'days'}.
		</Alert>
	{/if}

	<InfoCard title={m.staff_details()}>
		<DefinitionList>
			<Fact label={m.staff_expires()} value={formatIsoDay(r.expiresOn)} />
			<Fact label={m.staff_renewals_id_issued_by()} value={r.issuer ?? '—'} />
			<Fact label={m.staff_renewals_id_reference()} value={r.reference ?? '—'} />
			<Fact label={m.staff_responsible()} value={r.responsibleName ?? 'Nobody named'} />
			{#if r.notes}
				<Fact label={m.staff_notes()} wrap>{r.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<InfoCard title={m.staff_renewals_id_documents()}>
		{#snippet action()}
			<Action
				action={uploadForm}
				label={m.staff_renewals_id_attach_document()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_renewals_id_attach_document_2()}
				submitLabel={m.staff_upload()}
				successToast={m.staff_renewals_id_attached()}
			>
				{#snippet form()}
					<input type="hidden" name="id" value={r.id} />
					<FormField
						field={uploadForm.fields.file}
						type="file"
						label={m.staff_renewals_id_file()}
						accept={ACCEPT}
						emptyLabel={m.staff_renewals_id_empty_label()}
						replaceLabel={m.staff_renewals_id_replace_label()}
						description={m.staff_renewals_id_certificate_permit_policy_pdf_photo()}
						required
					/>
				{/snippet}
			</Action>
		{/snippet}
		{#if r.documents.length === 0}
			<EmptyState description={m.staff_renewals_id_no_certificate_attached_yet()} />
		{:else}
			<ul class="space-y-2">
				{#each r.documents as doc (doc.attachmentId)}
					<li class="flex items-center gap-2">
						<IconFileText size={18} class="shrink-0 opacity-60" />
						<a class="grow link" href={doc.url} rel="external">{doc.filename ?? 'Document'}</a>
						<Action
							action={removeRenewalDocument.for(doc.attachmentId)}
							label={m.staff_remove()}
							variant="ghost"
							size="sm"
							class="text-error"
							modalTitle={m.staff_renewals_id_remove({ value: doc.filename ?? 'this document' })}
							submitLabel={m.staff_remove()}
							submitVariant="error"
							successToast={m.staff_removed()}
						>
							{#snippet form()}
								<input type="hidden" name="id" value={r.id} />
								<input type="hidden" name="attachmentId" value={doc.attachmentId} />
								<p class="text-sm">{m.staff_renewals_id_file_deleted_with()}</p>
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
			label={m.staff_renewals_id_delete_renewal()}
			variant="ghost"
			size="sm"
			class="text-error"
			modalTitle={m.staff_delete_2({ name: r.name })}
			submitLabel={m.staff_delete()}
			submitVariant="error"
			successToast={m.staff_deleted()}
			onsuccess={() => goto(resolve('/staff/renewals'))}
		>
			{#snippet form()}
				<input type="hidden" name="id" value={r.id} />
				<p class="text-sm">
					{m.staff_renewals_id_something_collective_no_longer_holds()}
				</p>
			{/snippet}
		</Action>
	</div>
</PageContent>

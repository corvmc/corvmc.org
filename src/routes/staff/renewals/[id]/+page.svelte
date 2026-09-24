<script lang="ts">
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

<PageHeader title={r.name} subtitle={renewalKindLabels[r.kind]} backHref="/staff/renewals">
	<Action
		action={editForm}
		label="Edit"
		variant="ghost"
		size="sm"
		modalTitle="Edit {r.name}"
		submitLabel="Save"
		successToast="Saved"
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
			Expired {formatIsoDay(r.expiresOn)}. Once it is renewed, edit the expiry date and attach the
			new certificate.
		</Alert>
	{:else if r.daysLeft <= 60}
		<Alert type="warning">
			Expires {formatIsoDay(r.expiresOn)}, in {r.daysLeft}
			{r.daysLeft === 1 ? 'day' : 'days'}.
		</Alert>
	{/if}

	<InfoCard title="Details">
		<DefinitionList>
			<Fact label="Expires" value={formatIsoDay(r.expiresOn)} />
			<Fact label="Issued by" value={r.issuer ?? '—'} />
			<Fact label="Reference" value={r.reference ?? '—'} />
			<Fact label="Responsible" value={r.responsibleName ?? 'Nobody named'} />
			{#if r.notes}
				<Fact label="Notes" wrap>{r.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<InfoCard title="Documents">
		{#snippet action()}
			<Action
				action={uploadForm}
				label="Attach document"
				variant="ghost"
				size="sm"
				modalTitle="Attach a document"
				submitLabel="Upload"
				successToast="Attached"
			>
				{#snippet form()}
					<input type="hidden" name="id" value={r.id} />
					<FormField
						field={uploadForm.fields.file}
						type="file"
						label="File"
						accept={ACCEPT}
						emptyLabel="Choose a file"
						replaceLabel="Choose a different file"
						description="The certificate, permit or policy. PDF, photo or Word, up to 25MB."
						required
					/>
				{/snippet}
			</Action>
		{/snippet}
		{#if r.documents.length === 0}
			<EmptyState description="No certificate attached yet" />
		{:else}
			<ul class="space-y-2">
				{#each r.documents as doc (doc.attachmentId)}
					<li class="flex items-center gap-2">
						<IconFileText size={18} class="shrink-0 opacity-60" />
						<a class="grow link" href={doc.url} rel="external">{doc.filename ?? 'Document'}</a>
						<Action
							action={removeRenewalDocument.for(doc.attachmentId)}
							label="Remove"
							variant="ghost"
							size="sm"
							class="text-error"
							modalTitle="Remove {doc.filename ?? 'this document'}?"
							submitLabel="Remove"
							submitVariant="error"
							successToast="Removed"
						>
							{#snippet form()}
								<input type="hidden" name="id" value={r.id} />
								<input type="hidden" name="attachmentId" value={doc.attachmentId} />
								<p class="text-sm">The file is deleted with it.</p>
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
			label="Delete renewal"
			variant="ghost"
			size="sm"
			class="text-error"
			modalTitle="Delete {r.name}?"
			submitLabel="Delete"
			submitVariant="error"
			successToast="Deleted"
			onsuccess={() => goto(resolve('/staff/renewals'))}
		>
			{#snippet form()}
				<input type="hidden" name="id" value={r.id} />
				<p class="text-sm">
					For something the collective no longer holds. A renewed one keeps its row: edit the expiry
					date instead.
				</p>
			{/snippet}
		</Action>
	</div>
</PageContent>

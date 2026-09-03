<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { formatBytes, formatDateShort } from '$lib/utils/format';
	import { deleteDocument } from '$lib/remote/files.remote';
	import DocumentUploadAction from './DocumentUploadAction.svelte';
	import type { DocumentUsage, FileView } from '$lib/server/group/file-service';

	/**
	 * A group's shared documents, wherever they are shown.
	 *
	 * Mount-agnostic by construction, exactly as `AnnouncementList` is: it takes
	 * the files and the group id as props and fetches nothing. That is what keeps
	 * its surface inside one load-bearing query — a component reaching for its
	 * own remote query is the fan-out `custom/no-concurrent-remote-queries` bans.
	 *
	 * Every link here points at `/api/files/[id]`, which authorizes against the
	 * file's own group and streams the object back as an attachment. There is no
	 * R2 key on `FileView` to render, and no function in the app that would turn
	 * one into a URL.
	 */
	let {
		groupId,
		files,
		usage,
		canManage
	}: {
		groupId: string;
		files: FileView[];
		usage: DocumentUsage;
		canManage: boolean;
	} = $props();

	const deleteFields = deleteDocument.fields;

	const atQuota = $derived(
		usage.fileCount >= usage.quotaFiles || usage.usedBytes >= usage.quotaBytes
	);
</script>

{#if canManage}
	<div class="flex flex-wrap items-center justify-end gap-3">
		<!-- Managers only. A member who cannot upload has no use for a number
		     describing a limit they will never meet. -->
		<span class="text-subtle">
			{formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)} · {usage.fileCount} of {usage.quotaFiles}
			documents
		</span>
		<DocumentUploadAction {groupId} {atQuota} />
	</div>
{/if}

{#if files.length === 0}
	<EmptyState
		description={canManage
			? 'Nothing here yet. Upload minutes, charts, or anything the group shares.'
			: 'Nothing here yet.'}
	/>
{:else}
	<Table>
		{#snippet head()}
			<th>File</th>
			<th class="col-support">Added by</th>
			<th class="col-support w-px whitespace-nowrap">Size</th>
			<th class="col-extra w-px whitespace-nowrap">Added</th>
			{#if canManage}
				<th class="w-px"><span class="sr-only">Actions</span></th>
			{/if}
		{/snippet}
		{#each files as doc (doc.id)}
			<tr>
				<td class="cell-primary">
					<!-- `download` is a hint; the response's Content-Disposition is what
					     actually forces it, and it is set server-side because a link
					     attribute is not a security control. -->
					<a
						class="link"
						href={resolve('/api/files/[id=uuid]', { id: doc.id })}
						download={doc.filename}
					>
						{doc.filename}
					</a>
					{#if doc.description}
						<div class="text-subtle">{doc.description}</div>
					{/if}
				</td>
				<td class="col-support">
					{#if doc.uploadedBy}
						<EntityIdentity ref={doc.uploadedBy} size="sm" />
					{:else}
						<span class="text-subtle">Former member</span>
					{/if}
				</td>
				<td class="col-support w-px whitespace-nowrap">{formatBytes(doc.sizeBytes)}</td>
				<td class="col-extra w-px whitespace-nowrap">{formatDateShort(doc.createdAt)}</td>
				{#if canManage}
					<td class="w-px">
						<Action
							action={deleteDocument.for(doc.id)}
							label="Delete"
							modalTitle="Delete document"
							submitLabel="Delete"
							confirm="Delete “{doc.filename}”? It comes off the list for everyone."
							successToast="Deleted"
							variant="error"
							size="xs"
							outline
							onsuccess={() => invalidateAll()}
							onfailure={() => toast.error('Failed to delete')}
						>
							{#snippet form()}
								<input {...deleteFields.groupId.as('hidden', groupId)} />
								<input {...deleteFields.id.as('hidden', doc.id)} />
							{/snippet}
						</Action>
					</td>
				{/if}
			</tr>
		{/each}
	</Table>
{/if}

<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import { CERT_DESCRIPTION_MAX } from '$lib/config';
	import { IconPencil, IconArchive, IconArchiveOff, IconTrash } from '@tabler/icons-svelte';
	import {
		getCertifications,
		createCertification,
		updateCertification,
		archiveCertification,
		restoreCertification,
		deleteCertification
	} from '$lib/remote/volunteer.remote';

	let certifications = $derived(getCertifications());

	const descriptionHelp =
		'Markdown. Members read this when a role they want needs the clearance, so say how to get it.';
	const issuedByHelp = 'Leave blank for a clearance CMC grants itself.';
	const validityHelp = 'Blank means it never expires. Applies to future grants only.';
</script>

<PageHeader title="Certifications" subtitle="Staff" backHref="/staff/volunteer">
	<Button href="/staff/volunteer/clearances" variant="ghost" size="sm">Who's cleared</Button>
	<Action
		action={createCertification}
		label="New Certification"
		modalTitle="New certification"
		submitLabel="Create"
		successToast="Certification created"
	>
		{#snippet form()}
			<FormField name="name" label="Name" type="text" />
			<FormField
				name="description"
				label="What it covers"
				type="textarea"
				description={descriptionHelp}
				maxlength={CERT_DESCRIPTION_MAX}
			/>
			<FormField name="issuedBy" label="Issued by" type="text" description={issuedByHelp} />
			<FormField
				name="validityMonths"
				label="Valid for (months)"
				type="number"
				min="1"
				description={validityHelp}
			/>
			<FormField name="displayOrder" label="Display order" type="number" value="0" />
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="3xl">
	{#await certifications then rows}
		{#if rows.length === 0}
			<EmptyState
				title="No certifications yet"
				description="Add one and roles can start requiring it before someone works them alone."
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Certification</th>
					<th class="col-support">Validity</th>
					<th class="col-support cell-num">Holders</th>
					<th class="col-extra cell-num">Roles</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}

				{#each rows as cert (cert.id)}
					<tr class="hover">
						<td class="w-px">
							<StatusBadge status={cert.isActive ? 'active' : 'retired'} />
						</td>

						<td class="cell-primary">
							<div class="truncate font-medium">{cert.name}</div>
							<div class="truncate text-subtle">
								{cert.issuedBy ?? 'Granted by CMC'}
							</div>
						</td>

						<td class="col-support whitespace-nowrap">
							{cert.validityMonths ? `${cert.validityMonths} months` : 'No expiry'}
						</td>
						<td class="col-support cell-num">{cert.holderCount}</td>
						<td class="col-extra cell-num">{cert.roleCount}</td>

						<td class="w-px">
							<div class="flex justify-end gap-1">
								<Action
									action={updateCertification.for(cert.id)}
									label="Edit"
									iconOnly
									icon={pencilIcon}
									variant="ghost"
									size="sm"
									modalTitle="Edit {cert.name}"
									successToast="Certification updated"
								>
									{#snippet form()}
										<input type="hidden" name="id" value={cert.id} />
										<FormField name="name" label="Name" type="text" value={cert.name} />
										<FormField
											name="description"
											label="What it covers"
											type="textarea"
											value={cert.description ?? ''}
											description={descriptionHelp}
											maxlength={CERT_DESCRIPTION_MAX}
										/>
										<FormField
											name="issuedBy"
											label="Issued by"
											type="text"
											value={cert.issuedBy ?? ''}
											description={issuedByHelp}
										/>
										<FormField
											name="validityMonths"
											label="Valid for (months)"
											type="number"
											min="1"
											value={cert.validityMonths ? String(cert.validityMonths) : ''}
											description="Blank means it never expires. Changing this applies to future grants only — the {cert.holderCount} already issued keep the expiry they were given."
										/>
										<FormField
											name="displayOrder"
											label="Display order"
											type="number"
											value={String(cert.displayOrder)}
										/>
									{/snippet}
								</Action>

								{#if cert.isActive}
									<Action
										action={archiveCertification.for(cert.id)}
										label="Archive"
										iconOnly
										icon={archiveIcon}
										variant="ghost"
										size="sm"
										modalTitle="Archive {cert.name}?"
										submitLabel="Archive"
										successToast="Certification archived"
									>
										{#snippet form()}
											<input type="hidden" name="id" value={cert.id} />
											<p class="text-sm">
												It disappears from the grant form. Everyone who holds it keeps it, and roles
												that require it still require it.
											</p>
										{/snippet}
									</Action>
								{:else}
									<Action
										action={restoreCertification.for(cert.id)}
										label="Restore"
										iconOnly
										icon={unarchiveIcon}
										variant="ghost"
										size="sm"
										modalTitle="Restore {cert.name}?"
										submitLabel="Restore"
										successToast="Certification restored"
									>
										{#snippet form()}
											<input type="hidden" name="id" value={cert.id} />
											<p class="text-sm">Staff will be able to grant this again.</p>
										{/snippet}
									</Action>
								{/if}

								<!--
									Delete only when nobody holds it. A held clearance is the record
									of who was cleared and when, which is the whole reason the FK
									restricts.
								-->
								{#if cert.holderCount === 0}
									<Action
										action={deleteCertification.for(cert.id)}
										label="Delete"
										iconOnly
										icon={trashIcon}
										variant="ghost"
										size="sm"
										class="text-error"
										modalTitle="Delete {cert.name}?"
										submitLabel="Delete"
										submitVariant="error"
										successToast="Certification deleted"
									>
										{#snippet form()}
											<input type="hidden" name="id" value={cert.id} />
											<p class="text-sm">Nobody holds this, so it can be removed outright.</p>
										{/snippet}
									</Action>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/await}
</PageContent>

{#snippet pencilIcon()}
	<IconPencil size={16} />
{/snippet}

{#snippet archiveIcon()}
	<IconArchive size={16} />
{/snippet}

{#snippet unarchiveIcon()}
	<IconArchiveOff size={16} />
{/snippet}

{#snippet trashIcon()}
	<IconTrash size={16} />
{/snippet}

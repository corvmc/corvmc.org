<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** Records that may be one person or one organization; merged only by hand (#2622). */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { getDuplicates, mergeOrganizations, mergePeople } from '#lib/remote/contacts.remote.js';
	import { resolve } from '$app/paths';

	const dupes = $derived(await getDuplicates());
	const empty = $derived(dupes.contacts.length === 0 && dupes.organizations.length === 0);
</script>

<PageHeader
	title={m.staff_contacts_duplicates_title()}
	subtitle={m.staff_contacts_duplicates_body()}
/>

<PageContent>
	{#if empty}
		<EmptyState title={m.staff_contacts_no_duplicates_title()} />
	{/if}

	{#if dupes.organizations.length > 0}
		<InfoCard title={m.staff_contacts_duplicate_organizations_title()}>
			<div class="space-y-4">
				{#each dupes.organizations as group (group.domain)}
					<div data-testid="duplicate-organizations">
						<p class="text-muted text-sm">
							{m.staff_contacts_same_website_text({ domain: group.domain })}
						</p>
						<ul class="space-y-1">
							{#each group.organizations as org (org.id)}
								{@const others = group.organizations.filter((o) => o.id !== org.id)}
								<li class="flex flex-wrap items-center gap-2">
									<a class="link font-medium" href={resolve(`staff/contacts/${org.id}`)}
										>{org.name}</a
									>
									{#each others as other (other.id)}
										{@const merge = mergeOrganizations.for(`${org.id}:${other.id}`)}
										<Action
											action={merge}
											label={m.staff_contacts_merge_into_label({
												other: other.name,
												name: org.name
											})}
											variant="ghost"
											size="xs"
											modalTitle={m.staff_contacts_merge_title({
												other: other.name,
												name: org.name
											})}
											confirm={m.staff_contacts_merge_body()}
											successToast={m.staff_contacts_merged_toast()}
										>
											{#snippet form()}
												<input {...merge.fields.survivorId.as('hidden', org.id)} />
												<input {...merge.fields.otherId.as('hidden', other.id)} />
											{/snippet}
										</Action>
									{/each}
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		</InfoCard>
	{/if}

	{#if dupes.contacts.length > 0}
		<InfoCard title={m.staff_contacts_duplicate_people_title()}>
			<div class="space-y-4">
				{#each dupes.contacts as group, i (`${group.reason}:${i}`)}
					<div data-testid="duplicate-people">
						<p class="text-muted text-sm">
							{group.reason === 'name'
								? m.staff_contacts_same_name_text()
								: m.staff_contacts_same_phone_text()}
						</p>
						<ul class="space-y-1">
							{#each group.people as person (person.id)}
								{@const others = group.people.filter((p) => p.id !== person.id)}
								{@const name = person.name ?? person.email ?? m.staff_contacts_unnamed_text()}
								<li class="flex flex-wrap items-center gap-2">
									<span class="font-medium">{name}</span>
									{#if person.organizationId}
										<a
											class="link text-muted"
											href={resolve(`staff/contacts/${person.organizationId}`)}
											>{person.organization}</a
										>
									{/if}
									{#if person.email}<span class="text-muted">{person.email}</span>{/if}
									{#each others as other (other.id)}
										{@const merge = mergePeople.for(`${person.id}:${other.id}`)}
										<Action
											action={merge}
											label={m.staff_contacts_merge_into_label({
												other: other.name ?? other.email ?? m.staff_contacts_unnamed_text(),
												name
											})}
											variant="ghost"
											size="xs"
											modalTitle={m.staff_contacts_merge_title({
												other: other.name ?? other.email ?? m.staff_contacts_unnamed_text(),
												name
											})}
											confirm={m.staff_contacts_merge_body()}
											successToast={m.staff_contacts_merged_toast()}
										>
											{#snippet form()}
												<input {...merge.fields.survivorId.as('hidden', person.id)} />
												<input {...merge.fields.otherId.as('hidden', other.id)} />
											{/snippet}
										</Action>
									{/each}
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		</InfoCard>
	{/if}
</PageContent>

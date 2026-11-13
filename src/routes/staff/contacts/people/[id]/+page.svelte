<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** One person CMC works with: their details, timeline and tasks (#2622). */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import RelatedTasks from '#lib/components/task/RelatedTasks.svelte';
	import RelatedShifts from '#lib/components/volunteer/RelatedShifts.svelte';
	import PartyTimeline from '../../PartyTimeline.svelte';
	import { getPersonPage } from '#lib/remote/contacts.remote.js';
	import { partyRoleLabels } from '#lib/config.js';
	import { resolve } from '$app/paths';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');
	const id = $derived(params.id);
	const person = $derived(await getPersonPage(id));
</script>

<PageHeader
	title={person.name ?? m.staff_contacts_unnamed_title()}
	subtitle={m.staff_contacts_person_body()}
/>

<PageContent>
	<InfoCard title={m.staff_contacts_details_title()}>
		<DefinitionList>
			<Fact label={m.staff_contacts_organization_label()}>
				{#if person.organizationId}
					<a class="link" href={resolve('/staff/contacts/[id]', { id: person.organizationId })}
						>{person.organizationName}</a
					>
				{:else}
					{m.staff_contacts_no_organization_text()}
				{/if}
			</Fact>
			<Fact label={m.staff_contacts_job_title_label()} value={person.role ?? '—'} />
			<Fact label={m.staff_email_label()} value={person.email ?? '—'} />
			<Fact label={m.staff_phone_label()} value={person.phone ?? '—'} />
			{#if person.roles.length > 0}
				<Fact
					label={m.staff_contacts_roles_label()}
					value={person.roles.map((r) => partyRoleLabels[r]).join(', ')}
				/>
			{/if}
			{#if person.notes}
				<Fact label={m.staff_notes_label()} wrap>{person.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<PartyTimeline party={{ type: 'contact', id: person.id }} canManage={person.canManage} />
	<RelatedTasks subject={{ type: 'contact', id: person.id }} />
	<RelatedShifts subject={{ type: 'contact', id: person.id }} />
</PageContent>

<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import StatusBadge from './StatusBadge.svelte';

	const { Story } = defineMeta({
		title: 'Shared/StatusBadge',
		component: StatusBadge,
		tags: ['autodocs'],
		args: { label: true }
	});
</script>

<Story name="Scheduled" args={{ status: 'scheduled' }} />
<Story name="Confirmed" args={{ status: 'confirmed' }} />
<Story name="Cancelled" args={{ status: 'cancelled' }} />
<Story name="Pending" args={{ status: 'pending' }} />
<Story name="Published" args={{ status: 'published' }} />
<Story name="Draft" args={{ status: 'draft' }} />
<Story name="Icon only" args={{ status: 'confirmed', label: false }} />

<!-- These vocabularies used to hit the fallback, which was a red circle-x — so
     available equipment, checked-in tickets and returned loans all read as
     errors. `StatusBadge.spec.ts` asserts the maps stay exhaustive; these
     stories make the result visible. -->
<Story name="Equipment: available" args={{ status: 'available' }} />
<Story name="Equipment: maintenance" args={{ status: 'maintenance' }} />
<Story name="Equipment: retired" args={{ status: 'retired' }} />
<Story name="Loan: requested" args={{ status: 'requested' }} />
<Story name="Loan: checked out" args={{ status: 'checked_out' }} />
<Story name="Loan: returned" args={{ status: 'returned' }} />
<Story name="Ticket: valid" args={{ status: 'valid' }} />
<Story name="Ticket: checked in" args={{ status: 'checked_in' }} />
<Story name="Campaign: sending" args={{ status: 'sending' }} />
<Story name="Campaign: sent" args={{ status: 'sent' }} />
<Story name="Deactivated" args={{ status: 'deactivated' }} />

<!-- An unmapped status: a neutral dot, deliberately not an error glyph. -->
<Story name="Unmapped fallback" args={{ status: 'something_new' }} />

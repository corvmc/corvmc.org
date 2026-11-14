<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Alert from '#lib/components/ui/Alert.svelte';

	/**
	 * Names the first waitlisted vendor while the market has free tables, so a
	 * withdrawal or no-show points at who to offer the table to (#2832).
	 */
	let {
		applications,
		tableCount
	}: {
		applications: {
			status: string;
			businessName: string;
			tablesRequested: number;
			decidedAt: Date | null;
			createdAt: Date;
		}[];
		tableCount: number | null;
	} = $props();

	const free = $derived(
		tableCount === null
			? 0
			: tableCount -
					applications
						.filter((a) => a.status === 'accepted')
						.reduce((n, a) => n + a.tablesRequested, 0)
	);
	const first = $derived(
		applications
			.filter((a) => a.status === 'waitlisted')
			.toSorted(
				(a, b) => (a.decidedAt ?? a.createdAt).getTime() - (b.decidedAt ?? b.createdAt).getTime()
			)[0]
	);
</script>

{#if first && free > 0}
	<Alert type="info">
		{m.market_waitlist_first_body({ free, businessName: first.businessName })}
	</Alert>
{/if}

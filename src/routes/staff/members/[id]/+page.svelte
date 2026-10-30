<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import { parseTab, type TabKey } from './tabs';
	import MemberRecord from './MemberRecord.svelte';

	let id = $derived(page.params.id!);

	// Seeded from the query string and mirrored back into it, so a staff member
	// can hand someone a link to the tab they are talking about.
	let tab = $state<TabKey>(parseTab(page.url.searchParams.get('tab')));

	// `replaceState` (shallow routing), not `goto`: a tab change is not a
	// navigation, and `goto` runs `FormGuard`'s beforeNavigate, so a dirty Account
	// form turned every tab click into an "unsaved changes" dialog. `tab` is read
	// back out of the URL only on mount, so a reload or a copied link lands right.
	$effect(() => {
		const href = withQuery(resolve(`/staff/members/${id}`), tab === 'overview' ? '' : `tab=${tab}`);
		if (location.pathname + location.search !== href) {
			replaceState(href, {});
		}
	});
</script>

<MemberRecord {id} bind:tab />

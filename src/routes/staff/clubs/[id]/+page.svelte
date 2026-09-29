<script lang="ts">
	import { page } from '$app/state';
	import StaffGroupDetail from '$lib/components/groups/StaffGroupDetail.svelte';
	import { getStaffGroupPage } from '$lib/remote/groups.remote';

	let id = $derived(page.params.id!);
	const data = $derived(await getStaffGroupPage(id));
</script>

<StaffGroupDetail group={data.group} members={data.members} />

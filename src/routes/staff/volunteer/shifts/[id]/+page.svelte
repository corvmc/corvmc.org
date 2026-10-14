<script lang="ts">
	import { page } from '$app/state';
	import WorkOrderView from '$lib/components/volunteer/WorkOrderView.svelte';
	import { getStaffShiftPage } from '$lib/remote/volunteer.remote';

	/** Work on no project; a project's work order is redirected to its task page. */
	const view = $derived(await getStaffShiftPage(page.params.id!));
</script>

<WorkOrderView {view} subtitle="Shift" backHref="/staff/volunteer/schedule" />

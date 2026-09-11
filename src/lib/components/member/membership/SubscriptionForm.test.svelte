<script lang="ts">
	/**
	 * The real mounting: every panel layout wraps its page in an
	 * ErrorToastBoundary, and `<Form>` hands a thrown failure to that instead of
	 * toasting itself. #1000 says nothing reaches the member here.
	 */
	import ErrorToastBoundary from '$lib/components/ui/ErrorToastBoundary.svelte';
	import SubscriptionForm from './SubscriptionForm.svelte';
	import type { ComponentProps } from 'svelte';

	let { remote }: { remote: ComponentProps<typeof SubscriptionForm>['remote'] } = $props();
</script>

<ErrorToastBoundary>
	<SubscriptionForm mode="create" {remote} />
</ErrorToastBoundary>

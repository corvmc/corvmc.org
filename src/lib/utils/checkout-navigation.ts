import { goto } from '$app/navigation';

/** Send the buyer to the in-app `/checkout/<session>` that `checkout()` returned. */
export async function goToCheckout(url: string): Promise<void> {
	await goto(url);
}

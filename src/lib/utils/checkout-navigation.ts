import { goto } from '$app/navigation';

/**
 * Send the buyer to wherever `checkout()` said to pay.
 *
 * `hosted_page` returns an absolute checkout.stripe.com URL (a document load),
 * `elements` the in-app `/checkout/<session>` (a client-side navigation). The
 * client is never told which, so branch on the URL — a product then migrates by
 * adding one option to one server call, and nothing here moves with it.
 */
export async function goToCheckout(url: string): Promise<void> {
	// Protocol-relative (`//host/…`) is another origin too, and `startsWith('http')`
	// alone would treat it as a local path and hand it to `goto`.
	if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(url)) {
		window.location.href = url;
		return;
	}

	await goto(url);
}

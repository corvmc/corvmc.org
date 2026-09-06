import { goto } from '$app/navigation';

/**
 * Send the buyer to wherever `checkout()` said to pay.
 *
 * The destination depends on the session's `uiMode`, which is a server decision
 * the client never sees: `hosted_page` returns an absolute `checkout.stripe.com`
 * URL, `elements` returns the in-app `/checkout/<session>`. One is another
 * origin and needs a document load; the other is a route in this app and should
 * be a client-side navigation like any other link.
 *
 * So branch on the URL rather than on a flag. Every caller then keeps working
 * unchanged as its product migrates, which is the point — a product moves by
 * adding `uiMode: 'elements'` to one server call, and nothing on the client has
 * to move with it.
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

/**
 * What a scan actually decoded.
 *
 * Two different things arrive through the same camera. A CMC asset tag carries a
 * QR encoding `https://corvmc.org/a/{tag}` — a full URL, because a phone's own
 * camera has to be able to resolve it with no app installed, which is the whole
 * reason the tag is a QR rather than a number. A consumable arrives with the
 * manufacturer's UPC already printed on the box, and that scans as a bare digit
 * string.
 *
 * So the caller cannot treat a decoded string as either one without asking, and
 * this is where the asking lives. The camera is plumbing; this is the logic.
 */
export type ScanResult =
	/** A CMC asset tag, unwrapped from its `/a/{tag}` URL. */
	| { kind: 'tag'; value: string }
	/** A manufacturer barcode — GTIN-8/12/13/14, matching `inventory_item.gtin`. */
	| { kind: 'gtin'; value: string }
	/** Decoded cleanly, but it is neither of ours. */
	| { kind: 'unknown'; value: string };

/** GTIN-8, UPC-A (12), EAN-13 and GTIN-14 are the lengths retail actually uses. */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Read one decoded barcode.
 *
 * Deliberately tolerant about the URL: a tag may be scanned from a sticker
 * printed before a domain change, from `http://`, or with the origin missing
 * altogether if somebody typed it. What identifies it is the `/a/` path, not the
 * host — so any host is accepted, and a bare `/a/CMC-000110` works too.
 */
export function parseScan(raw: string): ScanResult {
	const text = raw.trim();
	if (!text) return { kind: 'unknown', value: '' };

	const tag = tagFromPath(text);
	if (tag) return { kind: 'tag', value: tag };

	// Digits only, and a length retail actually assigns. A run of digits that is
	// not a GTIN length is far more likely to be a serial number than a barcode,
	// and guessing wrong sends the caller looking up the wrong column.
	if (/^\d+$/.test(text) && GTIN_LENGTHS.has(text.length)) {
		return { kind: 'gtin', value: text };
	}

	return { kind: 'unknown', value: text };
}

/** The `{tag}` in `…/a/{tag}`, or null if the text is not one of our URLs. */
function tagFromPath(text: string): string | null {
	// `URL` rejects a bare path, so try it as a path first and fall back.
	const path = text.startsWith('/') ? text : safeUrlPath(text);
	if (!path) return null;

	const match = /^\/a\/([^/?#]+)\/?$/.exec(path);
	if (!match) return null;

	// The tag is percent-encoded in the URL even though ours need no escaping,
	// so decode rather than assuming.
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

function safeUrlPath(text: string): string | null {
	try {
		return new URL(text).pathname;
	} catch {
		return null;
	}
}

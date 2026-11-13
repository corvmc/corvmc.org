/**
 * An event's short code: the `<code>` in `corvmc.org/e/<code>`, printed under a
 * poster's QR code. Lowercase, with no 0/o, 1/l/i look-alikes, so it can be
 * typed off paper. 31^6 is about 887 million codes. The migration's SQL backfill
 * spells the same alphabet out, so the two must change together.
 */
export const SHORT_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
export const SHORT_CODE_LENGTH = 6;

const pattern = new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`);

export function newShortCode(): string {
	const n = SHORT_CODE_ALPHABET.length;
	// Bytes at or past the last whole multiple of n are redrawn, so no letter is favoured.
	const limit = 256 - (256 % n);
	let code = '';
	while (code.length < SHORT_CODE_LENGTH) {
		const [byte] = crypto.getRandomValues(new Uint8Array(1));
		if (byte < limit) code += SHORT_CODE_ALPHABET[byte % n];
	}
	return code;
}

/** The code as typed, read leniently: case and surrounding spaces do not matter. */
export function normalizeShortCode(input: string): string | null {
	const code = input.trim().toLowerCase();
	return pattern.test(code) ? code : null;
}

import { encode } from 'uqr';
import { C } from './brand';
// The full-colour speaker cabinet without its sound lines (the design system's favicon).
import speakerMark from './assets/cmc-speaker-mark.svg?raw';

/** How much of the code's width the cleared centre takes, at most. */
export const LOGO_SHARE = 0.2;

// The mark's own proportions, from its trimmed viewBox (181 x 226).
const MARK_RATIO = 181 / 226;

/** The modules a centred logo square clears: its first row and column, and its width. */
export function logoSquare(size: number, share = LOGO_SHARE) {
	let width = Math.floor(size * share);
	// Same parity as the code, so the square sits exactly in the middle.
	if ((size - width) % 2 !== 0) width -= 1;
	return { start: (size - width) / 2, width };
}

/**
 * A poster's QR code: navy on cream at error correction H, with the speaker
 * cabinet on a cream square in the centre. H recovers 30% of the code, so the
 * cleared square stays well inside it; the finder patterns sit in the corners
 * and are never touched. `border` is the quiet zone, in modules.
 */
export function posterQr(url: string, border = 1): string {
	const { data, size } = encode(url, { ecc: 'H', border: 0 });
	const { start, width } = logoSquare(size);
	const inLogo = (x: number, y: number) =>
		x >= start && x < start + width && y >= start && y < start + width;
	let path = '';
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (data[y][x] && !inLogo(x, y)) path += `M${x + border},${y + border}h1v1h-1z`;
		}
	}
	const full = size + 2 * border;
	// Half a module of cream above and below the mark; it is taller than wide.
	const h = width - 1;
	const w = h * MARK_RATIO;
	const x = start + border + (width - w) / 2;
	const y = start + border + 0.5;
	const mark = speakerMark.replace(/^<svg /, `<svg x="${x}" y="${y}" width="${w}" height="${h}" `);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}"><rect width="${full}" height="${full}" fill="${C.cream}"/><path fill="${C.navy}" shape-rendering="crispEdges" d="${path}"/>${mark}</svg>`;
}

import { render } from '@cf-wasm/og';
import lexendRegular from './assets/Lexend-Regular.ttf?inline';
import lexendBold from './assets/Lexend-Bold.ttf?inline';
import speaker from './assets/cmc-speaker.png?inline';

/**
 * The pieces every CMC poster shares. Brand rules from the design system:
 * Lexend only, flat fills on cream, a hard-stop tri-stripe, and the speaker
 * mascot. Fonts are bundled so a render never waits on a third party.
 */

export const C = {
	cream: '#fffbf6',
	navy: '#003b5c',
	teal: '#00859b',
	orange: '#e5771e',
	goldenrod: '#ffb500',
	redOrange: '#f84d13',
	brown: '#5a3d2b'
};

/** A sponsor as a poster shows it: the logo when it can be drawn, else the name. */
export interface SponsorLogo {
	name: string;
	src: string | null;
}

export type Node = { type: string; props: Record<string, unknown> };

export function el(
	type: string,
	style: Record<string, unknown>,
	children?: unknown,
	extra = {}
): Node {
	return { type, props: { style, children, ...extra } };
}

export const stripe = (height: number) =>
	el('div', { display: 'flex', flexDirection: 'column', width: '100%' }, [
		el('div', { height, background: C.teal }),
		el('div', { height, background: C.goldenrod }),
		el('div', { height, background: C.redOrange })
	]);

export function mascot(width: number): Node {
	return el(
		'img',
		{ width, height: Math.round((width * 125) / 255), flexShrink: 0, marginLeft: 24 },
		undefined,
		{ src: speaker }
	);
}

/** A row of sponsor logos under a label, or nothing when there are none. */
export function sponsorRow(sponsors: SponsorLogo[], logoHeight: number): Node | null {
	if (sponsors.length === 0) return null;
	const box = { width: Math.round(logoHeight * 2.6), height: logoHeight };
	return el('div', { display: 'flex', alignItems: 'center', gap: 28 }, [
		el(
			'div',
			{ color: C.teal, fontSize: Math.round(logoHeight * 0.3), fontWeight: 700, letterSpacing: 4 },
			'SPONSORED BY'
		),
		...sponsors.map((s) =>
			s.src
				? el('img', { ...box, objectFit: 'contain' }, undefined, { src: s.src })
				: el(
						'div',
						{
							display: 'flex',
							alignItems: 'center',
							height: box.height,
							color: C.navy,
							fontSize: Math.round(logoHeight * 0.36),
							fontWeight: 700
						},
						s.name
					)
		)
	]);
}

function dataUrlBytes(dataUrl: string): ArrayBuffer {
	const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out.buffer;
}

export function bytesDataUrl(bytes: Uint8Array, contentType: string): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return `data:${contentType};base64,${btoa(bin)}`;
}

/** Rasterize a poster tree to PNG in Lexend. */
export async function renderPng(tree: Node, width: number, height: number): Promise<Uint8Array> {
	const png = await render(tree as never, {
		width,
		height,
		fonts: [
			{ name: 'Lexend', data: dataUrlBytes(lexendRegular), weight: 400, style: 'normal' },
			{ name: 'Lexend', data: dataUrlBytes(lexendBold), weight: 700, style: 'normal' }
		]
	}).asPng();
	return png.image;
}

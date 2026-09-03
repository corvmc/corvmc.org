/**
 * The one-pager inside the downloadable package.
 *
 * A pure function returning a self-contained HTML string: styles inline, images
 * referenced by their path *inside the zip*, so the unzipped folder opens and
 * renders with no network at all. That is the point of the format — a venue
 * that saved the folder six months ago can still read it.
 *
 * Returning a string rather than a Response is also what makes the deferred
 * step cheap. When a real `press-kit.pdf` arrives via Cloudflare Browser
 * Rendering, it renders *this*, and none of the layout below is thrown away.
 *
 * Everything here escapes. The only exception is `bio`, which arrives as
 * already-sanitized markdown HTML from `sanitizeBio`.
 */
import QRCode from 'qrcode-svg';
import type { FullPressKit } from '$lib/types/band-page';

export interface PressKitDocument {
	name: string;
	tagline: string | null;
	/** Pre-sanitized HTML, from `sanitizeBio`. */
	bioHtml: string | null;
	genres: string[];
	hometown: string | null;
	foundedYear: string | null;
	/** The act's public address — what the QR encodes and the footer prints. */
	url: string | null;
	members: { name: string; position: string | null }[];
	shows: { title: string; when: string; where: string | null }[];
	links: { label: string; url: string }[];
	epk: FullPressKit;
	/** Paths *within the zip*, not URLs. */
	photoPaths: string[];
	riderPath: string | null;
	stagePlotPath: string | null;
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** `null` when there is no address to encode — a QR of nothing is worse than none. */
function qrSvg(url: string | null): string | null {
	if (!url) return null;
	return new QRCode({
		content: url,
		padding: 0,
		width: 120,
		height: 120,
		color: '#000000',
		background: '#ffffff',
		ecl: 'M',
		join: true
	}).svg();
}

function contactBlock(label: string, c?: { name: string; email: string; phone?: string }): string {
	if (!c?.email && !c?.name) return '';
	return `<div class="contact">
  <p class="contact__role">${escapeHtml(label)}</p>
  <p class="contact__name">${escapeHtml(c.name)}</p>
  ${c.email ? `<p>${escapeHtml(c.email)}</p>` : ''}
  ${c.phone ? `<p>${escapeHtml(c.phone)}</p>` : ''}
</div>`;
}

function section(title: string, body: string): string {
	return body.trim() ? `<section><h2>${escapeHtml(title)}</h2>${body}</section>` : '';
}

export function renderPressKitHtml(doc: PressKitDocument): string {
	const epk = doc.epk;
	const qr = qrSvg(doc.url);

	const facts = [
		doc.genres.length ? doc.genres.join(' · ') : null,
		doc.hometown,
		doc.foundedYear ? `Formed ${doc.foundedYear}` : null
	].filter(Boolean) as string[];

	const photos = doc.photoPaths
		.map((p) => `<img src="${escapeHtml(p)}" alt="${escapeHtml(doc.name)}" />`)
		.join('\n');

	const members = doc.members
		.map(
			(m) =>
				`<li>${escapeHtml(m.name)}${m.position ? ` <span class="muted">— ${escapeHtml(m.position)}</span>` : ''}</li>`
		)
		.join('\n');

	const shows = doc.shows
		.map(
			(s) =>
				`<li><span class="show__when">${escapeHtml(s.when)}</span> ${escapeHtml(s.title)}${s.where ? ` <span class="muted">· ${escapeHtml(s.where)}</span>` : ''}</li>`
		)
		.join('\n');

	const quotes = epk.pressQuotes
		.filter((q) => q.quote.trim())
		.map(
			(q) =>
				`<figure><blockquote>${escapeHtml(q.quote)}</blockquote><figcaption>— ${escapeHtml(q.publication)}${q.date ? ` (${escapeHtml(q.date)})` : ''}</figcaption></figure>`
		)
		.join('\n');

	const achievements = epk.achievements
		.filter((a) => a.trim())
		.map((a) => `<li>${escapeHtml(a)}</li>`)
		.join('\n');

	const backline = epk.backline.length
		? `<table>
  <thead><tr><th>Instrument</th><th>Details</th><th>Provided by</th></tr></thead>
  <tbody>${epk.backline
		.map(
			(b) =>
				`<tr><td>${escapeHtml(b.instrument)}</td><td>${escapeHtml(b.details)}</td><td>${b.provided ? 'The act' : 'Venue'}</td></tr>`
		)
		.join('')}</tbody>
</table>`
		: '';

	const attachments = [
		doc.stagePlotPath ? `<li>Stage plot — <code>${escapeHtml(doc.stagePlotPath)}</code></li>` : '',
		doc.riderPath ? `<li>Tech rider — <code>${escapeHtml(doc.riderPath)}</code></li>` : ''
	]
		.filter(Boolean)
		.join('\n');

	const videos = epk.videos
		.filter((v) => v.url.trim())
		.map((v) => `<li>${escapeHtml(v.label || 'Live video')} — ${escapeHtml(v.url)}</li>`)
		.join('\n');

	const links = doc.links
		.map((l) => `<li>${escapeHtml(l.label || l.url)} — ${escapeHtml(l.url)}</li>`)
		.join('\n');

	const contacts = [
		contactBlock('Booking', epk.bookingContact),
		contactBlock('Management', epk.managementContact),
		contactBlock('Press', epk.prContact)
	]
		.filter(Boolean)
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(doc.name)} — Press Kit</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 40px 32px; max-width: 46rem; background: #fff; color: #111;
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  header { border-bottom: 2px solid #e5e5e5; padding-bottom: 20px; margin-bottom: 24px; }
  h1 { margin: 0; font-size: 32px; letter-spacing: -0.02em; }
  .tagline { margin: 4px 0 0; font-size: 17px; color: #555; }
  .facts { margin: 8px 0 0; font-size: 13px; color: #777; }
  .kicker { margin: 12px 0 0; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #999; }
  h2 { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #888;
       margin: 0 0 8px; font-weight: 700; }
  section { margin-bottom: 26px; }
  ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 3px; }
  .muted { color: #888; }
  .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .photos img { width: 100%; border-radius: 4px; display: block; }
  figure { margin: 0 0 12px; border-left: 2px solid #ddd; padding-left: 12px; }
  blockquote { margin: 0; font-style: italic; }
  blockquote::before { content: "\\201C"; } blockquote::after { content: "\\201D"; }
  figcaption { margin-top: 3px; font-size: 13px; color: #666; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
       color: #666; border-bottom: 1px solid #ddd; padding: 4px 0; }
  td { padding: 4px 8px 4px 0; border-bottom: 1px solid #f0f0f0; }
  .contacts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .contact p { margin: 0; font-size: 14px; }
  .contact__role { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; }
  .contact__name { font-weight: 600; }
  .show__when { display: inline-block; min-width: 8.5rem; color: #555; }
  code { font-size: 13px; background: #f5f5f5; padding: 1px 4px; border-radius: 3px; }
  footer { margin-top: 34px; border-top: 1px solid #eee; padding-top: 18px;
           display: flex; gap: 18px; align-items: center; }
  footer p { margin: 0; font-size: 13px; color: #555; }
  footer .url { font-weight: 600; color: #111; }
  @media print {
    body { padding: 0; max-width: 100%; }
    section, figure, tr { break-inside: avoid; }
  }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(doc.name)}</h1>
  ${doc.tagline ? `<p class="tagline">${escapeHtml(doc.tagline)}</p>` : ''}
  ${facts.length ? `<p class="facts">${escapeHtml(facts.join(' · '))}</p>` : ''}
  <p class="kicker">Press kit</p>
</header>

${doc.bioHtml ? `<section><h2>About</h2>${doc.bioHtml}</section>` : ''}
${section('Photos', photos ? `<div class="photos">${photos}</div>` : '')}
${section('Lineup', members ? `<ul>${members}</ul>` : '')}
${section('Press', quotes)}
${section('Highlights', achievements ? `<ul>${achievements}</ul>` : '')}
${section('Upcoming shows', shows ? `<ul>${shows}</ul>` : '')}
${section('Listen', links ? `<ul>${links}</ul>` : '')}
${section('Watch', videos ? `<ul>${videos}</ul>` : '')}
${section('Backline', backline)}
${section('Also in this folder', attachments ? `<ul>${attachments}</ul>` : '')}
${section('Contact', contacts ? `<div class="contacts">${contacts}</div>` : '')}

<footer>
  ${qr ?? ''}
  <p>
    Shows, links and photos stay current at<br />
    <span class="url">${escapeHtml(doc.url ?? '')}</span><br />
    <span class="muted">Scan the code — this file is a snapshot, that page is not.</span>
  </p>
</footer>
</body>
</html>`;
}

/**
 * The same kit as plain text, for pasting into an email body.
 *
 * Not a fallback for the HTML — a different use. Half of booking still happens
 * in a mail client where an attachment goes unopened, and a wall of tags in the
 * message body is worse than none.
 */
export function renderPressKitText(doc: PressKitDocument): string {
	const epk = doc.epk;
	const lines: string[] = [doc.name.toUpperCase()];
	if (doc.tagline) lines.push(doc.tagline);

	const facts = [
		doc.genres.join(' · ') || null,
		doc.hometown,
		doc.foundedYear ? `Formed ${doc.foundedYear}` : null
	].filter(Boolean);
	if (facts.length) lines.push(facts.join(' · '));

	const block = (title: string, rows: string[]) => {
		if (!rows.length) return;
		lines.push('', title.toUpperCase(), ...rows);
	};

	if (doc.bioHtml) {
		// Tags out, entities back, whitespace collapsed. The bio is the only
		// pre-rendered HTML in the document.
		const text = doc.bioHtml
			.replace(/<[^>]+>/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\s+/g, ' ')
			// Tags become spaces so `<p>a</p><p>b</p>` does not run together — but
			// an inline tag before punctuation then leaves "Corvallis ." So close
			// the gap back up afterwards.
			.replace(/\s+([.,;:!?)\]])/g, '$1')
			.replace(/([([])\s+/g, '$1')
			.trim();
		if (text) block('About', [text]);
	}

	block(
		'Lineup',
		doc.members.map((m) => `- ${m.name}${m.position ? ` — ${m.position}` : ''}`)
	);
	block(
		'Press',
		epk.pressQuotes.filter((q) => q.quote.trim()).map((q) => `- "${q.quote}" — ${q.publication}`)
	);
	block(
		'Highlights',
		epk.achievements.filter((a) => a.trim()).map((a) => `- ${a}`)
	);
	block(
		'Upcoming shows',
		doc.shows.map((s) => `- ${s.when} — ${s.title}${s.where ? ` (${s.where})` : ''}`)
	);
	block(
		'Listen',
		doc.links.map((l) => `- ${l.label || l.url}: ${l.url}`)
	);
	block(
		'Watch',
		epk.videos.filter((v) => v.url.trim()).map((v) => `- ${v.label || 'Live video'}: ${v.url}`)
	);
	block(
		'Backline',
		epk.backline.map(
			(b) => `- ${b.instrument}: ${b.details} (${b.provided ? 'the act' : 'venue'} provides)`
		)
	);

	const contacts: string[] = [];
	const add = (label: string, c?: { name: string; email: string; phone?: string }) => {
		if (!c?.email && !c?.name) return;
		contacts.push(
			`- ${label}: ${c.name}${c.email ? ` <${c.email}>` : ''}${c.phone ? ` ${c.phone}` : ''}`
		);
	};
	add('Booking', epk.bookingContact);
	add('Management', epk.managementContact);
	add('Press', epk.prContact);
	block('Contact', contacts);

	if (doc.url) lines.push('', `Always current at ${doc.url}`);

	return lines.join('\n') + '\n';
}

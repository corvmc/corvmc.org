import { json, error } from '@sveltejs/kit';
// Typed params from `./$types`, matching the sibling media endpoint — the
// generic kit `RequestHandler` types `params.id` as possibly-undefined.
import type { RequestHandler } from './$types';
import { requireGroupRole } from '$lib/server/group/group-context';
import { requireFeature } from '$lib/server/feature-flags';
import {
	audioKey,
	putAudioObject,
	deleteAudioObject,
	validateAudioUpload
} from '$lib/server/audio/audio-storage';
import { addTrack, getReleaseById, nextTrackNumber } from '$lib/server/audio/audio-service';
import { RADIO_MIN_TRACK_MS, TRACK_TITLE_MAX } from '$lib/config';

// ---------------------------------------------------------------------------
// POST — upload one or more tracks onto a release
// ---------------------------------------------------------------------------
// A `+server.ts` rather than a remote `form()`, for the same reason the band
// media endpoint is one: a remote form cannot carry a 50MB file.
//
// FormData fields:
//   releaseId   — the release the tracks join
//   file[]      — the audio files, in the order they should be numbered
//   duration[]  — each file's length in seconds, read by the browser from the
//                 <audio> element before submitting (see below)
//   title[]     — optional per-file title; the filename is used when absent
// ---------------------------------------------------------------------------

const MAX_FILES_PER_UPLOAD = 20;

/**
 * Duration comes from the client, and that is a deliberate choice rather than a
 * shortcut.
 *
 * The alternative is parsing container headers server-side with
 * `music-metadata`, which is a large dependency to put in a Worker for one
 * number, and which still cannot answer for a VBR MP3 without scanning the
 * whole file. The browser already decoded the file to show a preview, so it
 * knows the answer exactly and for free.
 *
 * The number matters — the radio builds a wall-clock timetable out of it — so
 * it is clamped rather than trusted. A wrong value inside these bounds costs a
 * few seconds of dead air or a truncated outro; a wrong value outside them
 * would let one upload claim the station for a day.
 */
const MAX_TRACK_SECONDS = 60 * 60;

function parseDuration(raw: FormDataEntryValue | null, filename: string): number {
	const seconds = Number(raw);
	if (!Number.isFinite(seconds) || seconds <= 0) {
		throw error(400, `Could not read the length of "${filename}". Try re-selecting the file.`);
	}
	if (seconds > MAX_TRACK_SECONDS) {
		throw error(400, `"${filename}" is over an hour long.`);
	}
	return Math.round(seconds * 1000);
}

/** "01 Ferris Wheel.mp3" → "Ferris Wheel". */
function titleFromFilename(filename: string): string {
	return (
		filename
			.replace(/\.[a-z0-9]+$/i, '')
			.replace(/^\s*\d+[\s._-]+/, '')
			.replace(/[_]+/g, ' ')
			.trim()
			.slice(0, TRACK_TITLE_MAX) || 'Untitled'
	);
}

export const POST: RequestHandler = async ({ params, request }) => {
	await requireFeature('bandAudio');
	// A real route param, not a remote function's client-supplied one, so `{ id }`
	// is the honest ref.
	const bandId = params.id;
	await requireGroupRole({ id: bandId }, 'admin', { allowStaff: true });

	const formData = await request.formData();
	const releaseId = formData.get('releaseId');
	if (typeof releaseId !== 'string' || !releaseId) throw error(400, 'Missing releaseId');

	const release = await getReleaseById(releaseId);
	// The release must belong to the band in the URL. Without this, any band
	// admin could add tracks to any other band's record.
	if (!release || release.groupId !== bandId) throw error(404, 'Release not found');

	const files = formData
		.getAll('file[]')
		.concat(formData.getAll('file'))
		.filter((value): value is File => value instanceof File);

	if (files.length === 0) throw error(400, 'No files provided');
	if (files.length > MAX_FILES_PER_UPLOAD) {
		throw error(400, `Up to ${MAX_FILES_PER_UPLOAD} tracks per upload.`);
	}

	const durations = formData.getAll('duration[]').concat(formData.getAll('duration'));
	const titles = formData.getAll('title[]').concat(formData.getAll('title'));

	// Validate everything before writing anything. A half-uploaded record whose
	// third file was the wrong type is a worse state to recover from than a
	// rejection, and the check is free.
	const prepared = files.map((file, i) => {
		const reason = validateAudioUpload(file);
		if (reason) throw error(400, reason);
		const durationMs = parseDuration(durations[i] ?? null, file.name);
		const rawTitle = typeof titles[i] === 'string' ? (titles[i] as string).trim() : '';
		return {
			file,
			durationMs,
			title: (rawTitle || titleFromFilename(file.name)).slice(0, TRACK_TITLE_MAX)
		};
	});

	let trackNumber = await nextTrackNumber(releaseId);
	const created: Array<{ id: string; title: string; trackNumber: number; durationMs: number }> = [];

	for (const item of prepared) {
		const trackId = crypto.randomUUID();
		const key = audioKey(trackId, item.file.type);
		const buffer = await item.file.arrayBuffer();

		await putAudioObject(key, buffer, item.file.type);

		try {
			const track = await addTrack({
				releaseId,
				title: item.title,
				trackNumber: trackNumber++,
				durationMs: item.durationMs,
				objectKey: key,
				contentType: item.file.type,
				byteSize: buffer.byteLength,
				originalFilename: item.file.name
			});
			created.push({
				id: track.id,
				title: track.title,
				trackNumber: track.trackNumber,
				durationMs: track.durationMs
			});
		} catch (err) {
			// The object went in first because a row pointing at nothing is the
			// worse failure — it renders as a playable track that 404s. If the row
			// then fails, take the object back out rather than leaving the sweep to
			// find it a day later.
			await deleteAudioObject(key).catch(() => {});
			throw err;
		}
	}

	return json({
		success: true,
		tracks: created,
		// So the caller can tell the band why a 40-minute live set will not be on
		// the radio even though the record is opted in.
		shortForRadio: created.filter((t) => t.durationMs < RADIO_MIN_TRACK_MS).map((t) => t.id)
	});
};

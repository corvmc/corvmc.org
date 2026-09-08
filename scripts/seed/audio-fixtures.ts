/**
 * Playable audio for the dev seed, synthesized rather than committed.
 *
 * The alternative was a folder of small MP3s in git, which costs a permanent
 * few megabytes, a licensing question nobody wants to answer, and a set of
 * files that all sound the same at 3am. This costs forty lines of arithmetic
 * and gives every seeded track a *different* melody, which is the property that
 * actually matters: you can hear the station change songs, and you can tell at
 * a glance whether the widget followed it.
 *
 * WAV rather than MP3 because encoding MP3 needs a library and decoding WAV
 * needs nothing — every browser plays 16-bit PCM, and the radio's whole job
 * here is to be audible in dev.
 */

const SAMPLE_RATE = 11025;

/** Equal temperament, A4 = 440. Semitones from A4, so 0 is A4 and -12 is A3. */
function hz(semitonesFromA4: number): number {
	return 440 * Math.pow(2, semitonesFromA4 / 12);
}

/** Scale degrees in semitones, relative to the root. */
const SCALES: Record<string, number[]> = {
	major: [0, 2, 4, 5, 7, 9, 11, 12],
	minor: [0, 2, 3, 5, 7, 8, 10, 12],
	dorian: [0, 2, 3, 5, 7, 9, 10, 12],
	pentatonic: [0, 3, 5, 7, 10, 12, 15, 17]
};

const SCALE_NAMES = Object.keys(SCALES);

/**
 * One track's worth of audio, deterministic in `seed` so a re-seed produces the
 * same bytes and `db:reset` stays diffable.
 */
export function synthesizeTrack(seed: number, seconds: number): Uint8Array {
	const scale = SCALES[SCALE_NAMES[seed % SCALE_NAMES.length]];
	// Roots between A2 and A4, so consecutive tracks are audibly different keys
	// rather than the same phrase transposed by a semitone.
	const root = -24 + ((seed * 5) % 25);
	const noteLength = 0.22 + (seed % 4) * 0.06;

	const totalSamples = Math.floor(SAMPLE_RATE * seconds);
	const samples = new Int16Array(totalSamples);

	for (let i = 0; i < totalSamples; i++) {
		const t = i / SAMPLE_RATE;
		const noteIndex = Math.floor(t / noteLength);
		// A wandering arpeggio: stepping by a coprime-ish interval walks the whole
		// scale instead of cycling four notes forever.
		const degree = scale[(noteIndex * (2 + (seed % 3)) + seed) % scale.length];
		const octave = noteIndex % 8 === 7 ? 12 : 0;
		const frequency = hz(root + degree + octave);

		// Position within this note, for the envelope.
		const into = t - noteIndex * noteLength;
		const attack = Math.min(1, into / 0.015);
		const decay = Math.exp(-into * 4.5);
		const envelope = attack * decay;

		// A fundamental plus two quiet harmonics — enough overtone to read as an
		// instrument rather than a hearing test.
		const phase = 2 * Math.PI * frequency * t;
		const wave = Math.sin(phase) + 0.28 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase);

		samples[i] = Math.max(-32000, Math.min(32000, Math.round(wave * envelope * 9000)));
	}

	return wavFromPcm(samples);
}

/** Wrap 16-bit mono PCM in the 44-byte canonical WAV header. */
function wavFromPcm(samples: Int16Array): Uint8Array {
	const dataBytes = samples.length * 2;
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);

	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};

	ascii(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true); // PCM header length
	view.setUint16(20, 1, true); // format: PCM
	view.setUint16(22, 1, true); // channels: mono
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	ascii(36, 'data');
	view.setUint32(40, dataBytes, true);

	for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);

	return new Uint8Array(buffer);
}

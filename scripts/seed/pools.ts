export const FIRST_NAMES = [
	'Alex',
	'Jordan',
	'Casey',
	'Morgan',
	'Taylor',
	'Riley',
	'Quinn',
	'Avery',
	'Dakota',
	'Reese',
	'Skyler',
	'Finley',
	'Rowan',
	'Sage',
	'Charlie',
	'Emerson',
	'Hayden',
	'Parker',
	'Blake',
	'Jamie'
];

export const LAST_NAMES = [
	'Chen',
	'Rivera',
	'Nguyen',
	'Kowalski',
	'Okafor',
	'Singh',
	'Larsson',
	'Fernandez',
	'Tanaka',
	'Dubois',
	'Kim',
	'Petrov',
	'Anderson',
	'Reyes',
	'Washington',
	'Murphy',
	'Cohen',
	'Yamamoto',
	'Santos',
	'Berg'
];

export const PRONOUNS = ['he/him', 'she/her', 'they/them', null, null];

export const EVENT_TITLES = [
	'Open Mic Night',
	'Jazz Jam Session',
	'Songwriting Workshop',
	'Battle of the Bands',
	'Acoustic Showcase',
	'Electronic Music Night',
	'Blues & Brews',
	'Hip-Hop Cypher',
	'Classical Recital',
	'Punk Rock Matinee',
	'Folk Circle',
	'Album Release Party',
	'Music Theory Workshop',
	'Guitar Clinic',
	'Drum Circle',
	'Singer-Songwriter Night',
	'Funk & Soul Revue',
	'Latin Night'
];

export const EVENT_TAGS_POOL = [
	'open mic',
	'workshop',
	'jam',
	'showcase',
	'all ages',
	'21+',
	'free',
	'ticketed',
	'community',
	'genre night'
];

export const CLOSURE_REASONS = [
	'Building maintenance',
	'Holiday closure',
	'Staff retreat',
	'Private rental',
	'Deep cleaning',
	'Equipment installation',
	'Electrical work',
	'Plumbing repair'
];

export const BAND_NAMES = [
	'The Voltage Thieves',
	'Half Past Never',
	'Cardboard Satellites',
	'Velvet Brake',
	'Tin Whisker',
	'Slow Catastrophe',
	'Paper Wolves',
	'The After Math'
];

export const BAND_POSITIONS = [
	'Guitar',
	'Bass',
	'Drums',
	'Vocals',
	'Keys',
	'Saxophone',
	'Violin',
	'Cello',
	'Trumpet'
];

// Per-band stage names. Only some members have one — the roster, the microsite
// members block and the directory profile all fall back to the account name,
// and that fallback is the path most rows take, so it needs local coverage too.
export const BAND_ALIASES = [
	'Ziggy',
	'Slim',
	'Doc',
	'Ace',
	'Kid Vicious',
	'The Reverend',
	'Lefty',
	'Sparrow',
	'Nova',
	'Tex'
];

export const TICKET_CODES_PREFIX = 'TIX';

export const INSTRUMENTS = [
	'guitar',
	'bass',
	'drums',
	'vocals',
	'keys',
	'piano',
	'saxophone',
	'violin',
	'cello',
	'trumpet',
	'trombone',
	'flute',
	'banjo',
	'mandolin',
	'harmonica',
	'ukulele',
	'synthesizer',
	'turntables',
	'percussion'
];

export const GENRES = [
	'jazz',
	'rock',
	'funk',
	'blues',
	'folk',
	'indie',
	'electronic',
	'hip-hop',
	'classical',
	'punk',
	'metal',
	'r&b',
	'soul',
	'country',
	'reggae',
	'latin',
	'world',
	'experimental',
	'pop',
	'ambient'
];

export const TAGLINES = [
	'Drummer looking for a funk project',
	'Multi-instrumentalist | Jazz & Soul',
	'Singer-songwriter | Acoustic vibes',
	'Lead guitarist | Rock & Blues',
	'Bassist for hire',
	'Keys player | All genres welcome',
	'Producer & DJ',
	'Classically trained, genre curious',
	'Vocalist | R&B, Soul, Gospel',
	'Percussionist | World music enthusiast'
];

export const HOMETOWNS = [
	'Corvallis, OR',
	'Albany, OR',
	'Philomath, OR',
	'Eugene, OR',
	'Salem, OR',
	'Lebanon, OR',
	'Portland, OR'
];

export const MEMBER_BIOS = [
	'Been playing since I was 12. Love jamming with new people.',
	'Studied music at OSU. Currently in two bands but always looking for side projects.',
	'Self-taught guitarist. Into anything with a good groove.',
	'Professional session musician. Available for recording and live gigs.',
	'Just moved to Corvallis and looking to connect with local musicians.',
	'Weekend warrior. Day job in tech, music is my therapy.',
	null,
	null,
	null
];

export const SAMPLE_LINKS = [
	{ label: 'My SoundCloud', url: 'https://soundcloud.com/example/tracks' },
	{ label: 'YouTube Channel', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
	{ label: 'Spotify', url: 'https://open.spotify.com/artist/example' },
	{ label: 'Bandcamp', url: 'https://example.bandcamp.com/album/demo' },
	{ label: 'Instagram', url: 'https://instagram.com/musician' },
	{ label: 'Personal Site', url: 'https://example.com' }
];

export const BAND_EVENT_TITLES = [
	'Live at The Peacock',
	'House Show — All Ages',
	'Album Release Party',
	'Benefit for Local Food Bank',
	"Late Night at Cloud & Kelly's",
	'Backyard BBQ & Music',
	'Summer Solstice Set',
	'Vinyl Night',
	'Residency Night #4',
	'Co-Headliner with Paper Wolves'
];

export const BAND_EVENT_LOCATIONS = [
	'The Peacock Tavern, 125 SW 2nd St',
	"Cloud & Kelly's, 126 SW 1st St",
	'Bombs Away Cafe, 2527 NW Monroe Ave',
	'Majestic Theatre, 115 SW 2nd St',
	'House show (DM for address)',
	'OSU MU Ballroom',
	'Avery Park Amphitheater',
	'Block 15 Brewery, 300 SW Jefferson Ave'
];

/**
 * Support acts with no CMC account — the common case on a real bill, and what
 * the `unlinked` lineup status exists for.
 */
export const SUPPORT_BAND_NAMES = [
	'Paper Wolves',
	'Sun Kissed',
	'The Filbert Set',
	'Marys Peak Ramblers',
	'Static Bloom',
	'Willamette Static',
	'Dead Air Radio',
	'The Nine Volts'
];

export const PRESS_QUOTES = [
	{
		quote: 'One of the most exciting acts to come out of the Willamette Valley in years.',
		publication: 'Oregon Music News',
		date: '2025-11'
	},
	{
		quote: "Their live energy is absolutely electric — don't miss them.",
		publication: 'Corvallis Gazette-Times',
		date: '2025-09'
	},
	{
		quote: "A refreshing blend of genres that shouldn't work but absolutely does.",
		publication: 'PDX Monthly',
		date: '2026-01'
	},
	{
		quote: 'The real deal. Tight, inventive, and impossible not to dance to.',
		publication: 'Willamette Week',
		date: '2026-03'
	},
	{
		quote: 'They pack every venue they play. Simple as that.',
		publication: 'Eugene Weekly',
		date: '2025-12'
	}
];

export const ACHIEVEMENTS_POOL = [
	'Opened for Built to Spill at the McDonald Theatre (2025)',
	'Selected for Pickathon Festival 2026',
	'150,000+ streams on Spotify',
	"Featured on KBOO Portland's Local Music Spotlight",
	'Won Battle of the Bands at Bombs Away (2025)',
	'Sold out Majestic Theatre (400 cap) twice',
	'Oregon Music Award nominee — Best New Act 2025',
	'Recorded at Jackpot! Recording Studio, Portland'
];

export const BACKLINE_ITEMS = [
	{
		instrument: 'Drums',
		details: 'DW 5-piece kit, 22" kick. Band provides cymbals and snare.',
		provided: false
	},
	{
		instrument: 'Bass Amp',
		details: 'Ampeg SVT-style, 300W minimum with 4x10 or 8x10 cab',
		provided: false
	},
	{
		instrument: 'Guitar Amp',
		details: 'Fender Twin Reverb or equivalent clean amp',
		provided: false
	},
	{ instrument: 'Keys', details: 'Nord Stage 3 or similar weighted 88-key', provided: false },
	{ instrument: 'Monitors', details: '4 monitor wedges with independent mixes', provided: false },
	{ instrument: 'DI Boxes', details: '2x active DI (Radial J48 or equivalent)', provided: false }
];

// An in-memory host `api` for the integration tests: a tiny library (one
// compilation filed under "Various Artists"), recorded view data, and the
// registered action handlers so a test can "click".

function makeLibrary() {
  const artists = [
    { id: 1, name: "Massive Attack", track_count: 3, album_count: 2, liked: 0 },
    { id: 2, name: "Portishead", track_count: 2, album_count: 1, liked: 0 },
    { id: 3, name: "Various Artists", track_count: 0, album_count: 1, liked: 0 },
    // Performs only on the compilation: no album of its own.
    { id: 4, name: "Tricky", track_count: 1, album_count: 0, liked: 0 },
  ];
  const albums = [
    { id: 10, title: "Protection", artist_id: 1, artist_name: "Massive Attack", year: 1994, track_count: 1, liked: 0 },
    { id: 11, title: "Mezzanine", artist_id: 1, artist_name: "Massive Attack", year: 1998, track_count: 2, liked: 0 },
    { id: 20, title: "Dummy", artist_id: 2, artist_name: "Portishead", year: 1994, track_count: 2, liked: 0 },
    { id: 30, title: "Bristol Sound", artist_id: 3, artist_name: "Various Artists", year: null, track_count: 1, liked: 0 },
  ];
  const tr = (id, title, artist_id, artist_name, album_id, album_title, year, n, secs) => ({
    id, path: "file:///music/" + id + ".flac", title, artist_id, artist_name, album_id, album_title,
    year, track_number: n, duration_secs: secs, format: "flac", liked: 0,
  });
  const tracks = [
    tr(100, "Karmacoma", 1, "Massive Attack", 10, "Protection", 1994, 1, 316),
    tr(110, "Angel", 1, "Massive Attack", 11, "Mezzanine", 1998, 1, 380),
    tr(111, "Teardrop", 1, "Massive Attack", 11, "Mezzanine", 1998, 3, 330),
    tr(200, "Sour Times", 2, "Portishead", 20, "Dummy", 1994, 3, 254),
    tr(201, "Glory Box", 2, "Portishead", 20, "Dummy", 1994, 11, 306),
    tr(300, "Overcome", 4, "Tricky", 30, "Bristol Sound", null, 1, 270),
  ];
  const tags = [{ id: 7, name: "Trip Hop", track_count: 3 }, { id: 8, name: "Empty", track_count: 0 }];
  const trackTags = { 7: [110, 200, 300] };
  return { artists, albums, tracks, tags, trackTags };
}

function makeApi(lib = makeLibrary()) {
  const views = [];
  const handlers = {};
  const calls = [];
  const kv = new Map();
  const libHandlers = {};

  const record = (name, args, value) => { calls.push({ name, args }); return Promise.resolve(value); };

  const api = {
    appVersion: "1.0.118",
    log: () => {},
    ui: {
      setViewData: (viewId, data) => { views.push({ viewId, data }); },
      onAction: (id, fn) => { handlers[id] = fn; },
      showNotification: (message, options) => { calls.push({ name: "notify", args: [message, options] }); },
    },
    storage: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      set: async (k, v) => { kv.set(k, v); },
    },
    playback: {
      playTracks: (tracks, start, ctx) => record("playTracks", [tracks, start, ctx]),
      insertTracks: (tracks, pos) => record("insertTracks", [tracks, pos]),
    },
    library: {
      getArtists: (opts = {}) => {
        let list = lib.artists.slice();
        if (opts.tagId != null) {
          const ids = new Set(lib.trackTags[opts.tagId] || []);
          const albumIds = new Set(lib.tracks.filter((t) => ids.has(t.id)).map((t) => t.album_id));
          const owners = new Set(lib.albums.filter((a) => albumIds.has(a.id)).map((a) => a.artist_id));
          list = list.filter((a) => owners.has(a.id));
        }
        return record("getArtists", [opts], list);
      },
      getAlbums: (opts = {}) => {
        let list = lib.albums.slice();
        // The host's rules: the filters AND together and mean the same with
        // or without a tag.
        if (opts.tagId != null) {
          const ids = new Set(lib.trackTags[opts.tagId] || []);
          const albumIds = new Set(lib.tracks.filter((t) => ids.has(t.id)).map((t) => t.album_id));
          list = list.filter((a) => albumIds.has(a.id));
        }
        if (opts.artistId != null) {
          // Owns OR performs on.
          const performs = new Set(lib.tracks.filter((t) => t.artist_id === opts.artistId).map((t) => t.album_id));
          list = list.filter((a) => a.artist_id === opts.artistId || performs.has(a.id));
        }
        if (opts.albumArtistId != null) list = list.filter((a) => a.artist_id === opts.albumArtistId);
        if (opts.sort === "year") list.sort((a, b) => (a.year || 0) - (b.year || 0) || (a.title < b.title ? -1 : 1));
        return record("getAlbums", [opts], list);
      },
      getTags: (opts = {}) => record("getTags", [opts], lib.tags.slice()),
      getTracks: (opts = {}) => {
        let list = lib.tracks.slice();
        if (opts.albumId != null) list = list.filter((t) => t.album_id === opts.albumId).sort((a, b) => a.track_number - b.track_number);
        else if (opts.artistId != null) list = list.filter((t) => t.artist_id === opts.artistId);
        else if (opts.tagId != null) {
          const ids = new Set(lib.trackTags[opts.tagId] || []);
          list = list.filter((t) => ids.has(t.id));
        }
        return record("getTracks", [opts], list);
      },
      onScanComplete: (fn) => { libHandlers.scan = fn; },
      onTrackAdded: (fn) => { libHandlers.added = fn; },
      onTrackRemoved: (fn) => { libHandlers.removed = fn; },
    },
  };

  return {
    api,
    calls,
    handlers,
    libHandlers,
    kv,
    views,
    lastView: () => views[views.length - 1].data,
    act: (id, payload) => handlers[id](payload),
  };
}

/** Let every pending promise chain settle. */
function flush() {
  return new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));
}

/** Depth-first search for a node of `type` in a view tree. */
function findNode(view, type) {
  if (!view || typeof view !== "object") return null;
  if (view.type === type) return view;
  const kids = view.children || [];
  for (const c of kids) {
    const hit = findNode(c, type);
    if (hit) return hit;
  }
  return null;
}

module.exports = { makeApi, makeLibrary, flush, findNode };

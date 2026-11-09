// Explorer — a master/detail browser for the Vibo library.
//
// Left: a tree you can switch between three hierarchies (Artist › Album,
// Tag › Artist › Album, Decade › Year › Album). Right: the tracks of the
// selected node, with Play / Shuffle / Enqueue, a filter box and sortable
// columns. Built on the host's `split` + `tree` view nodes (Vibo ≥ 1.0.118).
//
// "Artist" is the ALBUM artist throughout (albums.artist_id = ALBUMARTIST ??
// track artist), so a compilation sits under "Various Artists" exactly as it
// does on Vibo's own pages.
//
// ES5 on purpose: the plugin is evaluated with `new Function`, no bundler.

var VIEW = "explorer";
var TRACK_CAP = 2000;

var HIERARCHIES = [
  { value: "artist", label: "Artist › Album" },
  { value: "tag", label: "Genre › Artist › Album" },
  { value: "year", label: "Decade › Year › Album" }
];

// The title is the list's one flexing column, and the detail pane is narrow
// (the tree takes ~320px), so every fixed column is width the title loses: six
// of them squeezed it to nothing. Columns therefore follow what is selected —
// an album's tracks share album and year, so they need only # and time; the
// artist is always on the row's subtitle line.
var COLUMN = {
  num: { id: "num", label: "#", width: 36, align: "right", sortable: true },
  album: { id: "album", label: "Album", width: 150, sortable: true },
  year: { id: "year", label: "Year", width: 48, align: "right", sortable: true },
  duration: { id: "duration", label: "Time", width: 52, align: "right", sortable: true }
};

function columnsFor(kind) {
  return kind === "album"
    ? [COLUMN.num, COLUMN.duration]
    : [COLUMN.album, COLUMN.year, COLUMN.duration];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported at the bottom with a `_` prefix for the tests)
// ---------------------------------------------------------------------------

/** Case- and accent-insensitive form for matching. */
function fold(s) {
  if (s === null || s === undefined) return "";
  var str = String(s).toLowerCase();
  if (typeof str.normalize === "function") str = str.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return str.replace(/\s+/g, " ").trim();
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : (many || one + "s"));
}

function formatDuration(secs) {
  if (typeof secs !== "number" || !isFinite(secs) || secs < 0) return "";
  var s = Math.round(secs);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var r = s % 60;
  var mm = h > 0 && m < 10 ? "0" + m : String(m);
  return (h > 0 ? h + ":" : "") + mm + ":" + (r < 10 ? "0" + r : r);
}

/** "1 h 12 min" / "42 min" — the header's total length. */
function formatTotal(secs) {
  if (!(secs > 0)) return "";
  var mins = Math.round(secs / 60);
  if (mins < 60) return mins + " min";
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  return h + " h" + (m ? " " + m + " min" : "");
}

function totalSecs(tracks) {
  var t = 0;
  for (var i = 0; i < tracks.length; i++) if (typeof tracks[i].duration_secs === "number") t += tracks[i].duration_secs;
  return t;
}

function decadeOf(year) {
  return typeof year === "number" && year > 0 ? Math.floor(year / 10) * 10 : null;
}

/**
 * Albums grouped by decade, then year, oldest first; albums with no year go
 * into one "Unknown year" bucket at the end. Input order is kept within a year.
 */
function groupByDecade(albums) {
  var decades = {};
  var order = [];
  var unknown = [];
  for (var i = 0; i < albums.length; i++) {
    var al = albums[i];
    var dec = decadeOf(al.year);
    if (dec === null) { unknown.push(al); continue; }
    if (!decades[dec]) { decades[dec] = { decade: dec, years: {}, yearOrder: [] }; order.push(dec); }
    var d = decades[dec];
    if (!d.years[al.year]) { d.years[al.year] = []; d.yearOrder.push(al.year); }
    d.years[al.year].push(al);
  }
  order.sort(function (a, b) { return a - b; });
  var out = [];
  for (var j = 0; j < order.length; j++) {
    var g = decades[order[j]];
    g.yearOrder.sort(function (a, b) { return a - b; });
    out.push({
      decade: g.decade,
      years: g.yearOrder.map(function (y) { return { year: y, albums: g.years[y] }; })
    });
  }
  return { decades: out, unknown: unknown };
}

function albumNode(al, idPrefix) {
  var bits = [];
  if (al.year) bits.push(String(al.year));
  return {
    id: (idPrefix || "") + "al:" + al.id,
    label: al.title,
    sublabel: bits.join(" · ") || undefined,
    badge: typeof al.track_count === "number" ? al.track_count : undefined,
    entity: { kind: "album", id: al.id, name: al.title, artistName: al.artist_name || undefined },
    data: { kind: "album", albumId: al.id, title: al.title, artistName: al.artist_name || null, year: al.year || null }
  };
}

/** Artist › Album. `albumsByArtist[id]` present = loaded (possibly empty). */
function buildArtistNodes(artists, albumsByArtist) {
  var out = [];
  for (var i = 0; i < artists.length; i++) {
    var a = artists[i];
    var kids = albumsByArtist[a.id];
    var n = typeof a.album_count === "number" ? a.album_count : null;
    out.push({
      id: "ar:" + a.id,
      label: a.name,
      sublabel: n !== null ? plural(n, "album") : undefined,
      hasChildren: true,
      entity: { kind: "artist", id: a.id, name: a.name },
      data: { kind: "artist", artistId: a.id, name: a.name },
      children: kids ? kids.map(function (al) { return albumNode(al); }) : undefined
    });
  }
  return out;
}

/** Tag › Artist › Album. Ids carry the tag so an artist can sit under several tags. */
function buildTagNodes(tags, artistsByTag, albumsByTagArtist) {
  var out = [];
  for (var i = 0; i < tags.length; i++) {
    var t = tags[i];
    var artists = artistsByTag[t.id];
    var prefix = "tg:" + t.id + "/";
    out.push({
      id: "tg:" + t.id,
      label: t.name,
      sublabel: typeof t.track_count === "number" ? plural(t.track_count, "track") : undefined,
      hasChildren: true,
      data: { kind: "tag", tagId: t.id, name: t.name },
      children: artists ? artists.map(function (a) {
        var albums = albumsByTagArtist[t.id + ":" + a.id];
        return {
          id: prefix + "ar:" + a.id,
          label: a.name,
          hasChildren: true,
          entity: { kind: "artist", id: a.id, name: a.name },
          data: { kind: "tag-artist", tagId: t.id, tagName: t.name, artistId: a.id, name: a.name },
          children: albums ? albums.map(function (al) { return albumNode(al, prefix); }) : undefined
        };
      }) : undefined
    });
  }
  return out;
}

/** Decade › Year › Album, from the whole album list (loaded at once). */
function buildYearNodes(albums) {
  var g = groupByDecade(albums);
  var out = g.decades.map(function (d) {
    var count = 0;
    for (var i = 0; i < d.years.length; i++) count += d.years[i].albums.length;
    return {
      id: "dec:" + d.decade,
      label: d.decade + "s",
      sublabel: plural(count, "album"),
      hasChildren: true,
      data: { kind: "decade", decade: d.decade },
      children: d.years.map(function (y) {
        return {
          id: "yr:" + y.year,
          label: String(y.year),
          badge: y.albums.length,
          hasChildren: true,
          data: { kind: "year", year: y.year },
          children: y.albums.map(function (al) { return albumNode(al); })
        };
      })
    };
  });
  if (g.unknown.length) {
    out.push({
      id: "dec:unknown",
      label: "Unknown year",
      sublabel: plural(g.unknown.length, "album"),
      hasChildren: true,
      data: { kind: "decade", decade: null },
      children: g.unknown.map(function (al) { return albumNode(al); })
    });
  }
  return out;
}

/**
 * Narrow a tree to the nodes whose label matches `query` (folded), keeping
 * every ancestor of a match. A node that matches keeps its whole subtree; a
 * node kept only for a descendant shows just the matching branch and is listed
 * in `expandIds` so the match is visible. Unloaded children (`undefined`) are
 * never searched. Empty query: the tree as is.
 */
function filterTree(nodes, query) {
  var q = fold(query);
  if (!q) return { nodes: nodes, expandIds: [], matches: -1 };
  var expandIds = [];
  var matches = 0;
  function walk(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (fold(n.label).indexOf(q) !== -1) { matches++; out.push(n); continue; }
      if (n.children && n.children.length) {
        var kids = walk(n.children);
        if (kids.length) {
          var copy = {};
          for (var k in n) if (Object.prototype.hasOwnProperty.call(n, k)) copy[k] = n[k];
          copy.children = kids;
          out.push(copy);
          expandIds.push(n.id);
        }
      }
    }
    return out;
  }
  return { nodes: walk(nodes), expandIds: expandIds, matches: matches };
}

/** Concatenate track lists, dropping repeats by id, keeping first-seen order. */
function unionTracks(lists) {
  var seen = {};
  var out = [];
  for (var i = 0; i < lists.length; i++) {
    var l = lists[i] || [];
    for (var j = 0; j < l.length; j++) {
      var t = l[j];
      var key = t.id !== null && t.id !== undefined ? "id:" + t.id : "p:" + t.path;
      if (seen[key]) continue;
      seen[key] = true;
      out.push(t);
    }
  }
  return out;
}

function filterTracks(tracks, query) {
  var q = fold(query);
  if (!q) return tracks;
  return tracks.filter(function (t) {
    return fold(t.title).indexOf(q) !== -1 ||
      fold(t.artist_name).indexOf(q) !== -1 ||
      fold(t.album_title).indexOf(q) !== -1 ||
      fold(t.album_artist_name).indexOf(q) !== -1;
  });
}

function sortValue(t, column) {
  switch (column) {
    case "title": return fold(t.title);
    case "artist": return fold(t.artist_name);
    case "album": return fold(t.album_title);
    case "year": return typeof t.year === "number" ? t.year : null;
    case "format": return fold(t.format);
    case "duration": return typeof t.duration_secs === "number" ? t.duration_secs : null;
    case "num": return typeof t.track_number === "number" ? t.track_number : null;
    default: return null;
  }
}

/**
 * Stable sort by a column. "order" (or unknown) keeps the natural order. Empty
 * values always sort last, whichever the direction, so a column nobody filled
 * in doesn't bury the rows that have it.
 */
function sortTracks(tracks, column, dir) {
  if (!column || column === "order") return tracks.slice();
  var sign = dir === "desc" ? -1 : 1;
  var indexed = tracks.map(function (t, i) { return { t: t, i: i, v: sortValue(t, column) }; });
  indexed.sort(function (a, b) {
    var av = a.v, bv = b.v;
    var ae = av === null || av === "", be = bv === null || bv === "";
    if (ae && be) return a.i - b.i;
    if (ae) return 1;
    if (be) return -1;
    if (av < bv) return -sign;
    if (av > bv) return sign;
    return a.i - b.i;
  });
  return indexed.map(function (x) { return x.t; });
}

function trackRow(t) {
  return {
    id: "t:" + (t.id !== null && t.id !== undefined ? t.id : t.path),
    title: t.title,
    subtitle: t.artist_name || undefined,
    path: t.path || null,
    artistName: t.artist_name || null,
    albumTitle: t.album_title || null,
    durationSecs: typeof t.duration_secs === "number" ? t.duration_secs : null,
    cells: {
      num: typeof t.track_number === "number" ? String(t.track_number) : "",
      album: t.album_title || "",
      year: typeof t.year === "number" ? String(t.year) : "",
      duration: formatDuration(t.duration_secs)
    }
  };
}

/** A library Track as the PluginTrack the playback API takes. */
function toPluginTrack(t) {
  return {
    path: t.path || undefined,
    title: t.title,
    artist_name: t.artist_name || undefined,
    album_title: t.album_title || undefined,
    duration_secs: typeof t.duration_secs === "number" ? t.duration_secs : undefined,
    track_number: typeof t.track_number === "number" ? t.track_number : undefined
  };
}

/** Fisher–Yates on a copy; `rand` injectable for tests. */
function shuffled(list, rand) {
  var r = rand || Math.random;
  var a = list.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(r() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/** What the header says about a selection. */
function describeSelection(sel, tracks, capped) {
  var d = sel.data || {};
  var subtitle;
  switch (d.kind) {
    case "album": subtitle = "Album" + (d.artistName ? " · " + d.artistName : "") + (d.year ? " · " + d.year : ""); break;
    case "artist": subtitle = "Artist"; break;
    case "tag": subtitle = "Genre"; break;
    case "tag-artist": subtitle = "Artist · in " + d.tagName; break;
    case "decade": subtitle = d.decade === null ? "Albums with no year" : "Decade"; break;
    case "year": subtitle = "Year"; break;
    default: subtitle = undefined;
  }
  var meta = plural(tracks.length, "track");
  var total = formatTotal(totalSecs(tracks));
  if (total) meta += " · " + total;
  if (capped) meta += " · first " + TRACK_CAP + " shown";
  return { title: sel.label, subtitle: subtitle, meta: meta };
}

// ---------------------------------------------------------------------------
// State + host wiring
// ---------------------------------------------------------------------------

var api = null;
var state = null;

function freshState() {
  return {
    hierarchy: "artist",
    artists: null,
    tags: null,
    albums: null,
    albumsByArtist: {},
    artistsByTag: {},
    albumsByTagArtist: {},
    tagTracks: {},
    expanded: { artist: {}, tag: {}, year: {} },
    treeFilter: "",
    selection: null,
    tracks: [],
    capped: false,
    loadingTracks: false,
    trackFilter: "",
    sort: { column: "order", dir: "asc" },
    error: null,
    gen: 0
  };
}

function logError(what, e) {
  var msg = e && e.message ? e.message : String(e);
  if (api) api.log("error", what + ": " + msg);
  if (typeof console !== "undefined" && console.error) console.error("[explorer] " + what + ":", e);
}

function expandedIdsFor(h, extra) {
  var ids = [];
  var map = state.expanded[h];
  for (var k in map) if (map[k]) ids.push(k);
  if (extra) for (var i = 0; i < extra.length; i++) if (ids.indexOf(extra[i]) === -1) ids.push(extra[i]);
  return ids;
}

function rawTree() {
  if (state.hierarchy === "tag") {
    return state.tags ? buildTagNodes(state.tags, state.artistsByTag, state.albumsByTagArtist) : null;
  }
  if (state.hierarchy === "year") {
    return state.albums ? buildYearNodes(state.albums) : null;
  }
  return state.artists ? buildArtistNodes(state.artists, state.albumsByArtist) : null;
}

function treePane() {
  var head = [
    {
      type: "select", label: "Browse by", action: "hierarchy", value: state.hierarchy,
      options: HIERARCHIES.map(function (h) { return { value: h.value, label: h.label }; })
    },
    {
      type: "search-input", placeholder: state.hierarchy === "tag" ? "Filter genres" : "Filter",
      action: "tree-filter", value: state.treeFilter, stateKey: "tree:" + state.hierarchy
    }
  ];
  var nodes = rawTree();
  if (state.error) {
    head.push({ type: "text", content: state.error, className: "plugin-text-error" });
  }
  if (!nodes) {
    head.push({ type: "loading", message: "Reading your library…" });
    return { type: "layout", direction: "vertical", className: "explorer-tree-pane", children: head };
  }
  var filtered = filterTree(nodes, state.treeFilter);
  head.push({
    type: "tree",
    nodes: filtered.nodes,
    selectAction: "select",
    expandAction: "expand",
    selectedId: state.selection ? state.selection.id : undefined,
    expandedIds: expandedIdsFor(state.hierarchy, filtered.expandIds),
    stateKey: state.hierarchy,
    ariaLabel: "Library",
    emptyText: state.treeFilter ? "Nothing matches “" + state.treeFilter + "”" : "Your library is empty"
  });
  return { type: "layout", direction: "vertical", className: "explorer-tree-pane", children: head };
}

function detailPane() {
  if (!state.selection) {
    return { type: "text", content: "Pick an artist, album, genre or year on the left." };
  }
  var info = describeSelection(state.selection, state.tracks, state.capped);
  var empty = state.tracks.length === 0;
  var children = [{
    type: "detail-header",
    plain: true,
    title: info.title,
    subtitle: info.subtitle,
    meta: state.loadingTracks ? "Loading…" : info.meta,
    buttons: [
      { id: "play", label: "Play", variant: "primary", disabled: empty },
      { id: "shuffle", label: "Shuffle", variant: "secondary", disabled: empty },
      { id: "enqueue", label: "Enqueue", variant: "secondary", disabled: empty }
    ]
  }];
  if (state.loadingTracks) {
    children.push({ type: "loading", message: "Loading tracks…" });
    return { type: "layout", direction: "vertical", children: children };
  }
  if (state.tracks.length > 10) {
    children.push({
      type: "search-input", placeholder: "Filter these tracks", action: "track-filter",
      value: state.trackFilter, stateKey: "tracks:" + state.selection.id
    });
  }
  var visible = sortTracks(filterTracks(state.tracks, state.trackFilter), state.sort.column, state.sort.dir);
  if (visible.length === 0) {
    children.push({ type: "text", content: empty ? "No tracks here." : "No track matches “" + state.trackFilter + "”." });
  } else {
    children.push({
      type: "track-row-list",
      items: visible.map(trackRow),
      // The list's first action is what double-click / Enter run on a row (the
      // host has no default), and it's also the row's hover ▶ and the toolbar's
      // "Play (N)". Without it a double-click did nothing.
      actions: [{ id: "play-rows", label: "Play", icon: "▶" }],
      selectable: true,
      showHeader: true,
      columns: columnsFor(state.selection.data && state.selection.data.kind),
      sortBy: state.sort.column === "order" ? undefined : state.sort.column,
      sortDir: state.sort.dir,
      sortAction: "sort"
    });
  }
  return { type: "layout", direction: "vertical", children: children };
}

function render() {
  if (!api) return;
  api.ui.setViewData(VIEW, {
    type: "split",
    persistKey: "explorer",
    initialSize: 320,
    minSize: 220,
    maxSize: 640,
    children: [treePane(), detailPane()]
  }, { scrollKey: "explorer" });
}

// --- loading ---------------------------------------------------------------

function loadRoots(force) {
  state.error = null;
  var h = state.hierarchy;
  var p;
  if (h === "tag") {
    if (state.tags && !force) return Promise.resolve();
    p = api.library.getTags().then(function (tags) {
      state.tags = (tags || []).filter(function (t) { return t.track_count > 0; })
        .sort(function (a, b) { return fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : 0; });
    });
  } else if (h === "year") {
    p = loadAllAlbums(force);
  } else {
    if (state.artists && !force) return Promise.resolve();
    p = api.library.getArtists({ sort: "name" }).then(function (artists) {
      // Album-artist tree: an artist who only performs on others' albums has
      // no album of their own to show here.
      state.artists = (artists || []).filter(function (a) {
        return typeof a.album_count === "number" ? a.album_count > 0 : a.track_count > 0;
      });
    });
  }
  return p.then(render, function (e) {
    logError("Failed to read the library", e);
    state.error = "Couldn't read your library.";
    render();
  });
}

function loadAllAlbums(force) {
  if (state.albums && !force) return Promise.resolve(state.albums);
  return api.library.getAlbums({ sort: "year" }).then(function (albums) {
    state.albums = albums || [];
    return state.albums;
  });
}

/** Keep only the albums `artistId` owns. The host already narrows by
 *  `albumArtistId`; this is the fallback for a host that ignores it. */
function ownedBy(list, artistId) {
  return (list || []).filter(function (al) {
    return al.artist_id === undefined || al.artist_id === null || al.artist_id === artistId;
  });
}

/** Albums an artist OWNS (album-artist meaning), cached. */
function albumsOfArtist(artistId) {
  if (state.albumsByArtist[artistId]) return Promise.resolve(state.albumsByArtist[artistId]);
  return api.library.getAlbums({ albumArtistId: artistId, sort: "year" }).then(function (list) {
    state.albumsByArtist[artistId] = ownedBy(list, artistId);
    return state.albumsByArtist[artistId];
  });
}

function artistsOfTag(tagId) {
  if (state.artistsByTag[tagId]) return Promise.resolve(state.artistsByTag[tagId]);
  return api.library.getArtists({ tagId: tagId }).then(function (list) {
    state.artistsByTag[tagId] = list || [];
    return state.artistsByTag[tagId];
  });
}

function albumsOfTagArtist(tagId, artistId) {
  var key = tagId + ":" + artistId;
  if (state.albumsByTagArtist[key]) return Promise.resolve(state.albumsByTagArtist[key]);
  // The tag's artists are album artists (getArtists({ tagId })), so their
  // albums are the ones they own — a compilation stays under its album artist.
  return api.library.getAlbums({ tagId: tagId, albumArtistId: artistId }).then(function (list) {
    state.albumsByTagArtist[key] = ownedBy(list, artistId);
    return state.albumsByTagArtist[key];
  });
}

function tracksOfTag(tagId) {
  if (state.tagTracks[tagId]) return Promise.resolve(state.tagTracks[tagId]);
  return api.library.getTracks({ tagId: tagId }).then(function (list) {
    state.tagTracks[tagId] = list || [];
    return state.tagTracks[tagId];
  });
}

/**
 * Run `fn` over `items` with at most `limit` in flight, results in input order.
 * `stop()` (checked before each start) ends the run early; results not
 * fetched stay `undefined`.
 */
function mapLimit(items, limit, fn, stop) {
  return new Promise(function (resolve, reject) {
    var results = new Array(items.length);
    var next = 0;
    var running = 0;
    var failed = false;
    function launch() {
      if (failed) return;
      if ((next >= items.length || (stop && stop())) && running === 0) { resolve(results); return; }
      while (running < limit && next < items.length && !(stop && stop())) {
        (function (i) {
          running++;
          Promise.resolve(fn(items[i], i)).then(function (v) {
            results[i] = v;
            running--;
            launch();
          }, function (e) { failed = true; reject(e); });
        })(next++);
      }
    }
    launch();
  });
}

// Album fetches in flight at once. One at a time made an artist with 20
// albums 21 round trips end to end; all at once would flood the bridge on a
// decade of hundreds of albums.
var ALBUM_FETCH_CONCURRENCY = 6;

/** Tracks of several albums, in album order, stopping once past the cap. */
function tracksOfAlbums(albums) {
  var count = 0;
  return mapLimit(albums, ALBUM_FETCH_CONCURRENCY, function (al) {
    return api.library.getTracks({ albumId: al.id }).then(function (ts) {
      count += (ts || []).length;
      return ts || [];
    });
  }, function () { return count > TRACK_CAP; }).then(unionTracks);
}

function albumsOfYearNode(d) {
  return loadAllAlbums(false).then(function (albums) {
    return albums.filter(function (al) {
      if (d.kind === "year") return al.year === d.year;
      if (d.decade === null) return decadeOf(al.year) === null;
      return decadeOf(al.year) === d.decade;
    });
  });
}

function tracksFor(d) {
  switch (d.kind) {
    case "album":
      return api.library.getTracks({ albumId: d.albumId });
    case "artist":
      return albumsOfArtist(d.artistId).then(function (albums) {
        // No album of their own (an older host can't tell): their tracks as
        // track artist rather than an empty pane.
        return albums.length ? tracksOfAlbums(albums) : api.library.getTracks({ artistId: d.artistId });
      });
    case "tag":
      return tracksOfTag(d.tagId);
    case "tag-artist":
      return Promise.all([tracksOfTag(d.tagId), albumsOfTagArtist(d.tagId, d.artistId)]).then(function (r) {
        var ids = {};
        for (var i = 0; i < r[1].length; i++) ids[r[1][i].id] = true;
        return r[0].filter(function (t) { return t.album_id !== null && ids[t.album_id]; });
      });
    case "decade":
    case "year":
      return albumsOfYearNode(d).then(tracksOfAlbums);
    default:
      return Promise.resolve([]);
  }
}

// --- actions -----------------------------------------------------------------

var LOADING_DELAY_MS = 150;
var loadingTimer = null;

function onSelect(p) {
  if (!p || !p.id) return;
  var label = p.data && (p.data.title || p.data.name) ? (p.data.title || p.data.name)
    : p.data && p.data.kind === "decade" ? (p.data.decade === null ? "Unknown year" : p.data.decade + "s")
    : p.data && p.data.kind === "year" ? String(p.data.year) : p.id;
  state.selection = { id: p.id, data: p.data || {}, label: label };
  state.tracks = [];
  state.capped = false;
  state.trackFilter = "";
  state.sort = { column: "order", dir: "asc" };
  state.loadingTracks = true;
  var gen = ++state.gen;
  // No "Loading…" redraw for a fast answer: every redraw re-sends the whole
  // tree, and most clicks answer well inside this. The tree marks the click
  // itself at once, so nothing looks unanswered meanwhile.
  if (loadingTimer) clearTimeout(loadingTimer);
  loadingTimer = setTimeout(function () {
    loadingTimer = null;
    if (gen === state.gen && state.loadingTracks) render();
  }, LOADING_DELAY_MS);
  tracksFor(state.selection.data).then(function (tracks) {
    if (gen !== state.gen) return;
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
    var list = tracks || [];
    state.capped = list.length > TRACK_CAP;
    state.tracks = state.capped ? list.slice(0, TRACK_CAP) : list;
    state.loadingTracks = false;
    Promise.resolve(api.storage.set("lastSelection", { hierarchy: state.hierarchy, id: p.id, data: p.data || null, label: label }))
      .catch(function (e) { logError("Failed to remember the selection", e); });
    render();
  }, function (e) {
    if (gen !== state.gen) return;
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
    logError("Failed to load tracks", e);
    state.loadingTracks = false;
    state.error = "Couldn't load the tracks for " + label + ".";
    render();
  });
}

function onExpand(p) {
  if (!p || !p.id) return;
  state.expanded[state.hierarchy][p.id] = !!p.expanded;
  if (!p.expanded) return; // nothing to load; the host already collapsed it
  var d = p.data || {};
  var load = null;
  if (d.kind === "artist" && !state.albumsByArtist[d.artistId]) load = albumsOfArtist(d.artistId);
  else if (d.kind === "tag" && !state.artistsByTag[d.tagId]) load = artistsOfTag(d.tagId);
  else if (d.kind === "tag-artist" && !state.albumsByTagArtist[d.tagId + ":" + d.artistId]) load = albumsOfTagArtist(d.tagId, d.artistId);
  if (!load) { render(); return; }
  load.then(render, function (e) {
    logError("Failed to expand " + p.id, e);
    // Loaded-and-empty, so the row doesn't sit on "Loading…" forever.
    if (d.kind === "artist") state.albumsByArtist[d.artistId] = [];
    else if (d.kind === "tag") state.artistsByTag[d.tagId] = [];
    else state.albumsByTagArtist[d.tagId + ":" + d.artistId] = [];
    render();
  });
}

function onTreeFilter(p) {
  state.treeFilter = (p && p.query) || "";
  // Album titles are searchable only once every artist's albums are known.
  if (state.treeFilter && state.hierarchy === "artist") {
    var missing = state.artists && state.artists.some(function (a) { return !state.albumsByArtist[a.id]; });
    if (missing) {
      loadAllAlbums(false).then(function (albums) {
        var by = {};
        for (var i = 0; i < albums.length; i++) {
          var al = albums[i];
          if (al.artist_id === undefined || al.artist_id === null) continue;
          (by[al.artist_id] = by[al.artist_id] || []).push(al);
        }
        for (var j = 0; j < state.artists.length; j++) {
          var id = state.artists[j].id;
          if (!state.albumsByArtist[id]) state.albumsByArtist[id] = by[id] || [];
        }
        render();
      }, function (e) { logError("Failed to read albums for the filter", e); });
    }
  }
  render();
}

function onHierarchy(p) {
  var v = p && p.value;
  if (v !== "artist" && v !== "tag" && v !== "year") return;
  if (v === state.hierarchy) return;
  state.hierarchy = v;
  state.treeFilter = "";
  Promise.resolve(api.storage.set("hierarchy", v)).catch(function (e) { logError("Failed to remember the hierarchy", e); });
  render();
  loadRoots(false);
}

function onSort(p) {
  if (!p || !p.column) return;
  if (p.column === state.sort.column && p.direction === state.sort.dir) return;
  // A fresh text column reads A→Z first; the host suggests "desc" for any
  // newly clicked column (it can't know the column is text).
  var textCol = p.column === "album";
  var dir = p.column !== state.sort.column && textCol ? "asc" : (p.direction === "asc" ? "asc" : "desc");
  state.sort = { column: p.column, dir: dir };
  render();
}

function visibleTracks() {
  return sortTracks(filterTracks(state.tracks, state.trackFilter), state.sort.column, state.sort.dir);
}

function playContext() {
  return { name: state.selection ? state.selection.label : "Explorer", source: "playlist" };
}

function onPlay(shuffle) {
  var list = visibleTracks();
  if (!list.length) return;
  if (shuffle) list = shuffled(list);
  Promise.resolve(api.playback.playTracks(list.map(toPluginTrack), 0, playContext())).catch(function (e) {
    logError("Failed to play", e);
    api.ui.showNotification("Couldn't start playback", { kind: "error" });
  });
}

/**
 * What a row's Play runs: exactly the rows it names, in list order. One row
 * (a double-click, Enter, its ▶) plays just that track; several selected rows
 * (the toolbar's "Play (N)") play just those. The whole list is the header's
 * Play. (Playing the list from the clicked row put every track of an artist
 * in the queue when the user asked for one.)
 */
function planRowPlay(visible, payload) {
  var p = payload || {};
  var ids = p.selectedIds && p.selectedIds.length ? p.selectedIds : (p.itemId ? [p.itemId] : []);
  if (!ids.length) return null;
  var want = {};
  for (var i = 0; i < ids.length; i++) want[ids[i]] = true;
  var picked = visible.filter(function (t) { return want[trackRow(t).id]; });
  return picked.length ? { tracks: picked, start: 0 } : null;
}

function onPlayRows(payload) {
  var plan = planRowPlay(visibleTracks(), payload);
  if (!plan) return;
  Promise.resolve(api.playback.playTracks(plan.tracks.map(toPluginTrack), plan.start, playContext())).catch(function (e) {
    logError("Failed to play", e);
    api.ui.showNotification("Couldn't start playback", { kind: "error" });
  });
}

function onEnqueue() {
  var list = visibleTracks();
  if (!list.length) return;
  Promise.resolve(api.playback.insertTracks(list.map(toPluginTrack), -1)).then(function () {
    api.ui.showNotification("Added " + plural(list.length, "track") + " to the queue", { kind: "success" });
  }, function (e) {
    logError("Failed to enqueue", e);
    api.ui.showNotification("Couldn't add to the queue", { kind: "error" });
  });
}

/** The library changed (a scan, a download): drop every cache and redraw,
 *  keeping the selection if it still resolves. */
var refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(function () {
    refreshTimer = null;
    var keep = state;
    var next = freshState();
    next.hierarchy = keep.hierarchy;
    next.expanded = keep.expanded;
    next.treeFilter = keep.treeFilter;
    state = next;
    loadRoots(true).then(function () {
      if (keep.selection) onSelect({ id: keep.selection.id, data: keep.selection.data });
    });
  }, 1000);
}

function activate(a) {
  api = a;
  state = freshState();
  render();
  api.ui.onAction("select", onSelect);
  api.ui.onAction("expand", onExpand);
  api.ui.onAction("tree-filter", onTreeFilter);
  api.ui.onAction("track-filter", function (p) { state.trackFilter = (p && p.query) || ""; render(); });
  api.ui.onAction("hierarchy", onHierarchy);
  api.ui.onAction("sort", onSort);
  api.ui.onAction("play", function () { onPlay(false); });
  api.ui.onAction("shuffle", function () { onPlay(true); });
  api.ui.onAction("enqueue", onEnqueue);
  api.ui.onAction("play-rows", onPlayRows);
  api.library.onScanComplete(scheduleRefresh);
  api.library.onTrackAdded(scheduleRefresh);
  api.library.onTrackRemoved(scheduleRefresh);

  Promise.all([
    Promise.resolve(api.storage.get("hierarchy")).catch(function (e) { logError("Failed to read the saved hierarchy", e); return null; }),
    Promise.resolve(api.storage.get("lastSelection")).catch(function (e) { logError("Failed to read the saved selection", e); return null; })
  ]).then(function (r) {
    var h = r[0];
    if (h === "artist" || h === "tag" || h === "year") state.hierarchy = h;
    return loadRoots(false).then(function () {
      var last = r[1];
      if (last && last.hierarchy === state.hierarchy && last.id) onSelect({ id: last.id, data: last.data });
    });
  });
}

function deactivate() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (loadingTimer) clearTimeout(loadingTimer);
  loadingTimer = null;
  api = null;
}

return {
  activate: activate,
  deactivate: deactivate,
  _fold: fold,
  _formatDuration: formatDuration,
  _formatTotal: formatTotal,
  _decadeOf: decadeOf,
  _groupByDecade: groupByDecade,
  _buildArtistNodes: buildArtistNodes,
  _buildTagNodes: buildTagNodes,
  _buildYearNodes: buildYearNodes,
  _filterTree: filterTree,
  _unionTracks: unionTracks,
  _filterTracks: filterTracks,
  _sortTracks: sortTracks,
  _trackRow: trackRow,
  _toPluginTrack: toPluginTrack,
  _shuffled: shuffled,
  _describeSelection: describeSelection,
  _columnsFor: columnsFor,
  _mapLimit: mapLimit,
  _planRowPlay: planRowPlay,
  _TRACK_CAP: TRACK_CAP
};

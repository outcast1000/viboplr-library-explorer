const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPlugin } = require("./harness/sandbox");

const P = loadPlugin();

test("fold ignores case and accents", () => {
  assert.equal(P._fold("  Björk   Café "), "bjork cafe");
  assert.equal(P._fold(null), "");
});

test("formatDuration and formatTotal", () => {
  assert.equal(P._formatDuration(65), "1:05");
  assert.equal(P._formatDuration(3725), "1:02:05");
  assert.equal(P._formatDuration(null), "");
  assert.equal(P._formatTotal(42 * 60), "42 min");
  assert.equal(P._formatTotal(72 * 60), "1 h 12 min");
  assert.equal(P._formatTotal(120 * 60), "2 h");
  assert.equal(P._formatTotal(0), "");
});

test("groupByDecade sorts decades and years, and buckets undated albums last", () => {
  const g = P._groupByDecade([
    { id: 1, year: 1998 }, { id: 2, year: 1994 }, { id: 3, year: null }, { id: 4, year: 2003 }, { id: 5, year: 1994 },
  ]);
  assert.deepEqual(g.decades.map((d) => d.decade), [1990, 2000]);
  assert.deepEqual(g.decades[0].years.map((y) => y.year), [1994, 1998]);
  assert.deepEqual(g.decades[0].years[0].albums.map((a) => a.id), [2, 5], "input order kept within a year");
  assert.deepEqual(g.unknown.map((a) => a.id), [3]);
});

test("year nodes: decade › year › album, unknown year last without a year level", () => {
  const nodes = P._buildYearNodes([
    { id: 1, title: "A", year: 1994, track_count: 3 },
    { id: 2, title: "B", year: null, track_count: 1 },
  ]);
  assert.deepEqual(nodes.map((n) => n.id), ["dec:1990", "dec:unknown"]);
  assert.equal(nodes[0].children[0].id, "yr:1994");
  assert.equal(nodes[0].children[0].children[0].id, "al:1");
  assert.equal(nodes[1].children[0].id, "al:2");
});

test("artist nodes are lazy until their albums are loaded, and carry an entity", () => {
  const artists = [{ id: 1, name: "Massive Attack", album_count: 2 }];
  const lazy = P._buildArtistNodes(artists, {});
  assert.equal(lazy[0].hasChildren, true);
  assert.equal(lazy[0].children, undefined);
  assert.deepEqual(lazy[0].entity, { kind: "artist", id: 1, name: "Massive Attack" });
  assert.equal(lazy[0].sublabel, "2 albums");
  const loaded = P._buildArtistNodes(artists, { 1: [{ id: 11, title: "Mezzanine", artist_name: "Massive Attack", year: 1998 }] });
  assert.equal(loaded[0].children[0].id, "al:11");
  assert.deepEqual(loaded[0].children[0].entity, { kind: "album", id: 11, name: "Mezzanine", artistName: "Massive Attack" });
});

test("tag nodes prefix child ids with the tag, so one artist can sit under two tags", () => {
  const nodes = P._buildTagNodes(
    [{ id: 7, name: "Trip Hop" }, { id: 8, name: "Electronic" }],
    { 7: [{ id: 1, name: "MA" }], 8: [{ id: 1, name: "MA" }] },
    { "7:1": [{ id: 11, title: "Mezzanine" }] },
  );
  assert.equal(nodes[0].children[0].id, "tg:7/ar:1");
  assert.equal(nodes[1].children[0].id, "tg:8/ar:1");
  assert.equal(nodes[0].children[0].children[0].id, "tg:7/al:11");
  assert.equal(nodes[1].children[0].children, undefined, "not loaded for this tag yet");
});

test("filterTree keeps ancestors of a match, expands them, and keeps a matching node whole", () => {
  const tree = [
    { id: "a", label: "Massive Attack", children: [{ id: "a1", label: "Mezzanine" }, { id: "a2", label: "Protection" }] },
    { id: "b", label: "Portishead", children: [{ id: "b1", label: "Dummy" }] },
    { id: "c", label: "Björk", children: undefined },
  ];
  const byAlbum = P._filterTree(tree, "mezz");
  assert.deepEqual(byAlbum.nodes.map((n) => n.id), ["a"]);
  assert.deepEqual(byAlbum.nodes[0].children.map((n) => n.id), ["a1"]);
  assert.deepEqual(byAlbum.expandIds, ["a"]);
  assert.equal(tree[0].children.length, 2, "input untouched");

  const byArtist = P._filterTree(tree, "portis");
  assert.equal(byArtist.nodes[0].children.length, 1, "a matching node keeps its subtree");
  assert.deepEqual(byArtist.expandIds, []);

  assert.deepEqual(P._filterTree(tree, "bjork").nodes.map((n) => n.id), ["c"], "accent-insensitive");
  assert.equal(P._filterTree(tree, "").nodes, tree);
});

test("unionTracks drops repeats and keeps first-seen order", () => {
  const u = P._unionTracks([[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], null]);
  assert.deepEqual(u.map((t) => t.id), [1, 2, 3]);
});

test("sortTracks is stable, honours direction, and puts empty values last", () => {
  const ts = [
    { id: 1, title: "b", year: 1998 },
    { id: 2, title: "a", year: null },
    { id: 3, title: "c", year: 1994 },
  ];
  assert.deepEqual(P._sortTracks(ts, "year", "asc").map((t) => t.id), [3, 1, 2]);
  assert.deepEqual(P._sortTracks(ts, "year", "desc").map((t) => t.id), [1, 3, 2]);
  assert.deepEqual(P._sortTracks(ts, "title", "asc").map((t) => t.id), [2, 1, 3]);
  assert.deepEqual(P._sortTracks(ts, "order", "asc").map((t) => t.id), [1, 2, 3]);
});

test("filterTracks matches title, artist, album and album artist", () => {
  const ts = [
    { id: 1, title: "Angel", artist_name: "Massive Attack", album_title: "Mezzanine" },
    { id: 2, title: "Overcome", artist_name: "Tricky", album_title: "Comp", album_artist_name: "Various Artists" },
  ];
  assert.deepEqual(P._filterTracks(ts, "mezz").map((t) => t.id), [1]);
  assert.deepEqual(P._filterTracks(ts, "various").map((t) => t.id), [2]);
  assert.equal(P._filterTracks(ts, "").length, 2);
});

test("trackRow fills every column cell, blank for unknowns", () => {
  const row = P._trackRow({ id: 5, path: "file:///x.flac", title: "T", artist_name: "A", album_title: "B", year: null, track_number: 2, duration_secs: 61, format: "flac" });
  assert.equal(row.id, "t:5");
  assert.deepEqual(row.cells, { num: "2", album: "B", year: "", duration: "1:01" });
  assert.equal(row.subtitle, "A", "the artist rides on the subtitle line");
  assert.equal(row.path, "file:///x.flac");
});

test("columns follow the selection, and stay narrow enough to leave the title room", () => {
  assert.deepEqual(P._columnsFor("album").map((c) => c.id), ["num", "duration"]);
  assert.deepEqual(P._columnsFor("artist").map((c) => c.id), ["album", "year", "duration"]);
  const widest = Math.max(...["album", "artist", "tag", "year"].map((k) =>
    P._columnsFor(k).reduce((w, c) => w + c.width, 0)));
  assert.ok(widest <= 260, `fixed columns take ${widest}px of a ~440px pane`);
});

test("shuffled is a permutation and leaves the input alone", () => {
  const input = [1, 2, 3, 4, 5];
  let i = 0;
  const seq = [0.1, 0.9, 0.5, 0.3];
  const out = P._shuffled(input, () => seq[i++ % seq.length]);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
});

test("mapLimit keeps at most `limit` in flight, returns results in input order", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await P._mapLimit([30, 5, 20, 1, 10], 2, (ms, i) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise((r) => setTimeout(() => { inFlight--; r(i); }, ms));
  });
  assert.deepEqual(out, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
});

test("mapLimit stops starting new work once stop() says so, and rejects on a failure", async () => {
  let started = 0;
  const out = await P._mapLimit([1, 2, 3, 4, 5], 1, () => { started++; return Promise.resolve(started); }, () => started >= 2);
  assert.equal(started, 2);
  assert.deepEqual(out.slice(0, 2), [1, 2]);
  assert.equal(out[2], undefined);
  await assert.rejects(P._mapLimit([1], 2, () => Promise.reject(new Error("boom"))), /boom/);
  assert.deepEqual(await P._mapLimit([], 3, () => 1), []);
});

test("describeSelection names the kind and totals the length", () => {
  const d = P._describeSelection(
    { label: "Mezzanine", data: { kind: "album", artistName: "Massive Attack", year: 1998 } },
    [{ duration_secs: 1800 }, { duration_secs: 1800 }],
    false,
  );
  assert.equal(d.subtitle, "Album · Massive Attack · 1998");
  assert.equal(d.meta, "2 tracks · 1 h");
  const capped = P._describeSelection({ label: "1990s", data: { kind: "decade", decade: 1990 } }, [], true);
  assert.match(capped.meta, /first 2000 shown/);
});

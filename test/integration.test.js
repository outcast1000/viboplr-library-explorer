// Drives activate() against the mock host: the view it draws, what clicking a
// node loads, and what Play / Enqueue hand the host.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPlugin } = require("./harness/sandbox");
const { makeApi, flush, findNode } = require("./harness/mock-api");

async function start(seed) {
  const P = loadPlugin();
  const h = makeApi();
  if (seed) for (const [k, v] of Object.entries(seed)) h.kv.set(k, v);
  P.activate(h.api);
  await flush();
  return { P, h, tree: () => findNode(h.lastView(), "tree"), rows: () => findNode(h.lastView(), "track-row-list") };
}

test("draws a split with an album-artist tree, leaving out performers with no album", async () => {
  const { h, tree } = await start();
  const view = h.lastView();
  assert.equal(view.type, "split");
  assert.equal(view.persistKey, "explorer");
  assert.deepEqual(tree().nodes.map((n) => n.label), ["Massive Attack", "Portishead", "Various Artists"]);
  assert.deepEqual(h.calls.find((c) => c.name === "getArtists").args[0], { sort: "name" });
});

test("expanding an artist lists only the albums it owns", async () => {
  const { h, tree } = await start();
  h.act("expand", { id: "ar:1", expanded: true, data: { kind: "artist", artistId: 1 } });
  await flush();
  const ma = tree().nodes[0];
  assert.deepEqual(ma.children.map((n) => n.label), ["Protection", "Mezzanine"]);
  assert.ok(tree().expandedIds.includes("ar:1"), "the plugin echoes the user's expansion");

  // Tricky performs on the compilation but owns nothing; Various Artists owns it.
  h.act("expand", { id: "ar:3", expanded: true, data: { kind: "artist", artistId: 3 } });
  await flush();
  assert.deepEqual(tree().nodes[2].children.map((n) => n.label), ["Bristol Sound"]);
});

test("selecting an album shows its tracks in track order with a plain header", async () => {
  const { h, rows } = await start();
  h.act("select", { id: "al:11", data: { kind: "album", albumId: 11, title: "Mezzanine", artistName: "Massive Attack", year: 1998 } });
  await flush();
  assert.deepEqual(rows().items.map((r) => r.title), ["Angel", "Teardrop"]);
  const header = findNode(h.lastView(), "detail-header");
  assert.equal(header.title, "Mezzanine");
  assert.equal(header.plain, true);
  assert.match(header.meta, /^2 tracks/);
  assert.equal(findNode(h.lastView(), "tree").selectedId, "al:11");
});

test("a fast selection sends one redraw, not a Loading… one first", async () => {
  const { h } = await start();
  const before = h.views.length;
  h.act("select", { id: "al:20", data: { kind: "album", albumId: 20, title: "Dummy" } });
  await flush();
  assert.equal(h.views.length - before, 1, "every redraw re-sends the whole tree");
  assert.equal(findNode(h.lastView(), "loading"), null);
});

test("a slow selection shows Loading… after a moment", async () => {
  const { h } = await start();
  let release;
  h.api.library.getTracks = () => new Promise((r) => { release = r; });
  h.act("select", { id: "al:20", data: { kind: "album", albumId: 20, title: "Dummy" } });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(findNode(h.lastView(), "loading"), "the wait is shown once it is noticeable");
  release([]);
  await flush();
  assert.equal(findNode(h.lastView(), "loading"), null);
});

test("selecting an artist plays its albums in year order", async () => {
  const { h, rows } = await start();
  h.act("select", { id: "ar:1", data: { kind: "artist", artistId: 1, name: "Massive Attack" } });
  await flush();
  assert.deepEqual(rows().items.map((r) => r.title), ["Karmacoma", "Angel", "Teardrop"]);

  h.act("play");
  await flush();
  const play = h.calls.find((c) => c.name === "playTracks");
  assert.deepEqual(play.args[0].map((t) => t.title), ["Karmacoma", "Angel", "Teardrop"]);
  assert.equal(play.args[1], 0);
  assert.deepEqual(play.args[2], { name: "Massive Attack", source: "playlist" });
  assert.equal(play.args[0][0].path, "file:///music/100.flac");
});

test("the track list declares a Play row action — double-click has nothing to run without one", async () => {
  const { h, rows } = await start();
  h.act("select", { id: "ar:1", data: { kind: "artist", artistId: 1, name: "Massive Attack" } });
  await flush();
  assert.equal(rows().actions[0].id, "play-rows");
});

test("a row's Play (double-click / Enter / ▶) plays just that track", async () => {
  const { h, rows } = await start();
  h.act("select", { id: "ar:1", data: { kind: "artist", artistId: 1, name: "Massive Attack" } });
  await flush();
  const teardrop = rows().items.find((r) => r.title === "Teardrop");
  // What the host sends for a double-click on a row with no per-row action.
  h.act("play-rows", { selectedIds: [teardrop.id], itemId: teardrop.id });
  await flush();
  const play = h.calls.find((c) => c.name === "playTracks");
  assert.deepEqual(play.args[0].map((t) => t.title), ["Teardrop"], "not the rest of the artist");
  assert.equal(play.args[1], 0);
  assert.equal(play.args[0][0].path, "file:///music/111.flac", "the library's own path, unchanged");
});

test("the hover ▶ (itemId only) plays just that track too", async () => {
  const { h, rows } = await start();
  h.act("select", { id: "al:11", data: { kind: "album", albumId: 11, title: "Mezzanine" } });
  await flush();
  const angel = rows().items.find((r) => r.title === "Angel");
  h.act("play-rows", { itemId: angel.id });
  await flush();
  assert.deepEqual(h.calls.find((c) => c.name === "playTracks").args[0].map((t) => t.title), ["Angel"]);
});

test("Play on several selected rows plays just those, in list order", async () => {
  const { h, rows } = await start();
  h.act("select", { id: "ar:1", data: { kind: "artist", artistId: 1, name: "Massive Attack" } });
  await flush();
  const items = rows().items;
  h.act("play-rows", { selectedIds: [items[2].id, items[0].id] });
  await flush();
  const play = h.calls.find((c) => c.name === "playTracks");
  assert.deepEqual(play.args[0].map((t) => t.title), ["Karmacoma", "Teardrop"]);
  assert.equal(play.args[1], 0);
});

test("enqueue appends what is shown — filtered and sorted", async () => {
  const { h, rows } = await start();
  h.act("select", { id: "ar:1", data: { kind: "artist", artistId: 1, name: "Massive Attack" } });
  await flush();
  h.act("sort", { column: "duration", direction: "desc" });
  assert.deepEqual(rows().items.map((r) => r.title), ["Angel", "Teardrop", "Karmacoma"]);
  h.act("track-filter", { query: "t" }); // Teardrop, Karmacoma (title or artist "Massive Attack")
  h.act("enqueue");
  await flush();
  const ins = h.calls.find((c) => c.name === "insertTracks");
  assert.equal(ins.args[1], -1);
  assert.deepEqual(ins.args[0].map((t) => t.title), rows().items.map((r) => r.title));
  assert.ok(h.calls.some((c) => c.name === "notify" && /Added/.test(c.args[0])));
});

test("a text column sorts A→Z first even though the host suggests desc", async () => {
  const { h, rows } = await start();
  h.act("select", { id: "ar:1", data: { kind: "artist", artistId: 1, name: "Massive Attack" } });
  await flush();
  h.act("sort", { column: "album", direction: "desc" });
  assert.equal(rows().sortDir, "asc");
  assert.deepEqual(rows().items.map((r) => r.albumTitle), ["Mezzanine", "Mezzanine", "Protection"]);
});

test("tag hierarchy: tag › album artist › album, and a tag-artist shows only its tagged albums' tracks", async () => {
  const { h, tree, rows } = await start();
  h.act("hierarchy", { value: "tag" });
  await flush();
  assert.deepEqual(tree().nodes.map((n) => n.label), ["Trip Hop"], "empty tags left out");

  h.act("expand", { id: "tg:7", expanded: true, data: { kind: "tag", tagId: 7, name: "Trip Hop" } });
  await flush();
  assert.deepEqual(tree().nodes[0].children.map((n) => n.label), ["Massive Attack", "Portishead", "Various Artists"]);

  h.act("select", { id: "tg:7/ar:1", data: { kind: "tag-artist", tagId: 7, tagName: "Trip Hop", artistId: 1, name: "Massive Attack" } });
  await flush();
  // The pane shows the TAGGED tracks on that artist's albums: Angel is tagged,
  // Teardrop (same album) and Karmacoma (another album) aren't.
  assert.deepEqual(rows().items.map((r) => r.title), ["Angel"]);
  assert.equal(h.kv.get("hierarchy"), "tag");
});

test("year hierarchy groups by decade and year, undated last; a decade plays its albums", async () => {
  const { h, tree, rows } = await start();
  h.act("hierarchy", { value: "year" });
  await flush();
  assert.deepEqual(tree().nodes.map((n) => n.label), ["1990s", "Unknown year"]);
  assert.deepEqual(tree().nodes[0].children.map((n) => n.label), ["1994", "1998"]);

  h.act("select", { id: "dec:1990", data: { kind: "decade", decade: 1990 } });
  await flush();
  assert.equal(findNode(h.lastView(), "detail-header").title, "1990s");
  assert.equal(rows().items.length, 5);
});

test("the tree filter searches album titles too, loading every album once", async () => {
  const { h, tree } = await start();
  h.act("tree-filter", { query: "dummy" });
  await flush();
  assert.deepEqual(tree().nodes.map((n) => n.label), ["Portishead"]);
  assert.deepEqual(tree().nodes[0].children.map((n) => n.label), ["Dummy"]);
  assert.ok(tree().expandedIds.includes("ar:2"));
});

test("restores the last hierarchy and selection", async () => {
  const { h, rows } = await start({
    hierarchy: "artist",
    lastSelection: { hierarchy: "artist", id: "al:20", data: { kind: "album", albumId: 20, title: "Dummy" }, label: "Dummy" },
  });
  await flush();
  assert.equal(findNode(h.lastView(), "tree").selectedId, "al:20");
  assert.deepEqual(rows().items.map((r) => r.title), ["Sour Times", "Glory Box"]);
});

test("a late answer for an older selection doesn't overwrite the newer one", async () => {
  const { h, rows } = await start();
  h.act("select", { id: "al:20", data: { kind: "album", albumId: 20, title: "Dummy" } });
  h.act("select", { id: "al:10", data: { kind: "album", albumId: 10, title: "Protection" } });
  await flush();
  assert.deepEqual(rows().items.map((r) => r.title), ["Karmacoma"]);
});

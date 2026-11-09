# Explorer — a library browser for Vibo

A master/detail view of your library. On the left is a tree you can switch
between three ways of browsing:

- **Artist › Album**
- **Genre › Artist › Album** (your library's tags)
- **Decade › Year › Album**

Pick anything in the tree and its tracks appear on the right, with **Play**,
**Shuffle** and **Enqueue**, a filter box and sortable columns (#, Artist,
Album, Year, Format, Time). Right-click an artist or album in the tree for
Vibo's own artist / album menu; right-click tracks for the usual track menu, or
drag them to the queue. The divider between the panes can be dragged, and Vibo
remembers where you left it.

"Artist" always means the **album artist**, as everywhere else in Vibo: a
compilation sits under "Various Artists", and an artist who only appears on
other people's albums has no entry of their own in the tree. Their tracks are
still found under the albums they're on, and by the filter box.

Requires Vibo **1.0.118** or newer (the `split` and `tree` view nodes and the
tag-scoped library reads).

## Permissions

| Permission | Why |
|---|---|
| `library:read` | List your artists, albums, tags and tracks to build the tree |
| `playback:control` | Play or enqueue the tracks of what you picked |

Nothing leaves your computer: the plugin makes no network requests.

## Development

The plugin is `index.js` (ES5, evaluated by the host with `new Function`) plus
`manifest.json`. To try a change, point Vibo's dev plugin folder (Settings →
Debug, with Debug mode on) at this repo and press **Reload** on the view.

```bash
npm test          # node --test: pure helpers + activate() against a mock host
```

`test/harness/sandbox.js` loads `index.js` the way the host does and makes any
use of a global the worker doesn't have throw; `test/harness/mock-api.js` is an
in-memory library with a compilation in it.

See [RELEASING.md](RELEASING.md) for cutting a release.

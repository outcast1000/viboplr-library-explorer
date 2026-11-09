# Releasing & publishing

This plugin ships as a GitHub release containing `library-explorer.zip` (with
`manifest.json` at the **zip root**) and `update.json`. Vibo installs and
updates it from the `updateUrl` in `manifest.json`.

## Cut a release

1. `scripts/bump.sh patch` (or `minor` | `major` | `X.Y.Z`), then fill in the
   new `CHANGELOG.md` section.
2. Commit, tag and push: `git tag vX.Y.Z && git push origin main vX.Y.Z`.
3. The **Release** workflow runs the tests, checks the manifest version against
   the tag, builds and signs the zip (`TAURI_SIGNING_PRIVATE_KEY` secret — the
   **plugin**-signing key, never the app updater key) and publishes the release.
   Don't run `gh release create` by hand.

Permanent manifest endpoint:
`https://github.com/outcast1000/viboplr-library-explorer/releases/latest/download/update.json`

## First-time setup

```bash
gh repo create outcast1000/viboplr-library-explorer --public --source . --remote origin --push
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo outcast1000/viboplr-library-explorer < ~/.viboplr/plugin-signing-2.key
```

## Registering in the plugin gallery

After the first release exists, add to `outcast1000/viboplr-plugins` `index.json` under `plugins[]`:

```json
{
  "id": "library-explorer",
  "name": "Explorer",
  "author": "Vibo",
  "description": "Browse your library as a tree — by artist, genre or year — with the tracks of what you pick beside it",
  "stability": "experimental",
  "updateUrl": "https://github.com/outcast1000/viboplr-library-explorer/releases/latest/download/update.json"
}
```

`version`, `minAppVersion` and `provides` are filled in by the gallery's bots.

// Loads index.js the way the host does: `new Function("api", "window",
// "globalThis", "self", "document", code)`, so a parse error or a stray use of
// a global the worker doesn't have fails the tests, not a user's app.
const fs = require("node:fs");
const path = require("node:path");

const INDEX_PATH = path.join(__dirname, "..", "..", "index.js");

// Globals the plugin runtime does NOT provide. Shadowed as throwing bindings so
// any accidental use inside index.js fails loudly.
const FORBIDDEN = ["fetch", "require", "process", "module", "exports", "__dirname", "__filename", "global"];

function loadPlugin() {
  const code = fs.readFileSync(INDEX_PATH, "utf8");
  const preamble = FORBIDDEN
    .map((n) => `var ${n} = new Proxy(function(){}, { get: function(){ throw new Error("forbidden global accessed: ${n}"); }, apply: function(){ throw new Error("forbidden global called: ${n}"); } });`)
    .join("\n");
  const factory = new Function("api", "window", "globalThis", "self", "document", preamble + "\n" + code);
  const sandboxGlobal = Object.freeze({});
  return factory(undefined, sandboxGlobal, sandboxGlobal, sandboxGlobal, undefined);
}

module.exports = { loadPlugin };

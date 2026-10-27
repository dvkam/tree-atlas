import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { build } from "vite";
import react from "@vitejs/plugin-react";

// The instrumented copy is isolated. No profiling code enters the published application.
const root = resolve(".");
const runRoot = resolve(process.env.COLD_PROFILE_BUILD ?? `.tmp/cold-profile-${Date.now()}`);
await mkdir(runRoot, { recursive: true });
await cp(join(root, "src"), join(runRoot, "src"), { recursive: true });
await cp(join(root, "index.html"), join(runRoot, "index.html"));
const helper = `export function timed<T>(phase: string, run: () => T): T { const start=performance.now(); try { return run(); } finally { console.info("TREE_PROFILE:"+JSON.stringify({phase,ms:performance.now()-start})); } }
export async function timedAsync<T>(phase: string, run: () => Promise<T>): Promise<T> { const start=performance.now(); try { return await run(); } finally { console.info("TREE_PROFILE:"+JSON.stringify({phase,ms:performance.now()-start})); } }`;
await writeFile(join(runRoot, "src/profile-phase.ts"), helper);
function replace(source, before, after, name) {
  if (!source.includes(before)) throw new Error(`Profiling hook changed: ${name}`);
  return source.replace(before, after);
}
async function instrument(file, rewrite) {
  const path = join(runRoot, "src", file);
  const source = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
  await writeFile(path, rewrite(source));
}
await instrument("verified-asset.ts", (source) => {
  let s = 'import { timedAsync } from "./profile-phase.ts";\n' + source;
  s = replace(
    s,
    "await fetch(url, { signal })",
    'await timedAsync("asset-response:"+url.pathname, () => fetch(url, { signal }))',
    "fetch",
  );
  s = replace(
    s,
    "await response.arrayBuffer()",
    'await timedAsync("asset-body:"+url.pathname, () => response.arrayBuffer())',
    "body",
  );
  s = s.replaceAll(
    "await digest(bytes)",
    'await timedAsync("asset-hash:"+url.pathname, () => digest(bytes))',
  );
  s = replace(
    s,
    "await remember(next.cache, next.key, next.bytes, next.signal)",
    'await timedAsync("background-asset-store:"+new URL(next.key).pathname, () => remember(next.cache, next.key, next.bytes, next.signal))',
    "store",
  );
  return s;
});
await instrument("inventory.ts", (source) => {
  let s = 'import { timed, timedAsync } from "./profile-phase.ts";\n' + source;
  s = replace(
    s,
    "const normalized = index.strings.map(normalizeText);",
    'const normalized = timed("search-dictionary", () => index.strings.map(normalizeText));',
    "normalized",
  );
  s = replace(
    s,
    "const ids = index.rows.map((row) => normalizeText(row[0]));",
    'const ids = timed("search-identifiers", () => index.rows.map((row) => normalizeText(row[0])));',
    "ids",
  );
  s = replace(
    s,
    "clusters.load(points);",
    'timed("cluster-build", () => clusters?.load(points));',
    "clusters",
  );
  s = replace(
    s,
    "const rows = validateIndex(\n      index,\n      descriptor,\n      split ? { ...dataset, locatedCount: 0 } : dataset,\n    );",
    'const rows = timed("index-identity", () => validateIndex(index, descriptor, split ? { ...dataset, locatedCount: 0 } : dataset));',
    "identity",
  );
  s = replace(
    s,
    "decodeIndexColumns(unpacked)",
    'timed("columns-decode-and-schema", () => decodeIndexColumns(unpacked))',
    "decode",
  );
  s = replace(
    s,
    "decodeTextColumns(unpacked)",
    'timed("text-columns-decode", () => decodeTextColumns(unpacked))',
    "text decode",
  );
  s = replace(
    s,
    "compactIndexSchema.parse(JSON.parse(new TextDecoder().decode(unpacked)))",
    'timed("index-schema", () => compactIndexSchema.parse(timed("json-decode-parse", () => JSON.parse(new TextDecoder().decode(unpacked)))))',
    "JSON",
  );
  s = replace(
    s,
    'await new Response(\n        new Blob([stored]).stream().pipeThrough(new DecompressionStream("gzip")),\n      ).arrayBuffer()',
    'await timedAsync("index-inflate", () => new Response(\n        new Blob([stored]).stream().pipeThrough(new DecompressionStream("gzip")),\n      ).arrayBuffer())',
    "inflate",
  );
  return s;
});
await instrument("main.tsx", (source) =>
  source
    .replace("import { StrictMode, Component }", "import { StrictMode, Component, Profiler }")
    .replace(
      "<RouterProvider router={router} />",
      '<Profiler id="atlas" onRender={(id, phase, actualDuration, baseDuration, startTime, commitTime) => console.info("TREE_REACT:"+JSON.stringify({id,phase,actualDuration,baseDuration,startTime,commitTime}))}><RouterProvider router={router} /></Profiler>',
    ),
);
await build({
  root: runRoot,
  configFile: false,
  base: "./",
  publicDir: join(root, "public"),
  resolve: { alias: { "react-dom/client": "react-dom/profiling" } },
  plugins: [react({ compiler: true })],
  build: { outDir: join(runRoot, "dist") },
});
let runner = await readFile(join(root, "scripts/mobile-benchmark.mjs"), "utf8");
runner = runner.replace(
  "const errors = [];",
  'const phaseEvents = []; const reactCommits = [];\n    page.on("console", message => { const text=message.text(); if(text.startsWith("TREE_PROFILE:")) phaseEvents.push(JSON.parse(text.slice(13))); if(text.startsWith("TREE_REACT:")) reactCommits.push(JSON.parse(text.slice(11))); });\n    const errors = [];',
);
runner = runner.replace(
  "served = [];\n      const started",
  "served = []; phaseEvents.length=0; reactCommits.length=0;\n      const started",
);
runner = runner.replace(
  "...observed,",
  "...observed, phaseEvents: structuredClone(phaseEvents), reactCommits: structuredClone(reactCommits),",
);
const runnerPath = join(runRoot, "run.mjs");
await writeFile(runnerPath, runner);
const child = spawn(process.execPath, [runnerPath], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    MOBILE_BENCH_ROOT: join(runRoot, "dist"),
    MOBILE_BENCH_OUTPUT: process.env.COLD_PROFILE_OUTPUT ?? ".tmp/cold-profile-baseline.json",
    MOBILE_BENCH_RUNS: process.env.COLD_PROFILE_RUNS ?? "1",
    MOBILE_BENCH_CITIES: process.env.COLD_PROFILE_CITIES ?? "vienna,geneva",
  },
});
const exitCode = await new Promise((done) => child.on("exit", done));
if (exitCode !== 0) throw new Error(`Profile run failed: ${exitCode}`);
console.log(`Instrumented production profiling build: ${runRoot}`);

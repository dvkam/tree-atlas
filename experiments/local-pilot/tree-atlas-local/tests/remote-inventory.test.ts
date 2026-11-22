import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { z } from "zod";
import { createRemoteInventorySession } from "../src/remote-inventory.ts";
import type { RemoteInventoryClient } from "../src/remote-inventory.ts";
import type { Dataset, Tree } from "../src/domain.ts";
import type { InventoryQuery } from "../src/index-format.ts";

const base = "https://local-atlas.test/api/";
const fingerprint = "a".repeat(64);
const dataset: Dataset = {
  id: "vienna",
  city: "Vienna",
  country: "Austria",
  center: [16.4, 48.2],
  bounds: [16, 48, 17, 49],
  release: "vienna-test",
  file: "releases/vienna-test/vienna.json",
  sha256: "b".repeat(64),
  count: 2,
  locatedCount: 2,
  fetchedAt: "2026-11-08T00:00:00Z",
  sourceUrl: "https://example.org/source",
  attribution: "Synthetic fixture",
  license: "Test",
  licenseUrl: "https://example.org/license",
  coverage: "Synthetic fixture",
};
const query: InventoryQuery = {
  q: "",
  area: null,
  viewport: [16, 48, 17, 49],
  zoom: 12,
  offset: 0,
  limit: 25,
};
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
const tree: Tree = {
  dataset: "vienna",
  sourceId: "0007",
  idScope: "release",
  position: [16.4, 48.2],
  tag: "0007",
  scientificName: "Acer",
  commonName: "Maple",
  location: "Park",
  height: { kind: "unknown" },
  crown: { kind: "unknown" },
  circumference: { kind: "unknown" },
  plantingYear: null,
  plantingEstimated: false,
  age: null,
  observedAt: null,
  status: "existing",
};
const second: Tree = { ...tree, sourceId: "0008", tag: "0008" };
const summary = (value: Tree) => ({
  dataset: value.dataset,
  sourceId: value.sourceId,
  position: value.position,
  tag: value.tag,
  scientificName: value.scientificName,
  commonName: value.commonName,
  location: value.location,
});
const requestSchema = z.object({
  dataset: z.string(),
  release: z.string(),
  requestKey: z.string(),
  q: z.string().optional(),
  area: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
  viewport: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  zoom: z.number().optional(),
  offset: z.number().optional(),
  limit: z.number().optional(),
  sourceId: z.string().optional(),
});
type RequestBody = z.infer<typeof requestSchema>;
async function envelope(body: RequestBody) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      "tree-atlas-search-release-v1",
      body.dataset,
      body.release,
      normalize(body.q ?? ""),
      body.area ?? null,
      body.viewport ?? [-180, -90, 180, 90],
      body.zoom ?? 0,
      body.offset ?? 0,
      body.limit ?? 100,
    ]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    contractVersion: "1.0.0",
    dataset: body.dataset,
    release: body.release,
    releaseFingerprint: fingerprint,
    requestKey: body.requestKey,
    queryKey: [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(""),
  };
}
async function response(body: RequestBody) {
  return {
    ...(await envelope(body)),
    total: 2,
    locatedTotal: 2,
    viewportLocatedTotal: 2,
    representedLocatedCount: 2,
    spatialReady: true,
    mapAggregated: false,
    items: [summary(tree), summary(second)],
    markers: [
      { kind: "tree", tree: summary(tree) },
      { kind: "tree", tree: summary(second) },
    ],
  };
}
let nextToken = 0;
const cancelled: string[] = [];
const clients: RemoteInventoryClient[] = [];
const server = setupServer(
  http.post(`${base}attempt`, () =>
    HttpResponse.json({ id: `${"a".repeat(32)}-${(++nextToken).toString(16).padStart(16, "0")}` }),
  ),
  http.post(`${base}cancel`, async ({ request }) => {
    const value: unknown = await request.json();
    cancelled.push(z.object({ id: z.string() }).parse(value).id);
    return HttpResponse.json({ cancelled: true });
  }),
  http.post(`${base}v1/query`, async ({ request }) => {
    const body: unknown = await request.json();
    return HttpResponse.json(await response(requestSchema.parse(body)));
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  nextToken = 0;
  cancelled.length = 0;
});
afterEach(() => {
  for (const client of clients) client.dispose();
  clients.length = 0;
  server.resetHandlers();
});
afterAll(() => server.close());
async function open(signal?: AbortSignal) {
  const client = await createRemoteInventorySession(
    { base, dataset, releaseFingerprint: fingerprint, normalizeText: normalize },
    signal,
  );
  clients.push(client);
  return client;
}

describe("local pinned HTTP adapter", () => {
  it("creates a session without fetching a whole inventory or contacting the API", async () => {
    server.use(
      http.post(`${base}attempt`, () => {
        throw new Error("Unexpected bootstrap request");
      }),
    );
    const client = await open();
    expect(client).toBeDefined();
    expect(nextToken).toBe(0);
  });
  it("returns complete validated pages and string cluster handles", async () => {
    server.use(
      http.post(`${base}v1/query`, async ({ request }) => {
        const body: unknown = await request.json();
        const value = await response(requestSchema.parse(body));
        return HttpResponse.json({
          ...value,
          mapAggregated: true,
          markers: [
            {
              kind: "cluster",
              id: "opaque-parent-scope:15:15",
              position: [16.4, 48.2],
              count: 2,
              zoom: 24,
            },
          ],
        });
      }),
    );
    const result = await (await open()).query(query);
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.sourceId)).toEqual(["0007", "0008"]);
    expect(result.markers[0]).toMatchObject({ kind: "cluster", id: "opaque-parent-scope:15:15" });
    expect(result.viewportLocatedTotal).toBe(2);
  });
  it.each(["release", "fingerprint", "caller", "queryKey", "page", "counts", "markers"])(
    "rejects inconsistent %s",
    async (kind) => {
      server.use(
        http.post(`${base}v1/query`, async ({ request }) => {
          const body: unknown = await request.json();
          const value = await response(requestSchema.parse(body));
          const changed =
            kind === "release"
              ? { ...value, release: "other" }
              : kind === "fingerprint"
                ? { ...value, releaseFingerprint: "c".repeat(64) }
                : kind === "caller"
                  ? { ...value, requestKey: "old" }
                  : kind === "queryKey"
                    ? { ...value, queryKey: "0".repeat(64) }
                    : kind === "page"
                      ? { ...value, items: [summary(tree)] }
                      : kind === "counts"
                        ? { ...value, total: 99 }
                        : { ...value, markers: [{ kind: "tree", tree: summary(tree) }] };
          return HttpResponse.json(changed);
        }),
      );
      await expect((await open()).query(query)).rejects.toThrow(
        /local API|map|inventory|Duplicate/iu,
      );
    },
  );
  it("keeps missing pinned releases as errors instead of falling back", async () => {
    server.use(
      http.post(`${base}v1/query`, () =>
        HttpResponse.json({ error: "release_unavailable" }, { status: 404 }),
      ),
    );
    await expect((await open()).query(query)).rejects.toThrow("No newer release was substituted");
  });
  it("rejects invalid input before reserving a request", async () => {
    const client = await open();
    await expect(client.query({ ...query, offset: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow(
      /offset/iu,
    );
    await expect(client.suggest("x".repeat(501))).rejects.toThrow("at most 500");
    expect(nextToken).toBe(0);
  });
  it("cancels superseded requests and rejects late results", async () => {
    const waiting = Promise.withResolvers<void>();
    server.use(
      http.post(`${base}v1/query`, async ({ request }) => {
        const raw: unknown = await request.json();
        const body = requestSchema.parse(raw);
        if (body.q === "first") await waiting.promise;
        return HttpResponse.json(await response(body));
      }),
    );
    const client = await open();
    const first = client.query({ ...query, q: "first" });
    const outcome = first.then(
      (value) => value,
      (error: unknown) => error,
    );
    await expect.poll(() => nextToken).toBe(1);
    const secondRequest = client.query({ ...query, q: "second" });
    await secondRequest;
    await expect(outcome).resolves.toMatchObject({ name: "AbortError" });
    waiting.resolve();
    await expect.poll(() => cancelled.length).toBe(1);
  });
  it("consumes a token whose reservation arrives after disposal", async () => {
    const reservation = Promise.withResolvers<void>();
    let started = false;
    server.use(
      http.post(`${base}attempt`, async () => {
        started = true;
        await reservation.promise;
        return HttpResponse.json({ id: `${"d".repeat(32)}-${"1".padStart(16, "0")}` });
      }),
    );
    const client = await open();
    const pending = client.query(query);
    const outcome = pending.then(
      (value) => value,
      (error: unknown) => error,
    );
    await expect.poll(() => started).toBe(true);
    client.dispose();
    await expect(outcome).resolves.toMatchObject({ name: "AbortError" });
    reservation.resolve();
    await expect.poll(() => cancelled).toEqual([`${"d".repeat(32)}-${"1".padStart(16, "0")}`]);
  });
  it("checks exact detail identities and permits a valid missing detail", async () => {
    server.use(
      http.post(`${base}v1/detail`, async ({ request }) => {
        const raw: unknown = await request.json();
        const body = requestSchema.parse(raw);
        return HttpResponse.json({
          ...(await envelope(body)),
          tree: body.sourceId === "missing" ? null : tree,
        });
      }),
    );
    const client = await open();
    expect(await client.detail("0007")).toEqual(tree);
    expect(await client.detail("missing")).toBeNull();
    await expect(client.detail("other")).rejects.toThrow("does not match this tree");
  });
});

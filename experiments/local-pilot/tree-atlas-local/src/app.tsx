import { LocationPicker } from "./location-picker.tsx";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { loadManifest, normalizeText } from "./catalog.ts";
import { measurementLabel, treeKey } from "./domain.ts";
import { inventoryAt } from "./local-inventory.ts";
import type { Bounds, Dataset, Manifest, Tree } from "./domain.ts";
import type { InventoryClient } from "./inventory-client.ts";
import type { InventoryQuery, Summary } from "./index-format.ts";
import { createRemoteInventorySession } from "./remote-inventory.ts";
import { createOfflineInventorySession } from "./offline-client.ts";
import { offlineStore } from "./offline-store.ts";
import type { OfflinePackStatus, OfflineProgress } from "./offline-store.ts";
import { useView } from "./navigation.ts";
import type { ViewState } from "./navigation.ts";

const TreeMap = lazy(async () => ({ default: (await import("./map.tsx")).TreeMap }));
const dataBase = new URL("data/", document.baseURI).href;
const number = new Intl.NumberFormat("en");
const configSchema = z.object({
  contractVersion: z.literal("1.0.0"),
  fingerprints: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)),
});
type LocalConfig = z.infer<typeof configSchema>;
type Mode = "api" | "offline";
function summaryKey(tree: Summary): string {
  return `${tree.dataset}:${tree.sourceId}`;
}
function datasetKey(dataset: Dataset): string {
  return `${dataset.id}:${dataset.release}:${dataset.sha256}`;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "The operation could not complete.";
}
function Notice({ title, text, retry }: { title: string; text: string; retry?: () => void }) {
  return (
    <div className="notice" aria-live="polite">
      <h2>{title}</h2>
      <p>{text}</p>
      {retry !== undefined && <button onClick={retry}>Try again</button>}
    </div>
  );
}
function useShell() {
  const [status, setStatus] = useState(() =>
    import.meta.env.PROD && "serviceWorker" in navigator
      ? "Preparing the offline app shell…"
      : "Offline refresh requires the local production preview.",
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      if (active) setStatus("The offline app shell is not ready. Reload to retry.");
    }, 15000);
    void navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (active) {
          window.clearTimeout(timeout);
          setReady(true);
          setStatus("App shell ready for offline refresh.");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          window.clearTimeout(timeout);
          setStatus(message(error));
        }
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, []);
  return { ready, status };
}
export function App() {
  const catalogue = useQuery({
    queryKey: ["local-catalogue", dataBase],
    queryFn: async ({ signal }) => {
      const [manifest, response] = await Promise.all([
        loadManifest(dataBase, signal),
        fetch(new URL("local-config.json", dataBase), { signal }),
      ]);
      if (!response.ok) throw new Error("The local API configuration could not load.");
      return { manifest, config: configSchema.parse(await response.json()) };
    },
  });
  const shell = useShell();
  return (
    <>
      <header className="masthead">
        <a className="brand" href="/">
          Tree Atlas
        </a>
        <span className="pilot-badge">LOCAL CARBON PILOT</span>
      </header>
      {catalogue.isPending && (
        <Notice title="Opening the atlas" text="Loading the pinned local catalogue…" />
      )}
      {catalogue.isError && (
        <Notice
          title="The catalogue could not load"
          text={catalogue.error.message}
          retry={() => {
            void catalogue.refetch();
          }}
        />
      )}
      {catalogue.data !== undefined && <Explorer {...catalogue.data} shell={shell} />}
    </>
  );
}
function Explorer({
  manifest,
  config,
  shell,
}: {
  manifest: Manifest;
  config: LocalConfig;
  shell: { ready: boolean; status: string };
}) {
  const [view, navigate] = useView();
  const dataset = manifest.datasets.find((item) => item.id === view.city);
  if (dataset === undefined)
    return (
      <Notice
        title="This inventory is unavailable"
        text="Choose one of the four local pilot cities."
      />
    );
  if (view.release !== null && view.release !== dataset.release)
    return (
      <div>
        <Notice
          title="This saved release is unavailable"
          text="This local pilot serves only its frozen release. No newer records were substituted."
        />
        <button onClick={() => navigate({ ...view, release: dataset.release, tree: null })}>
          Open the frozen pilot release
        </button>
      </div>
    );
  const fingerprint = config.fingerprints[dataset.id];
  if (fingerprint === undefined)
    return (
      <Notice
        title="This inventory is unavailable"
        text="Its frozen content fingerprint is missing."
      />
    );
  return (
    <CityExplorer
      key={datasetKey(dataset)}
      manifest={manifest}
      dataset={dataset}
      fingerprint={fingerprint}
      view={view}
      navigate={navigate}
      shell={shell}
    />
  );
}
type SessionState = { key: string; client: InventoryClient | null; error: string | null };
function useInventory(dataset: Dataset, mode: Mode, fingerprint: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${datasetKey(dataset)}:${mode}:${attempt}`;
  const [state, setState] = useState<SessionState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let client: InventoryClient | null = null;
    const work =
      mode === "offline"
        ? createOfflineInventorySession(dataBase, dataset, controller.signal)
        : createRemoteInventorySession(
            {
              base: new URL("/api/", location.origin).href,
              dataset,
              releaseFingerprint: fingerprint,
              normalizeText,
            },
            controller.signal,
          );
    void work
      .then((created) => {
        if (!active) {
          created.dispose();
          return;
        }
        client = created;
        setState({ key, client: created, error: null });
      })
      .catch((error: unknown) => {
        if (active) setState({ key, client: null, error: message(error) });
      });
    return () => {
      active = false;
      controller.abort();
      client?.dispose();
    };
  }, [dataset, key, mode, fingerprint]);
  return {
    key,
    client: state?.key === key ? state.client : null,
    error: state?.key === key ? state.error : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
type ClusterSelection = { id: string | number; request: InventoryQuery; offset: number };
function CityExplorer({
  manifest,
  dataset,
  fingerprint,
  view,
  navigate,
  shell,
}: {
  manifest: Manifest;
  dataset: Dataset;
  fingerprint: string;
  view: ViewState;
  navigate: (view: ViewState) => void;
  shell: { ready: boolean; status: string };
}) {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem("tree-atlas-local-mode") === "offline" ? "offline" : "api";
    } catch {
      return "api";
    }
  });
  const session = useInventory(dataset, mode, fingerprint);
  const [paging, setPaging] = useState({ key: "", offset: 0 });
  const scopeKey = `${session.key}:${view.q}:${view.area?.join(",") ?? ""}`;
  const offset = paging.key === scopeKey ? paging.offset : 0;
  const [camera, setCamera] = useState<{ bounds: Bounds; zoom: number } | null>(null);
  const viewport = camera?.bounds ?? dataset.viewBounds ?? dataset.bounds;
  const zoom = camera?.zoom ?? 11;
  const request: InventoryQuery = { q: view.q, area: view.area, viewport, zoom, offset, limit: 30 };
  const findings = useQuery({
    queryKey: ["local-query", session.key, view.q, view.area, viewport, zoom, offset],
    queryFn: async () => {
      if (session.client === null) throw new Error("The inventory is not ready.");
      return { ...(await session.client.query(request)), offset };
    },
    enabled: session.client !== null && camera !== null,
    gcTime: 0,
  });
  const selectedId =
    view.tree?.startsWith(`${dataset.id}:`) === true
      ? view.tree.slice(dataset.id.length + 1)
      : null;
  const detail = useQuery({
    queryKey: ["local-detail", session.key, selectedId],
    queryFn: () => {
      if (session.client === null || selectedId === null)
        throw new Error("The inventory is not ready.");
      return session.client.detail(selectedId);
    },
    enabled: session.client !== null && selectedId !== null,
    gcTime: 0,
  });
  const [cluster, setCluster] = useState<ClusterSelection | null>(null);
  const clusterHeading = useRef<HTMLHeadingElement>(null);
  const clusterTrigger = useRef<HTMLElement>(null);
  const clusterId = cluster?.id;
  useEffect(() => {
    if (clusterId !== undefined) clusterHeading.current?.focus();
  }, [clusterId]);
  const clusterKey = JSON.stringify([scopeKey, viewport, zoom]);
  const [clusterScope, setClusterScope] = useState(clusterKey);
  if (clusterScope !== clusterKey) {
    setClusterScope(clusterKey);
    if (cluster !== null) setCluster(null);
  }
  const members = useQuery({
    queryKey: ["local-cluster", session.key, cluster],
    queryFn: async () => {
      if (
        session.client === null ||
        cluster === null ||
        !("clusterMembers" in session.client) ||
        typeof session.client.clusterMembers !== "function"
      )
        throw new Error("Cluster members are unavailable.");
      return session.client.clusterMembers(
        { ...cluster.request, offset: cluster.offset, limit: 30 },
        cluster.id,
      );
    },
    enabled: session.client !== null && cluster !== null,
    gcTime: 0,
  });
  const [packRevision, setPackRevision] = useState(0);
  const pack = useQuery({
    queryKey: ["offline-pack", datasetKey(dataset), packRevision],
    queryFn: () => offlineStore.getStatus(dataset),
    gcTime: 0,
  });
  const [progress, setProgress] = useState<OfflineProgress | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const downloading = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      downloading.current?.abort();
    },
    [],
  );
  const [saved, setSaved] = useState<{ key: string; text: string } | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  function update(changes: Partial<ViewState>) {
    navigate({ ...view, release: dataset.release, ...changes });
  }
  function changeCity(next: Dataset) {
    navigate({
      city: next.id,
      release: next.release,
      q: "",
      area: null,
      tree: null,
      canopy: false,
    });
  }
  function changeMode(next: Mode) {
    try {
      localStorage.setItem("tree-atlas-local-mode", next);
    } catch {
      /* This session still works without persistence. */
    }
    setMode(next);
    setCluster(null);
  }
  async function install() {
    const controller = new AbortController();
    downloading.current = controller;
    setPackError(null);
    setProgress({ stage: "downloading", bytes: 0, total: offlineStore.plan(dataset).bytes });
    try {
      await offlineStore.install(dataset, controller.signal, setProgress, dataBase);
      setPackRevision((value) => value + 1);
    } catch (error) {
      if (!controller.signal.aborted) setPackError(message(error));
    } finally {
      if (downloading.current === controller) {
        downloading.current = null;
        setProgress(null);
      }
    }
  }
  async function saveDetails(tree: Tree) {
    const key = treeKey(tree);
    try {
      await offlineStore.saveDetail(dataset, tree);
      setSaved({ key, text: "Details saved for offline use." });
    } catch (error) {
      setSaved({ key, text: message(error) });
    }
  }
  function locate() {
    if (!("geolocation" in navigator)) {
      setLocationMessage("Location access is unavailable.");
      return;
    }
    setLocationMessage("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position: [number, number] = [coords.longitude, coords.latitude];
        const place = inventoryAt(manifest.datasets, position);
        if (place === undefined) {
          setLocationMessage("Your location is outside the pilot inventory extents.");
          return;
        }
        const span = 0.0045;
        const width = span / Math.cos((coords.latitude * Math.PI) / 180);
        navigate({
          city: place.id,
          release: place.release,
          q: "",
          area: [
            coords.longitude - width,
            coords.latitude - span,
            coords.longitude + width,
            coords.latitude + span,
          ],
          tree: null,
          canopy: false,
        });
        setLocationMessage("Showing published records around your location.");
      },
      () => setLocationMessage("Location was unavailable."),
      { timeout: 10000, maximumAge: 60000 },
    );
  }
  const packStatus: OfflinePackStatus | undefined = pack.data;
  return (
    <main className="atlas">
      <aside className="sidebar" aria-label="Search and tree records">
        <div className="intro">
          <p className="eyebrow">LOCAL RESEARCH PILOT</p>
          <h1>
            Every city has
            <br />
            <em>its own canopy.</em>
          </h1>
          <p className="lede">
            Search complete, pinned inventories through the local Carbon service, or download a city
            for offline use.
          </p>
        </div>
        <LocationPicker datasets={manifest.datasets} selected={dataset.id} onChange={changeCity} />
        <section className="coverage-note" aria-label="Inventory connection">
          <h2>{mode === "api" ? "Local API" : "Downloaded city"}</h2>
          <p>No automatic switch between online data and saved data.</p>
          <button disabled={mode === "api"} onClick={() => changeMode("api")}>
            Use local API
          </button>{" "}
          <button
            disabled={mode === "offline" || packStatus?.state !== "ready"}
            onClick={() => changeMode("offline")}
          >
            Use downloaded city
          </button>
          <p className="small">{shell.status}</p>
          {packStatus?.state === "ready" && shell.ready ? (
            <output>
              Offline pack ready · {number.format(packStatus.bytes)} bytes · complete search and map
              positions. Save individual details separately. Street-map and canopy tiles need a
              connection.
            </output>
          ) : (
            <p className="small">
              {packStatus?.state === "ready"
                ? "City pack verified. Waiting for the offline app shell."
                : (packStatus?.message ?? "Checking downloaded city…")}
            </p>
          )}
          <p className="small">
            Complete city download: {number.format(offlineStore.plan(dataset).bytes)} bytes. Details
            are saved separately.
          </p>
          <button
            disabled={!shell.ready || progress !== null}
            onClick={() => {
              void install();
            }}
          >
            Download city for offline use
          </button>
          {progress !== null && (
            <>
              <output>
                {progress.stage}: {number.format(progress.bytes)} / {number.format(progress.total)}{" "}
                bytes
              </output>
              <button onClick={() => downloading.current?.abort()}>Cancel download</button>
            </>
          )}
          {packError !== null && <p role="alert">{packError}</p>}
        </section>
        <div className="search-section">
          <SearchBox
            key={`${session.key}:${view.q}`}
            initial={view.q}
            client={session.client}
            datasets={manifest.datasets}
            onSearch={(q) => update({ q, tree: null })}
            onCity={changeCity}
          />
          <button className="location-button" onClick={locate}>
            ⌖ Near me
          </button>
          {locationMessage !== "" && <output>{locationMessage}</output>}
        </div>
        <div className="coverage-note">
          <span className="eyebrow">{dataset.city} · FROZEN INVENTORY</span>
          <p>{dataset.coverage}</p>
          <p className="small">
            All {number.format(dataset.count)} records remain searchable. Records without
            coordinates appear in the list only. Published extent does not imply complete tree
            coverage.
          </p>
        </div>
        <div className="layer-control">
          <label>
            <input
              type="checkbox"
              checked={view.canopy}
              disabled={mode === "offline"}
              onChange={(event) => update({ canopy: event.target.checked })}
            />
            <span>
              Show canopy <small>Copernicus · reference year 2021 · online only</small>
            </span>
          </label>
        </div>
        {session.error !== null && (
          <Notice title="Records could not load" text={session.error} retry={session.retry} />
        )}
        {findings.isError && (
          <Notice
            title="The search could not complete"
            text={findings.error.message}
            retry={() => {
              void findings.refetch();
            }}
          />
        )}
        {selectedId !== null && detail.isPending && session.client !== null && (
          <p className="loading">Loading selected tree details…</p>
        )}
        {selectedId !== null && detail.isError && (
          <Notice
            title="Details could not load"
            text={detail.error.message}
            retry={() => {
              void detail.refetch();
            }}
          />
        )}
        {selectedId !== null && detail.isSuccess && detail.data === null && (
          <Notice
            title="Record not found in this release"
            text="This identifier does not belong to the pinned inventory."
          />
        )}
        {selectedId !== null && detail.data != null && (
          <>
            <TreeDetails
              tree={detail.data}
              dataset={dataset}
              close={() => update({ tree: null })}
            />
            <button
              onClick={() => {
                if (detail.data != null) void saveDetails(detail.data);
              }}
            >
              Save details for offline use
            </button>
            {saved?.key === treeKey(detail.data) && <output>{saved.text}</output>}
          </>
        )}
        {cluster !== null && (
          <section aria-label="Cluster records" className="tree-detail">
            <button
              onClick={() => {
                setCluster(null);
                clusterTrigger.current?.focus();
              }}
            >
              Close cluster records
            </button>
            <h2 ref={clusterHeading} tabIndex={-1}>
              {members.data === undefined
                ? "Loading cluster records…"
                : `${number.format(members.data.total)} records in this cluster`}
            </h2>
            {members.isError && (
              <Notice title="Cluster records could not load" text={members.error.message} />
            )}{" "}
            {members.data !== undefined && (
              <TreeList
                label="Cluster members"
                trees={members.data.items}
                total={members.data.total}
                offset={cluster.offset}
                selected={view.tree}
                onSelect={(tree) => update({ tree: summaryKey(tree) })}
                onPage={(next) => setCluster({ ...cluster, offset: next })}
              />
            )}
          </section>
        )}
        <div className="results-heading">
          <h2>
            {findings.data === undefined
              ? "Searching…"
              : `${number.format(findings.data.total)} records`}
          </h2>
          {(view.q !== "" || view.area !== null) && (
            <button
              className="text-button"
              onClick={() => update({ q: "", area: null, tree: null })}
            >
              Clear filters
            </button>
          )}
        </div>
        <p className="small result-scope">
          {view.area === null ? "Across this pinned inventory" : "Inside your selected map area"}
          {view.q !== "" ? ` · “${view.q}”` : ""}
        </p>
        {findings.data !== undefined && (
          <>
            <p className="small">
              {number.format(findings.data.locatedTotal ?? 0)} matching records with coordinates ·{" "}
              {number.format(findings.data.viewportLocatedTotal ?? 0)} in the current map view.
            </p>
            <TreeList
              trees={findings.data.items}
              total={findings.data.total}
              offset={findings.data.offset}
              selected={view.tree}
              onPage={(next) => setPaging({ key: scopeKey, offset: next })}
              onSelect={(tree) => update({ tree: summaryKey(tree) })}
            />
          </>
        )}
        <footer className="source-footer">
          <p>
            <a href={dataset.sourceUrl}>{dataset.attribution} ↗</a> ·{" "}
            <a href={dataset.licenseUrl}>{dataset.license}</a>
          </p>
          <p>
            Release <code>{dataset.release}</code>. Retrieved{" "}
            {new Date(dataset.fetchedAt).toLocaleDateString("en-GB")}. Missing measurements stay
            unknown.
          </p>
          <p>
            Online map tiles: OpenStreetMap. Online canopy layer: Copernicus. Inventory downloads
            and API calls stay on the local pilot server.
          </p>
        </footer>
      </aside>
      <Suspense fallback={<div className="map-panel loading">Opening the map…</div>}>
        <TreeMap
          dataset={dataset}
          markers={findings.data?.markers ?? []}
          aggregated={findings.data?.mapAggregated ?? false}
          preview={false}
          loading={session.error === null && !findings.isError && findings.data === undefined}
          updating={findings.isFetching}
          selectedTree={view.tree !== null ? (detail.data ?? null) : null}
          canopy={mode === "api" && view.canopy}
          area={view.area}
          onSelect={(tree) => update({ tree: summaryKey(tree) })}
          onArea={(area) => update({ area, tree: null })}
          onCluster={(item, trigger) => {
            clusterTrigger.current = trigger;
            setCluster({ id: item.id, request, offset: 0 });
          }}
          onViewport={(bounds, nextZoom) => setCamera({ bounds, zoom: nextZoom })}
        />
      </Suspense>
    </main>
  );
}

type SearchProps = {
  initial: string;
  client: InventoryClient | null;
  datasets: readonly Dataset[];
  onSearch: (q: string) => void;
  onCity: (dataset: Dataset) => void;
};
function SearchBox({ initial, client, datasets, onSearch, onCity }: SearchProps) {
  const [draft, setDraft] = useState(initial);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ term: string; values: string[] } | null>(null);
  const term = normalizeText(draft);
  useEffect(() => {
    if (client === null || term.length < 2) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      void client
        .suggest(term)
        .then((values) => {
          if (active) setSuggestions({ term, values });
        })
        .catch(() => {
          if (active) setSuggestions({ term, values: [] });
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [client, term]);
  const values = suggestions?.term === term ? suggestions.values : [];
  const cities =
    term.length >= 2
      ? datasets.filter((item) => normalizeText(`${item.city} ${item.country}`).includes(term))
      : [];
  return (
    <form
      className="search-form"
      onSubmit={(event) => {
        event.preventDefault();
        setOpen(false);
        onSearch(draft.trim());
      }}
    >
      <label htmlFor="tree-search">Find a tree or place</label>
      <div className="search-row">
        <input
          id="tree-search"
          name="q"
          type="search"
          maxLength={500}
          autoComplete="off"
          value={draft}
          placeholder="Species, street, tag or city…"
          aria-describedby="search-help"
          aria-controls={open ? "search-suggestions" : undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              document.querySelector<HTMLButtonElement>("#search-suggestions button")?.focus();
            }
          }}
        />
        <button type="submit" aria-label="Search">
          ↗
        </button>
      </div>
      {open && term.length >= 2 && (
        <div id="search-suggestions" className="suggestions" aria-label="Search suggestions">
          {cities.map((city) => (
            <button
              type="button"
              key={city.id}
              onClick={() => {
                setOpen(false);
                onCity(city);
              }}
            >
              {city.city}
              <small>Inventory · {city.country}</small>
            </button>
          ))}
          {values.map((text) => (
            <button
              type="button"
              key={text}
              onClick={() => {
                setOpen(false);
                onSearch(text);
              }}
            >
              {text}
              <small>Recorded name or tag</small>
            </button>
          ))}
          <button type="submit">
            Search for “{draft}”<small>In the selected inventory</small>
          </button>
        </div>
      )}
      <p id="search-help" className="small">
        Search recorded species, street labels or tree tags. Full address and landmark search is not
        included.
      </p>
    </form>
  );
}

function TreeList({
  trees,
  label = "Tree records",
  total,
  offset,
  selected,
  onSelect,
  onPage,
}: {
  trees: readonly Summary[];
  label?: string;
  total: number;
  offset: number;
  selected: string | null;
  onSelect: (tree: Summary) => void;
  onPage: (offset: number) => void;
}) {
  if (total === 0)
    return (
      <p className="empty">
        No matching source records. Try another term or clear the filters. This does not mean there
        are no trees here.
      </p>
    );
  return (
    <>
      <ul className="tree-list" aria-label={label}>
        {trees.map((tree) => (
          <li key={summaryKey(tree)}>
            <button
              id={`${label === "Tree records" ? "record" : "cluster-record"}-${summaryKey(tree)}`}
              aria-pressed={selected === summaryKey(tree)}
              onClick={() => onSelect(tree)}
            >
              <span className="list-leaf" aria-hidden="true">
                ⌁
              </span>
              <span>
                <strong>{tree.commonName ?? tree.scientificName ?? "Unidentified tree"}</strong>
                <small>
                  {tree.scientificName !== tree.commonName ? tree.scientificName : tree.location}
                </small>
                <small>
                  {tree.location ?? `Source record ${tree.sourceId}`}
                  {tree.tag !== null ? ` · Tag ${tree.tag}` : ""}
                </small>
              </span>
              <span aria-hidden="true">↗</span>
            </button>
          </li>
        ))}
      </ul>
      <nav className="pagination" aria-label="Results pages">
        <button disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - 30))}>
          Previous
        </button>
        <span>
          {number.format(offset + 1)}–{number.format(Math.min(offset + trees.length, total))} of{" "}
          {number.format(total)}
        </span>
        <button disabled={offset + trees.length >= total} onClick={() => onPage(offset + 30)}>
          Next
        </button>
      </nav>
    </>
  );
}

function TreeDetails({
  tree,
  dataset,
  close,
}: {
  tree: Tree;
  dataset: Dataset;
  close: () => void;
}) {
  const selection = treeKey(tree);
  useEffect(() => {
    const heading = document.getElementById(`detail-${selection}`);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [selection]);
  function closeDetails() {
    document.getElementById(`record-${selection}`)?.focus({ preventScroll: true });
    close();
  }
  return (
    <section className="tree-detail" aria-label="Selected tree details">
      <div className="detail-heading">
        <span className="eyebrow">INVENTORY RECORD</span>
        <button onClick={closeDetails} aria-label="Close tree details">
          ×
        </button>
      </div>
      <h2 id={`detail-${selection}`} tabIndex={-1}>
        {tree.commonName ?? tree.scientificName ?? "Unidentified tree"}
      </h2>
      {tree.qualityNotes !== undefined && tree.qualityNotes.length > 0 && (
        <div className="source-quality">
          <strong>Source quality note</strong>
          <ul>
            {tree.qualityNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {tree.scientificName !== null && <p className="latin">{tree.scientificName}</p>}
      <dl>
        <div>
          <dt>Height</dt>
          <dd>{measurementLabel(tree.height)}</dd>
        </div>
        <div>
          <dt>Crown diameter</dt>
          <dd>{measurementLabel(tree.crown)}</dd>
        </div>
        <div>
          <dt>Trunk circumference</dt>
          <dd>{measurementLabel(tree.circumference)}</dd>
        </div>
        <div>
          <dt>Planted</dt>
          <dd>
            {tree.plantingYear ?? "Not recorded"}
            {tree.plantingEstimated ? " (estimated)" : ""}
          </dd>
        </div>
        <div>
          <dt>Age</dt>
          <dd>{tree.age ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Observation</dt>
          <dd>{tree.observedAt ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{tree.status === "unknown" ? "Not recorded" : tree.status}</dd>
        </div>
        <div>
          <dt>Tag</dt>
          <dd>{tree.tag ?? "Not recorded"}</dd>
        </div>
      </dl>
      <p className="small">
        {tree.location ?? dataset.city} ·{" "}
        {tree.position === null
          ? "Location not recorded"
          : `${tree.position[1].toFixed(5)}, ${tree.position[0].toFixed(5)}`}
      </p>
      <p className="small">
        Source ID {tree.sourceId} ·{" "}
        {tree.idScope === "stable"
          ? "Provider-stable identifier"
          : "Identifier scoped to this release"}
        . This link retains the source release.
      </p>
    </section>
  );
}

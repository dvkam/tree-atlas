import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadDataset, loadManifest, normalizeText } from "./catalog.ts";
import { contains, measurementLabel, treeKey } from "./domain.ts";
import type { Bounds, Dataset, Manifest, Tree } from "./domain.ts";
import { createInventorySession } from "./inventory-client.ts";
import type { InventoryClient } from "./inventory-client.ts";
import type { InventoryQuery, Summary } from "./index-format.ts";
import { useView } from "./navigation.ts";
import type { ViewState } from "./navigation.ts";

const TreeMap = lazy(async () => ({ default: (await import("./map.tsx")).TreeMap }));
const dataBase = new URL("data/", document.baseURI).href;
const number = new Intl.NumberFormat("en");
function summaryKey(tree: Summary): string {
  return `${tree.dataset}:${tree.sourceId}`;
}
function datasetKey(dataset: Dataset): string {
  return `${dataset.id}:${dataset.release}:${dataset.sha256}`;
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

export function App() {
  const manifest = useQuery({
    queryKey: ["manifest", dataBase],
    queryFn: ({ signal }) => loadManifest(dataBase, signal),
  });
  return (
    <>
      <header className="masthead">
        <a className="brand" href={window.location.pathname}>
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Tree Atlas
        </a>
        <span className="pilot-badge">PUBLIC TREE INVENTORIES</span>
        <a href="https://github.com/dvkam/tree-atlas" className="about-link">
          About this project ↗
        </a>
      </header>
      {manifest.isPending && (
        <Notice title="Opening the atlas" text="Loading the published catalogue…" />
      )}
      {manifest.isError && (
        <Notice
          title="The catalogue could not load"
          text={manifest.error.message}
          retry={() => {
            void manifest.refetch();
          }}
        />
      )}
      {manifest.data !== undefined && <Explorer manifest={manifest.data} />}
    </>
  );
}

function Explorer({ manifest }: { manifest: Manifest }) {
  const [view, navigate] = useView();
  const current = manifest.datasets.find((item) => item.id === view.city);
  const archived = view.release !== null && view.release !== current?.release;
  const archive = useQuery({
    queryKey: ["dataset-release", view.city, view.release],
    queryFn: ({ signal }) => {
      if (view.release === null) throw new Error("No release was selected.");
      return loadDataset(dataBase, view.city, view.release, signal);
    },
    enabled: archived,
  });
  if (current === undefined)
    return (
      <Notice
        title="This inventory is unavailable"
        text="Choose another location from the atlas home page."
      />
    );
  if (archived && archive.isPending)
    return (
      <Notice
        title="Opening the saved release"
        text="Loading the snapshot retained by this link…"
      />
    );
  if (archived && archive.isError)
    return (
      <div className="notice" aria-live="polite">
        <h2>This saved release is unavailable</h2>
        <p>{archive.error.message} We have not substituted newer records.</p>
        <button onClick={() => navigate({ ...view, release: current.release, tree: null })}>
          Open the current release
        </button>
      </div>
    );
  const dataset = archived && archive.data !== undefined ? archive.data : current;
  return (
    <CityExplorer
      manifest={manifest}
      dataset={dataset}
      current={current}
      view={view}
      navigate={navigate}
    />
  );
}

type SessionState = { key: string; client: InventoryClient | null; error: string | null };
function useInventory(dataset: Dataset) {
  const [attempt, setAttempt] = useState(0);
  const key = `${datasetKey(dataset)}:${attempt}`;
  const [state, setState] = useState<SessionState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let client: InventoryClient | null = null;
    void createInventorySession(dataBase, dataset, controller.signal)
      .then((created) => {
        if (!active) {
          created.dispose();
          return;
        }
        client = created;
        setState({ key, client: created, error: null });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            key,
            client: null,
            error: error instanceof Error ? error.message : "The inventory could not load.",
          });
      });
    return () => {
      active = false;
      controller.abort();
      client?.dispose();
    };
  }, [dataset, key]);
  const current = state?.key === key ? state : null;
  return {
    key,
    client: current?.client ?? null,
    error: current?.error ?? null,
    retry: () => setAttempt((value) => value + 1),
  };
}

type ExplorerProps = {
  manifest: Manifest;
  dataset: Dataset;
  current: Dataset;
  view: ViewState;
  navigate: (view: ViewState) => void;
};
function CityExplorer({ manifest, dataset, current, view, navigate }: ExplorerProps) {
  const session = useInventory(dataset);
  const scopeKey = `${datasetKey(dataset)}:${view.q}:${view.area?.join(",") ?? ""}`;
  const [paging, setPaging] = useState({ key: scopeKey, offset: 0 });
  const offset = paging.key === scopeKey ? paging.offset : 0;
  const [camera, setCamera] = useState<{ key: string; bounds: Bounds; zoom: number } | null>(null);
  const viewport =
    camera?.key === datasetKey(dataset) ? camera.bounds : (dataset.viewBounds ?? dataset.bounds);
  const zoom = camera?.key === datasetKey(dataset) ? camera.zoom : 11;
  const request: InventoryQuery = { q: view.q, area: view.area, viewport, zoom, offset, limit: 30 };
  const findings = useQuery({
    queryKey: ["inventory-query", session.key, scopeKey, offset, viewport, zoom],
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === session.key && previousQuery.queryKey[2] === scopeKey
        ? previous
        : undefined,
    queryFn: async () => {
      if (session.client === null) throw new Error("The inventory is not ready.");
      return { ...(await session.client.query(request)), offset };
    },
    enabled: session.client !== null,
    gcTime: 60_000,
  });
  const selectedId =
    view.tree?.startsWith(`${dataset.id}:`) === true
      ? view.tree.slice(dataset.id.length + 1)
      : null;
  const detail = useQuery({
    queryKey: ["inventory-detail", session.key, view.tree],
    queryFn: () => {
      if (session.client === null || selectedId === null) return null;
      return session.client.detail(selectedId);
    },
    enabled: session.client !== null && view.tree !== null,
  });
  const [locationMessage, setLocationMessage] = useState("");
  const outsideCoverage =
    view.area !== null &&
    (view.area[2] < dataset.bounds[0] ||
      view.area[0] > dataset.bounds[2] ||
      view.area[3] < dataset.bounds[1] ||
      view.area[1] > dataset.bounds[3]);
  const archived = dataset.release !== current.release;
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
      canopy: view.canopy,
    });
  }
  function locate() {
    if (!("geolocation" in navigator)) {
      setLocationMessage("Your browser does not provide location access.");
      return;
    }
    setLocationMessage("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position: [number, number] = [coords.longitude, coords.latitude];
        const place = manifest.datasets.find((item) => contains(item.bounds, position));
        if (place === undefined) {
          setLocationMessage(
            "You are outside the available inventory extents. Choose a location to explore its records.",
          );
          return;
        }
        const latSpan = 0.0045;
        const lonSpan = latSpan / Math.cos((coords.latitude * Math.PI) / 180);
        navigate({
          city: place.id,
          release: place.release,
          q: "",
          area: [
            coords.longitude - lonSpan,
            coords.latitude - latSpan,
            coords.longitude + lonSpan,
            coords.latitude + latSpan,
          ],
          tree: null,
          canopy: view.canopy,
        });
        setLocationMessage(
          "Showing published records around your location. An absent record does not mean there is no tree.",
        );
      },
      () =>
        setLocationMessage(
          "Location was unavailable. You can explore the atlas without sharing it.",
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  return (
    <main className="atlas">
      <aside className="sidebar" aria-label="Search and tree records">
        <div className="intro">
          <p className="eyebrow">A CLOSER LOOK AT CITY TREES</p>
          <h1>
            Every city has
            <br />
            <em>its own canopy.</em>
          </h1>
          <p className="lede">
            Explore public tree inventories across Europe. Choose a location, then zoom in to see
            individual records.
          </p>
        </div>
        <nav className="cities" aria-label="Inventory locations">
          {manifest.datasets.map((place) => (
            <button
              key={place.id}
              aria-pressed={place.id === dataset.id}
              onClick={() => changeCity(place)}
            >
              {place.city}
              <span>{place.country}</span>
            </button>
          ))}
        </nav>
        {archived && (
          <div className="archive-note">
            <strong>You are viewing a saved release</strong>
            <p>
              This link retains its original coverage and records. A newer full inventory is
              available.
            </p>
            <button onClick={() => changeCity(current)}>Open full inventory</button>
          </div>
        )}
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
            <span aria-hidden="true">⌖</span> Near me
          </button>
          {locationMessage !== "" && (
            <p className="small status" aria-live="polite">
              {locationMessage}
            </p>
          )}
        </div>
        <div className="coverage-note">
          <span className="eyebrow">
            {dataset.city} · {archived ? "SAVED RELEASE" : "PUBLIC INVENTORY"}
          </span>
          <p>{dataset.coverage}</p>
          {dataset.locatedCount !== undefined && dataset.locatedCount < dataset.count && (
            <p className="small">
              {number.format(dataset.count - dataset.locatedCount)} records have no recorded
              position. They remain searchable in the list.
            </p>
          )}
          <p className="small">
            The dashed extent encloses published records. It is not a guarantee that every tree
            inside it is recorded.
          </p>
        </div>
        <div className="layer-control">
          <label>
            <input
              type="checkbox"
              checked={view.canopy}
              onChange={(event) => update({ canopy: event.target.checked })}
            />
            <span>
              Show canopy <small>Copernicus · reference year 2021</small>
            </span>
          </label>
          {view.canopy && (
            <p className="small">
              A live image layer of tree-covered patches and rows. It has no species or
              individual-tree details and is not pinned to the inventory release.
            </p>
          )}
        </div>
        {session.error !== null && (
          <Notice title="Records could not load" text={session.error} retry={session.retry} />
        )}
        {session.client === null && session.error === null && (
          <p className="loading" aria-live="polite">
            Opening {dataset.city} · {number.format(dataset.count)} records. You can choose another
            location or move the map while they load.
          </p>
        )}
        {session.client !== null && (
          <>
            {view.tree !== null && detail.isPending && (
              <p className="loading" aria-live="polite">
                Loading selected tree details…
              </p>
            )}
            {view.tree !== null && detail.isError && (
              <Notice
                title="Details could not load"
                text={detail.error.message}
                retry={() => {
                  void detail.refetch();
                }}
              />
            )}
            {view.tree !== null && detail.isSuccess && detail.data === null && (
              <Notice
                title="Record not found in this release"
                text="The selected identifier does not belong to this published snapshot."
              />
            )}
            {view.tree !== null && detail.data !== undefined && detail.data !== null && (
              <TreeDetails
                tree={detail.data}
                dataset={dataset}
                close={() => update({ tree: null })}
              />
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
              {view.area === null
                ? "Across this published inventory"
                : "Inside your selected map area"}
              {view.q !== "" ? ` · “${view.q}”` : ""}
            </p>
            {outsideCoverage ? (
              <Notice
                title="Outside this inventory’s extent"
                text="The selected area lies beyond the published records. Clear filters to return to the available inventory."
              />
            ) : (
              findings.data !== undefined && (
                <TreeList
                  trees={findings.data.items}
                  total={findings.data.total}
                  offset={findings.data.offset}
                  selected={view.tree}
                  onPage={(next) => setPaging({ key: scopeKey, offset: next })}
                  onSelect={(tree) => update({ tree: summaryKey(tree) })}
                />
              )
            )}
          </>
        )}
        <footer className="source-footer">
          <p>
            <a href={dataset.sourceUrl}>{dataset.attribution} ↗</a> ·{" "}
            <a href={dataset.licenseUrl}>{dataset.license}</a>
          </p>
          <p>
            Retrieved {new Date(dataset.fetchedAt).toLocaleDateString("en-GB")}. These are source
            records, not a census of every tree.
          </p>
          <details>
            <summary>Release and source notes</summary>
            <p>
              Release <code>{dataset.release}</code>. {number.format(dataset.count)} validated
              records. Missing measurements stay unknown. Source records may describe different
              survey dates.
            </p>
            <p>
              Map tiles: OpenStreetMap. Canopy: Copernicus Land Monitoring Service. Opening these
              layers sends map-area requests to their providers.
            </p>
          </details>
        </footer>
      </aside>
      <Suspense
        fallback={
          <div className="map-panel loading" aria-live="polite">
            Opening the map…
          </div>
        }
      >
        <TreeMap
          dataset={dataset}
          markers={findings.data?.markers ?? []}
          aggregated={findings.data?.mapAggregated ?? false}
          loading={session.error === null && (session.client === null || findings.isPending)}
          updating={session.client !== null && findings.isFetching}
          selectedTree={view.tree !== null ? (detail.data ?? null) : null}
          canopy={view.canopy}
          area={view.area}
          onSelect={(tree) => update({ tree: summaryKey(tree) })}
          onArea={(area) => update({ area, tree: null })}
          onViewport={(bounds, nextZoom) =>
            setCamera({ key: datasetKey(dataset), bounds, zoom: nextZoom })
          }
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
  total,
  offset,
  selected,
  onSelect,
  onPage,
}: {
  trees: readonly Summary[];
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
      <ul className="tree-list" aria-label="Tree records">
        {trees.map((tree) => (
          <li key={summaryKey(tree)}>
            <button
              id={`record-${summaryKey(tree)}`}
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

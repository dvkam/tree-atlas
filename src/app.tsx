import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  loadDataset,
  loadManifest,
  loadRelease,
  normalizeText,
  searchInventory,
} from "./catalog.ts";
import { contains, measurementLabel, treeKey } from "./domain.ts";
import type { Dataset, Manifest, Release, Tree } from "./domain.ts";
import { useView } from "./navigation.ts";
import type { ViewState } from "./navigation.ts";
const TreeMap = lazy(async () => {
  const module = await import("./map.tsx");
  return { default: module.TreeMap };
});

const dataBase = new URL("data/", document.baseURI).href;
const number = new Intl.NumberFormat("en");

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
        <span className="pilot-badge">PILOT · THREE STUDY AREAS</span>
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
  const dataset = manifest.datasets.find((item) => item.id === view.city);
  const archived = view.release !== null && view.release !== dataset?.release;
  const archive = useQuery({
    queryKey: ["dataset-release", view.city, view.release],
    queryFn: ({ signal }) => {
      if (view.release === null) throw new Error("No release was selected.");
      return loadDataset(dataBase, view.city, view.release, signal);
    },
    enabled: archived,
  });
  if (dataset === undefined)
    return (
      <Notice
        title="This study area is unavailable"
        text="Choose another city from the atlas home page."
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
        <button onClick={() => navigate({ ...view, release: dataset.release, tree: null })}>
          Open the current release
        </button>
      </div>
    );
  if (archived && archive.data !== undefined)
    return (
      <CityExplorer manifest={manifest} dataset={archive.data} view={view} navigate={navigate} />
    );
  return <CityExplorer manifest={manifest} dataset={dataset} view={view} navigate={navigate} />;
}

type ExplorerProps = {
  manifest: Manifest;
  dataset: Dataset;
  view: ViewState;
  navigate: (view: ViewState) => void;
};

function CityExplorer({ manifest, dataset, view, navigate }: ExplorerProps) {
  const expired = view.release !== null && view.release !== dataset.release;
  const release = useQuery({
    queryKey: ["inventory", dataset.id, dataset.release, dataset.sha256],
    queryFn: ({ signal }) => loadRelease(dataBase, dataset, signal),
    enabled: !expired,
  });
  const [locationMessage, setLocationMessage] = useState("");
  const trees = release.data === undefined ? [] : searchInventory(release.data, view.area, view.q);
  const selected = release.data?.trees.find((tree) => treeKey(tree) === view.tree);
  const outsideCoverage =
    view.area !== null &&
    (view.area[2] < dataset.bounds[0] ||
      view.area[0] > dataset.bounds[2] ||
      view.area[3] < dataset.bounds[1] ||
      view.area[1] > dataset.bounds[3]);

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
            "You are outside the three pilot study areas. Choose a city to explore the available records.",
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
          "Showing published records around your location. Coverage stops at the dashed boundary.",
        );
      },
      () => {
        setLocationMessage(
          "Location was unavailable. You can explore any pilot area without sharing it.",
        );
      },
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
            Explore recorded trees in three small study areas. Compare what their sources can tell
            us.
          </p>
        </div>
        <nav className="cities" aria-label="Pilot cities">
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
        <div className="search-section">
          <SearchBox
            key={`${dataset.id}:${view.q}`}
            initial={view.q}
            release={release.data}
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
          <span className="eyebrow">{dataset.city} · STUDY AREA</span>
          <p>{dataset.coverage}</p>
          <p className="small">
            The dashed boundary marks this pilot’s extent. No records outside it have been imported.
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
        {expired ? (
          <div className="notice" aria-live="polite">
            <h2>This link uses a different release</h2>
            <p>
              The requested snapshot is not listed in the current catalogue. We have not silently
              substituted newer records.
            </p>
            <button onClick={() => update({ tree: null })}>Open the current release</button>
          </div>
        ) : (
          <>
            {release.isPending && (
              <p className="loading" aria-live="polite">
                Loading {dataset.city} records…
              </p>
            )}
            {release.isError && (
              <Notice
                title="Records could not load"
                text={release.error.message}
                retry={() => {
                  void release.refetch();
                }}
              />
            )}
            {release.data !== undefined && (
              <>
                {view.tree !== null && selected === undefined && (
                  <Notice
                    title="Record not found in this release"
                    text="The selected identifier does not belong to this published snapshot."
                  />
                )}
                {selected !== undefined && (
                  <TreeDetails
                    tree={selected}
                    dataset={dataset}
                    close={() => update({ tree: null })}
                  />
                )}
                <div className="results-heading">
                  <h2>{number.format(trees.length)} records</h2>
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
                    ? "Across this pilot study area"
                    : "Inside your selected map area"}
                  {view.q !== "" ? ` · “${view.q}”` : ""}
                </p>
                {outsideCoverage ? (
                  <Notice
                    title="Outside this pilot’s coverage"
                    text="This map area has not been imported. Clear filters to return to the available study area."
                  />
                ) : (
                  <TreeList
                    key={`${dataset.id}:${view.q}:${view.area?.join(",") ?? ""}`}
                    trees={trees}
                    selected={view.tree}
                    onSelect={(tree) => update({ tree: treeKey(tree) })}
                  />
                )}
              </>
            )}
          </>
        )}
        <footer className="source-footer">
          <p>
            <a href={dataset.sourceUrl}>{dataset.attribution} ↗</a> ·{" "}
            <a href={dataset.licenseUrl}>{dataset.license}</a>
          </p>
          <p>
            Retrieved {new Date(dataset.fetchedAt).toLocaleDateString("en-GB")}. This is an extract,
            not a census of every tree.
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
          trees={expired ? [] : trees}
          selected={view.tree}
          canopy={view.canopy}
          area={view.area}
          onSelect={(tree) => update({ tree: treeKey(tree) })}
          onArea={(area) => update({ area, tree: null })}
        />
      </Suspense>
    </main>
  );
}

type SearchProps = {
  initial: string;
  release: Release | undefined;
  datasets: readonly Dataset[];
  onSearch: (q: string) => void;
  onCity: (dataset: Dataset) => void;
};
function SearchBox({ initial, release, datasets, onSearch, onCity }: SearchProps) {
  const [draft, setDraft] = useState(initial);
  const [open, setOpen] = useState(false);
  const term = normalizeText(draft);
  const suggestions = new Set<string>();
  if (term.length >= 2 && release !== undefined) {
    for (const tree of release.trees) {
      for (const value of [tree.scientificName, tree.commonName, tree.location, tree.tag]) {
        if (value !== null && normalizeText(value).includes(term)) suggestions.add(value);
        if (suggestions.size >= 6) break;
      }
      if (suggestions.size >= 6) break;
    }
  }
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
              <small>Study area · {city.country}</small>
            </button>
          ))}
          {[...suggestions].map((text) => (
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
            Search for “{draft}”<small>In the selected study area</small>
          </button>
        </div>
      )}
      <p id="search-help" className="small">
        Search recorded species, street labels or tree tags. Full address and landmark search is not
        included in this pilot.
      </p>
    </form>
  );
}

function TreeList({
  trees,
  selected,
  onSelect,
}: {
  trees: readonly Tree[];
  selected: string | null;
  onSelect: (tree: Tree) => void;
}) {
  const [shown, setShown] = useState(30);
  if (trees.length === 0)
    return (
      <p className="empty">
        No matching records in this part of the published study area. Try another term or clear the
        filters. This does not mean there are no trees here.
      </p>
    );
  return (
    <>
      <ul className="tree-list" aria-label="Tree records">
        {trees.slice(0, shown).map((tree) => (
          <li key={treeKey(tree)}>
            <button
              id={`record-${treeKey(tree)}`}
              aria-pressed={selected === treeKey(tree)}
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
      {shown < trees.length && (
        <button className="show-more" onClick={() => setShown((value) => value + 30)}>
          Show 30 more{" "}
          <span>
            {number.format(shown)} of {number.format(trees.length)}
          </span>
        </button>
      )}
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
        {tree.location ?? dataset.city} · {tree.position[1].toFixed(5)},{" "}
        {tree.position[0].toFixed(5)}
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

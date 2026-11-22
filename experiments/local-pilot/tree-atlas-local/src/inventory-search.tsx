import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { normalizeText } from "./catalog.ts";
import type { Dataset } from "./domain.ts";
import type { InventoryClient } from "./inventory-client.ts";

type Choice =
  | { kind: "city"; city: Dataset }
  | { kind: "term"; text: string }
  | { kind: "submit"; text: string };

export type InventorySearchProps = {
  query: string;
  client: Pick<InventoryClient, "suggest"> | null;
  datasets: readonly Dataset[];
  onSearch: (query: string) => void;
  onCity: (dataset: Dataset) => void;
};

function key(choice: Choice): string {
  return choice.kind === "city" ? `city:${choice.city.id}` : `${choice.kind}:${choice.text}`;
}

/** Search one release. Arrow keys explore explicit choices; Enter also accepts the typed text. */
export function InventorySearch({
  query,
  client,
  datasets,
  onSearch,
  onCity,
}: InventorySearchProps) {
  const [draft, setDraft] = useState(query);
  const [previousQuery, setPreviousQuery] = useState(query);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [matches, setMatches] = useState<{ term: string; values: string[] } | null>(null);
  const root = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  if (query !== previousQuery) {
    setPreviousQuery(query);
    setDraft(query);
    setOpen(false);
    setHighlight(null);
  }
  const term = normalizeText(draft);
  const expanded = open && term.length >= 2;
  useEffect(() => {
    if (client === null || !expanded) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void client.suggest(term).then(
        (values) => {
          if (active) setMatches({ term, values });
        },
        () => {
          if (active) setMatches({ term, values: [] });
        },
      );
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [client, term, expanded]);
  useEffect(() => {
    if (!expanded) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [expanded]);
  useLayoutEffect(() => {
    if (!expanded) return;
    const field = input.current;
    const popup = list.current;
    if (field === null || popup === null) return;
    function place() {
      if (field === null || popup === null) return;
      const bounds = field.getBoundingClientRect();
      const sidebar = field.closest(".sidebar")?.getBoundingClientRect();
      const top = Math.max(visualViewport?.offsetTop ?? 0, sidebar?.top ?? 0);
      const bottom = Math.min(
        (visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? innerHeight),
        sidebar?.bottom ?? Infinity,
      );
      const above = bounds.top - top - 8,
        below = bottom - bounds.bottom - 8;
      const aboveField = below < 180 && above > below;
      popup.dataset["side"] = aboveField ? "above" : "below";
      popup.style.setProperty("--list-room", `${Math.max(44, aboveField ? above : below)}px`);
      popup.style.setProperty(
        "--trigger-x",
        `${bounds.left + bounds.width / 2 - popup.getBoundingClientRect().left}px`,
      );
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [expanded]);
  const choices: Choice[] =
    term.length >= 2
      ? [
          ...datasets
            .filter((city) => normalizeText(`${city.city} ${city.country}`).includes(term))
            .map((city): Choice => ({ kind: "city", city })),
          ...(matches?.term === term ? matches.values : []).map((text): Choice => ({
            kind: "term",
            text,
          })),
          { kind: "submit", text: draft.trim() },
        ]
      : [];
  const index = choices.findIndex((choice) => key(choice) === highlight);
  const activeId = !expanded || index < 0 ? undefined : `${id}-option-${index}`;
  useLayoutEffect(() => {
    if (activeId === undefined || list.current === null) return;
    const option = document.getElementById(activeId),
      popup = list.current;
    if (option === null) return;
    const rect = option.getBoundingClientRect(),
      viewport = popup.getBoundingClientRect();
    if (rect.top < viewport.top) popup.scrollTop -= viewport.top - rect.top;
    else if (rect.bottom > viewport.bottom) popup.scrollTop += rect.bottom - viewport.bottom;
  }, [activeId]);
  function choose(choice: Choice) {
    setOpen(false);
    setHighlight(null);
    if (choice.kind === "city") onCity(choice.city);
    else {
      setDraft(choice.text);
      onSearch(choice.text);
    }
  }
  return (
    <form
      ref={root}
      className="search-form"
      onSubmit={(event) => {
        event.preventDefault();
        choose({ kind: "submit", text: draft.trim() });
      }}
    >
      <label htmlFor="tree-search">Find a tree or place</label>
      <div className="search-anchor">
        <div className="search-row">
          <input
            ref={input}
            id="tree-search"
            name="q"
            type="search"
            role="combobox"
            value={draft}
            maxLength={500}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={expanded ? "search-suggestions" : undefined}
            aria-activedescendant={activeId}
            aria-describedby="search-help"
            placeholder="Species, street, tag or city…"
            onBlur={(event) => {
              if (!root.current?.contains(event.relatedTarget)) setOpen(false);
            }}
            onClick={() => setOpen(true)}
            onFocus={() => {
              setHighlight(null);
              setOpen(true);
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              setHighlight(null);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === "Escape" && expanded) {
                event.preventDefault();
                setOpen(false);
                setHighlight(null);
                return;
              }
              if (event.key === "Tab") {
                setOpen(false);
                return;
              }
              if (event.key === "Enter" && expanded && index >= 0) {
                const choice = choices[index];
                if (choice) {
                  event.preventDefault();
                  choose(choice);
                }
                return;
              }
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && term.length >= 2) {
                event.preventDefault();
                setOpen(true);
                if (!choices.length) return;
                const next =
                  event.key === "ArrowDown"
                    ? (index + 1) % choices.length
                    : index <= 0
                      ? choices.length - 1
                      : index - 1;
                const choice = choices[next];
                if (choice) setHighlight(key(choice));
              }
            }}
          />
          <button type="submit" aria-label="Search">
            ↗
          </button>
        </div>
        {expanded && (
          <div
            ref={list}
            id="search-suggestions"
            role="listbox"
            aria-label="Search suggestions"
            className="suggestions"
          >
            {choices.map((choice, i) => (
              <button
                key={key(choice)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === i}
                id={`${id}-option-${i}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(choice)}
              >
                {choice.kind === "city"
                  ? choice.city.city
                  : choice.kind === "term"
                    ? choice.text
                    : `Search for “${draft}”`}
                <small>
                  {choice.kind === "city"
                    ? `Inventory · ${choice.city.country}`
                    : choice.kind === "term"
                      ? "Recorded name or tag"
                      : "In the selected inventory"}
                </small>
              </button>
            ))}
          </div>
        )}
      </div>
      <p id="search-help" className="small">
        Search recorded species, street labels or tree tags. Full address and landmark search is not
        included.
      </p>
    </form>
  );
}

# Local pilot controls

Use one city and release for the field, map, list and record details. A search changes the list and map filters. Panning changes the map. **Search this area** is the explicit action that also filters the list.

## Search and navigation

| Use | Component and contract |
| --- | --- |
| Choose a source | `LocationPicker` takes the published dataset list, selected ID and an `onChange(dataset)` handler. Use the catalogue ID as the value. A translated city name can appear in several sources. |
| Find a record or switch inventory | `InventorySearch` takes `query`, `datasets`, `client`, `onCity` and `onSearch`. Pass a client with the release's `suggest(text)` method. Pass `null` while opening the inventory. City choices and free text still work. |
| Read matching records | `TreeList` uses the exact result count, ordered page and dataset-qualified IDs. Its paper list is available to keyboard users and to records without coordinates. |
| Inspect one record | `TreeDetails` receives the selected record and its release. List and map actions supply the activator. Opening moves focus to the heading. Close returns focus to the activator if it still exists. A direct link opens immediately. The cluster panel lists its exact member page and returns focus to its opening map control on close. |
| Show the position of matches | `TreeMap` receives the viewport, markers, selection and area-filter callbacks. Keep the exact count available in the list. Leave the native zoom buttons, wheel zoom and list route usable. |
| Explain a failure | `Notice` takes a specific title and message. Supply its retry callback when replaying the same operation can succeed. An unavailable release needs a route to an available release. |

`InventorySearch` has one instance per explorer. The parent owns the committed URL query. The field owns the unsubmitted draft. Key the component by inventory session so a city change discards stale suggestions. Keep the same component instance when the user commits a new query.

```tsx
<InventorySearch
  key={session.key}
  query={view.q}
  client={session.client}
  datasets={manifest.datasets}
  onSearch={(q) => update({ q, tree: null })}
  onCity={changeCity}
/>
```

Do not use a species string as a city identifier or pass the submit callback as the city handler. TypeScript checks the two callback signatures. Use the real city object from the manifest. Keep the raw typed query available even when the suggestion request fails.

Arrow keys move the active listbox choice. Enter accepts it, or submits the field when no choice is active. Escape closes suggestions and keeps edit focus. Tab leaves the field. A pointer outside dismisses the popup. Text composition must finish before Enter accepts a choice. The field's accessible role is `combobox` and its name is `Find a tree or place`. The popup has role `listbox`; each choice has role `option`.

## Color and motion

Use semantic roles in component CSS. Current roles include `--color-action`, `--color-on-action`, `--color-surface`, `--color-input-background`, `--color-text-secondary`, `--color-option-active`, `--color-border` and `--color-focus`. Keep the keyboard outline visible when a field gains focus, including high zoom and narrow layouts. Specific cartographic colors in the Leaflet layer still identify inventory points, selection, extent and canopy.

Anchor a custom popup to the opening control. The suggestions list measures the available space and opens from the edge that meets its field. A Leaflet tooltip uses the edge next to the point. Animate the inner label to preserve Leaflet's positioning transform. An inline record panel uses the nearest point on its border to the activator. Press feedback uses the pointer position. The reveal uses `--motion-reveal-duration` and `--motion-reveal-easing`. Keep direct links, repeated navigation and reduced-motion use immediate. Leave native selects to the operating system.

## Checks

- `pnpm typecheck` checks call sites and the negative assertions in `tests/component-contract.test.ts`. Removing the required city handler or widening it to an arbitrary value breaks the contract.
- `pnpm lint` applies the search component's JSX accessibility rules, including required and supported ARIA properties. A valid property can still refer to the wrong DOM node.
- The browser interaction checks verify the active descendant, callback intent, stable focus, outside dismissal, popup origin and reduced motion. Run the production pilot and use the Playwright configuration under tree-atlas-local/verification.

[Search component](../tree-atlas-local/src/inventory-search.tsx) · [Motion helper](../tree-atlas-local/src/trigger-motion.ts) · [Application call sites](../tree-atlas-local/src/app.tsx) · [Role tokens](../tree-atlas-local/src/style.css) · [Browser tests](../tree-atlas-local/tests/local-browser/search-interaction.spec.ts)

# Tree Atlas UI and UX review

Reviewed 22 November 2026. **Hold the wider pilot release.** A malformed saved-tree link can leave the public app saying it is still loading. A visitor following a valid public Amsterdam link on the pilot gets an instruction to choose a city and no city picker. These problems affect the starting point of a visit. Fix them before relying on a new visitor to recover unaided.

This review covers the 44-inventory public frontend and the four-city Carbon pilot. The November 20 baseline used public commit `8fb0901` and pilot commit `52dba71`. A review branch can carry a fix before either public site receives it. Check the deployed revision before closing a production bug.

Track interface and device checks in [#3](https://github.com/dvkam/tree-atlas/issues/3), component contracts in [#4](https://github.com/dvkam/tree-atlas/issues/4), map failure recovery in [#5](https://github.com/dvkam/tree-atlas/issues/5), invalid links in [#9](https://github.com/dvkam/tree-atlas/issues/9), search scope in [#17](https://github.com/dvkam/tree-atlas/issues/17) and remaining map targets in [#18](https://github.com/dvkam/tree-atlas/issues/18).

## What we tested

We opened both production builds with fresh Chromium profiles, local data, and small placeholder street-map tiles. The public build read its published assets. The pilot used the local service and PostgreSQL. We used Porto at 320 × 568, 390 × 844 and 1280 × 800 CSS pixels, with touch emulated at phone widths. We exercised a valid record, keyboard search, suggestions, a long query, malformed tree links and unavailable releases. We also inspected the map, detail, offline, source notes, search, URL parsing and component CSS. The November 20 review supplied separate London hit tests and an interrupted worker-update reproduction.

| Before this milestone | Change in this milestone | Why it matters |
| --- | --- | --- |
| In Turkish locale, public Porto returned 2,676 rows for `Tilia` and zero for `TILIA`. | Use a locale-independent search key; compare lower- and uppercase results under English and Turkish settings. | The operating system language must never remove a source record from search. |
| On a 390 px London map only 5 of 302 pilot cluster centres received their own tap. | Use screen-aware cluster selection, expose the exact member list and return focus to its opener. | A visitor should be able to open the group they point at. The represented counts still have to agree with the source. |
| One failed pilot shell update could delete the active shell cache. | Stage a replacement independently and test a failed install followed by an offline reload. | A downloaded inventory remains useful only if its app can open. Verify city search and a saved detail across upgrades. |
| Escape from a focused suggestion left it open in both apps. Clicking the heading left it open too. A successful keyboard submit put focus on `body`. | The named editable combobox keeps focus in the field. A listbox tracks the active choice and dismisses on Escape, Tab and outside pointer input. | The visitor can search twice, close the suggestions or select a different city without starting their tab sequence over. |

On the revised pilot, both Chromium interaction tests passed against the local PostgreSQL inventory. A touch tap on Porto’s `Tilia` search returned 2,676 matches. The popup opened above and below the field as available space changed. Its active option cleared on dismissal. Keyboard focus, IME composition and reduced motion also passed. These were emulated touch inputs. Public tests live under `tests/browser` in the public fix branch. [Pilot browser checks](../tree-atlas-local/tests/local-browser) · [Component usage](ui-components.md)

## Blocking interactions

### A saved link can ask for a tree from another city

**Reproduce.** In a fresh profile, open `/?city=porto&tree=vienna%3A1`. Wait for Porto's list. On the baseline public build the list is usable but the detail area still says "Loading selected tree details…". The detail query requires a Porto ID and never starts. The pilot keeps the same tree parameter in the URL and omits the detail panel entirely.

**Expected.** Keep Porto and its release selected. Identify the mismatch in the detail area, with a direct action to clear the invalid selection. If the linked city is offered as a destination, label it and use the selected city's own release rules. An invalid detail must never turn into an empty search result.

**Acceptance.** Exercise an absent ID, wrong city prefix, valid ID belonging to another release, a release that no longer opens, and a valid list-only record. All reach a result or a recoverable error. Browser Back restores the original URL; no query remains permanently pending. On a valid-format unavailable release both reviewed builds already offer an explicit current-release action. Preserve that distinction. [Pilot route handling](../tree-atlas-local/src/navigation.ts) · [Pilot detail gates](../tree-atlas-local/src/app.tsx)

### The unavailable-city notice lacks the action in its text

**Reproduce.** Open the pilot with `/?city=amsterdam`. Its header has a Tree Atlas link. The notice says "Choose one of the four local pilot cities." We observed zero buttons and one link, the header brand. Opening the brand loses the original context and defaults to another location.

**Expected.** Put the four supported inventories in the error region. State which city was requested. Keep the original URL until the visitor selects one. On the public site also test an unknown slug, for example `?city=londno`. In the baseline this selects Vienna while the address still names the unknown city. An absent query can use the default. An explicitly invalid city, release or area needs an explanation.

**Acceptance.** Direct navigation, pasted links and Back/Forward work with a keyboard. A malformed scope never silently broadens a search across an inventory. A retry that would submit the same invalid input is unnecessary.

### The map can block the record list

**Reproduce.** Open public Porto with `?city=porto&q=Tilia`. Delay the first `map.bin` response without failing it. In the November 20 test, no list rows appeared during the five-second hold. When released, the list showed 2,676 records. In both builds a failed map JavaScript chunk replaced the entire interface with the route error view. Disabling street-map image tiles alone did not cause that failure.

**Expected.** Search and pagination work while the map is unavailable. Keep the area filter's state visible, give the map its own retry control and distinguish pending geometry from a zero count. Do not overwrite a filtered map with an earlier unfiltered preview when the delayed response arrives.

**Acceptance.** Stall and reject the map asset in separate tests. Search a known genus, follow a result and return to the same page without the map. Recovering its module resumes from the user's selected city and filters. Keep the pilot list usable while its camera initializes. [Map and list ownership](../tree-atlas-local/src/app.tsx)

## Layout, keyboard and touch

The following positions were measured before the milestone in the unscrolled Porto explorer. The desktop sidebar scrolls independently. The values are the top of each control relative to the viewport.

| Window | Public search / first row | Pilot search / first row | Horizontal page overflow |
| --- | --- | --- | --- |
| 320 × 568 | 730 / 1,237 px | 1,153 / 1,709 px | 0 in both |
| 390 × 844 | 794 / 1,250 px | 1,179 / 1,683 px | 0 in both |
| 1280 × 800 | 461 / 917 px | 846 / 1,350 px | 0 in both |

1. **Bring search into the first phone viewport.** On a 390 px pilot phone, open Porto. The map, introduction, city tiles and offline controls precede search. Replace the long introduction with the selected city, a search field and a route to list or map. Put download management in an accessible source/offline disclosure. Always show which source and online/offline mode own the results. Accept when city and search are reachable without scrolling at both phone sizes, including when the soft keyboard is visible.
2. **Show which places search can find.** The field says "Find a tree or place". Porto has no populated normalized street labels. A plausible street, full address or landmark can return an accurate zero and still leave the visitor unsure what to try. Give examples derived from the active release. Name the source of a city choice and distinguish it from a species suggestion. If a geocoder is added, let its result centre the map, then offer a separate nearby-record search. Show when a connection is needed. Empty results need a clear-filters action and an example with known matches.
3. **Keep map controls reachable by keyboard.** Baseline Porto had 96 tabbable pilot cluster markers at 390 px and 296 on desktop. The public map had 9 and 109. Tab through the desktop page after the result list, then reach the controls that follow the map. Measure again after the London fix. Supply a visible-on-focus skip link between results and map controls. Consider one keyboard stop in the marker group with documented navigation and an exact list alternative. A count limit alone does not tell us whether Tab reaches the intended action.
4. **Increase the zoom target.** Both builds rendered 36 × 36 px zoom links in all six views. The project's proposed touch target is 44 × 44 px. The pilot milestone places 44 × 44 px zoom controls in a separate toolbar. Increase the public hit area and test each control at the corners as well as its centre. Measuring the button's rectangle misses overlays that intercept its tap. Retain wheel, pinch and keyboard zoom. Test controls with the maximum number of count labels and with a tile-error notice on screen.
5. **Keep focus in context for every record opener.** Opening the first Porto list row focused `detail-porto:1`. Closing restored `record-porto:1` in both baselines. Repeat this for a cluster member absent from the ordinary results page, a canvas marker, an unlocated tree and a deep link opened in a new tab. The close action should focus its actual opener if it survives, then the matching row or search. On a mobile cluster tap, move the member panel into view. Test focus restoration after the camera changes and the marker disappears.
6. **Show count and source context while panning.** Distinguish complete matches, matches with positions, and points visible in the viewport. After "Search this area", show the area filter and a way to clear it independently. At max zoom, coincident records need an exact member list. On the public baseline the max-zoom cluster action lists everything in the viewport. A nearby point outside the cluster can appear in that list.
7. **Honor the latest geolocation action.** In the November 20 browser test, the user chose Geneva while a location callback was pending. The delayed result took them to Vienna. Supersede a location request on city change, cancel, filter edit or another deliberate navigation. Test denied, unavailable, slow and outside-coverage responses. Keep manual city selection in place and link to it from the message.
8. **Keep source facts legible.** Small help and scope copy is 11 px; Leaflet attribution is 9 px. Check zoomed text, long unbroken IDs, a long botanical name, missing names and group records. Retain readable source attribution, wrapping and a visible keyboard outline. The public release has 273 records without positions. Keep them in complete search; a disabled map action should explain why. Show source status when present. Bordeaux's notes contain living, dead, stump and planned statuses even though its normalized detail label says "Not recorded".
9. **Restore the previous working offline path.** In a fresh profile, download a pack, save one detail, go offline, refresh and open a second, unsaved record. Distinguish a missing pack, missing saved detail, network failure and corrupt pack. Keep the list and area filter usable for a ready pack. Offer an online retry on reconnect and preserve the release. Exercise quota denial, cancellation, a failed replacement and eviction. Show pack size in human-readable units plus exact bytes where useful. Tile failure should leave inventory markers and list accessible. [Existing offline journey](../tree-atlas-local/tests/local-browser/offline.spec.ts)

### Individual tree targets also need touch checks

At street zoom both map implementations draw an individual tree as a circle with a 4 px radius. This value describes the painted point. Leaflet also applies its renderer hit tolerance. Zoom to a sparse street and tap a known tree at its centre and at offsets in four directions. Repeat beside a close pair and a count badge. Keep the small geographic symbol, enlarge or disambiguate its touch area and preserve exact record identity. Link a keyboard-accessible result list to the same points. Quantify missed taps and wrong-tree openings on real touch hardware. The cluster-centre regression does not cover singleton trees.

## Trigger and motion audit

The test is spatial. Open a surface on either side of its trigger. Watch where its first visible frame begins, then reverse or dismiss the action quickly. Control labels, click targets and keyboard selection need to work throughout. Reduced-motion mode removes movement; it must leave the same final state and focus.

| Trigger | Expected behavior and regression |
| --- | --- |
| Search field → suggestions | Align the popup with the field, measure the remaining space and use the edge touching the field. Opening above reverses the vertical origin. Keep the field focused while arrows update `aria-activedescendant`. Test touch, arrow selection, IME Enter, Escape, Tab, outside tap, result arrival out of order and a city change with the same draft. |
| Result row or map point → record details | Remember the pointer location or keyboard activator. Reveal the in-flow panel from the nearest point facing the opener. Give focus to its heading and restore it on close. Permit immediate navigation when opening a saved link. Keep coordinate and member identities independent of the animation. |
| Pilot cluster → member panel | Use the selected cluster control as the source. Restore focus to it when the user closes the panel. Tap accessible and densely packed clusters at phone sizes. Verify the member IDs and totals for that viewport and release. Use the same checks with the downloaded pack. |
| Point hover → Leaflet tooltip | Animate the inner label from its arrow edge, including left/right flips. Keep Leaflet's outer positioning transform intact. Hover is supplemental; the list and record view must name the tree for touch and keyboard users. |
| Native location selector, source disclosure and canopy checkbox | Preserve the system interaction for native controls. The public release-notes content reveals from the summary edge. The layer checkbox updates the map at the mapped positions. Check keyboard toggles, persistent selection and unavailable tiles. |
| Press, page navigation, search-area commit and geolocation | A button press uses its pointer location. Keyboard activation, new page counts and in-place status messages need immediate feedback. Do not animate a result page or all map points on every pan, keystroke or zoom. |
| Install, cancel, retry and save detail | Keep progress near its button. Reserve space for growing byte counts; add tabular numerals to progress and page counts where layout shifts occur. Preserve focus on completion and errors. An interrupted update must leave the prior shell and pack available. |

Use the existing semantic roles for surfaces, actions, secondary text, focus and selection. Keep motion timing and stacking order in named tokens. The search popup has an explicit active-choice indicator in addition to color. The map has different roles for individual points, clusters, a selected record, source extent and canopy. Those cartographic colors are still specified separately in Leaflet. A future palette migration needs to check contrast against imagery as well as a flat test background.

## Consistency checks for the next change

- Follow the [component guide](ui-components.md). Reuse inventory search, location selection, the record list, details, map and notices for their documented jobs. Keep consumer props narrow. The parent supplies committed query state and callbacks. The suggestion component owns its draft, active option and popup placement.
- Typecheck both valid call sites and invalid examples. A string city handler, missing navigation callback or query-only client must fail compilation. The CI browser check must fail for a listbox with a missing active option, a popup that traps focus, or motion from the wrong edge. Lint checks ARIA names, supported attributes and required roles. DOM tests check their behavior.
- Run the phone and desktop matrix with reduced motion on and off, a short viewport and a resized keyboard viewport. Check that map controls, retry actions and the popup stay inside the usable area. Match touch target size to actual hit-testing. Native VoiceOver and TalkBack, real iOS Safari and lower-memory Android devices remain unverified.
- Shorten repeated chrome before introducing new styling. The existing green markers, warm paper surfaces and source attribution establish the atlas' visual identity. Keep source coverage and uncertainty visible as the introduction recedes.

## Review method

The review used the installed Emil UI review, product thinking, design foundations, forms and inputs, touch and accessibility, mobile web, color, typography, surfaces, UI polish, component design, design-system documentation, animations, performance and production-readiness guidance. Vocabulary and Unslop checks covered labels, component names, implementation comments and this handover. The companion motion review, web animation, animation-performance, motion vocabulary, animation opportunities, Apple web interaction, design engineering and stress-test guides informed the trigger matrix.

The installed skill router, writing-skills, design and engineering vocabulary, writing/design/code Unslop, marketing pages, prototype, tool-building, creative exploration, Lapse and knowledge-extraction skills were surveyed. The companion mobile-native, prototype, library selection, Sonner, Expo animation and Swift skills were surveyed too. The atlas uses a web form and Leaflet; this round did not install a native framework, toast library or motion inspector. The keyboard, touch, input, layout and failure checks above use the actual web builds.

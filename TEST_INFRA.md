# FormGen Opaque-Box Test Infrastructure & Fixture Architecture

> **Document Status**: Complete & Authoritative  
> **Author**: E2E Testing Track Explorer (`e2e_explorer_1`)  
> **Target Scope**: FormGen Chrome Extension (Manifest V3)  
> **Traceability**: `ORIGINAL_REQUEST.md` (R1–R6) & `PROJECT.md`  
> **Environment**: Google Chrome 149.0.7827.200 (`/usr/bin/google-chrome`), Node.js v26.5.0, npm 11.17.0  

---

## 1. Executive Summary & Principles

The FormGen E2E Testing Track is engineered under the **Opaque-Box (Black-Box) Testing Principle**. The test suite treats the extension and its internal modules as opaque entities, validating strictly against observable contracts, DOM mutations, browser storage states, synthetic event dispatches, and public interface behaviors derived from requirements R1–R5 in `ORIGINAL_REQUEST.md`.

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 Opaque-Box Test Suite                    │
                  └──────┬────────────────────┬────────────────────┬────────┘
                         │                    │                    │
                         ▼                    ▼                    ▼
             ┌──────────────────────┐  ┌───────────────┐  ┌──────────────────┐
             │ Lean Schema Extraction│  │ Multi-Provider│  │ Persistent Queue │
             │ & Constraint Fidelity│  │ AI Generation │  │ & Step Management│
             │         (R1)         │  │     (R2)      │  │       (R3)       │
             └──────────┬───────────┘  └───────┬───────┘  └────────┬─────────┘
                        │                      │                   │
                        └───────────────┬──────┴───────────────────┘
                                        ▼
             ┌─────────────────────────────────────────────────────────────┐
             │       Automated Value Injection & Canonical Events (R4)      │
             └──────────────────────────┬──────────────────────────────────┘
                                        ▼
             ┌─────────────────────────────────────────────────────────────┐
             │    Standalone HTML Test Fixture & Verification Suite (R5)   │
             │   (#form-enterprise, #form-reactive, #form-edge-cases,      │
             │               window.__FORMGEN_FIXTURE__)                   │
             └─────────────────────────────────────────────────────────────┘
```

### Core Testing Invariants
1. **Implementation Agnosticism**: Test assertions verify input/output contracts, DOM state, storage records, and event dispatches. Tests remain valid regardless of internal refactoring.
2. **Zero Manual Intervention**: 100% of the verification suite runs headlessly without requiring mouse clicks, manual form inspection, or external user prompts.
3. **Deterministic Reactivity Verification**: Event fidelity (`focus`, `input`, `change`, `blur`) and React/Vue two-way data binding traps are objectively verified via the test harness hook `window.__FORMGEN_FIXTURE__`.
4. **Adversarial Resilience**: Form scanning and injection must properly handle honeypots, hidden inputs, disabled fields, floating labels, and malformed inputs.

---

## 2. Requirement Traceability Matrix

| Requirement | Title | Test Suite Focus | Tier Coverage |
|:---|:---|:---|:---:|
| **R1** | Inspeção e Extração Sanitizada de Formulários (DOM Scanner) | Schema fidelity, 7-tier label cascade, zero HTML/styles leakage, constraint extraction, honeypot/file exclusions | Tiers 1, 2, 3, 4 |
| **R2** | Integração com IA Multi-Provedor com Formato JSON Estrito | Provider configs (Gemini, OpenAI, Ollama, Custom), strict `{ "records": [ ... ] }` structure, 1/10/100 batches, token chunking, JSON repair | Tiers 1, 2, 3, 4 |
| **R3** | Gerenciamento de Fila no Navegador e Persistência | Immediate #1 fill, storage of #2..#N in `storage.local`, dynamic button `[X/N]`, sequential advance, auto-purge, discard flow | Tiers 1, 2, 3, 4 |
| **R4** | Preenchimento Automatizado e Emulação de Eventos | Multi-control filling, native prototype setter bypass (`_valueTracker`), canonical event order (`focus` -> `input` -> `change` -> `blur`), bubbling/composed flags | Tiers 1, 2, 3, 4 |
| **R5** | Suite de Verificação com Fixture HTML Integrada | Standalone fixture (`test-fixture.html`), `#form-enterprise`, `#form-reactive`, `#form-edge-cases`, `window.__FORMGEN_FIXTURE__`, automated headless runner | Tiers 1, 2, 3, 4 |
| **R6** | Governança de Código, Autoria Git e Graphify | Authorship `JoaoVictorOAS <playerthejvs@gmail.com>`, `graphify update .` synchronization | Verification |

---

## 3. The 4-Tier Test Suite Specification

### Tier 1: Feature Coverage (>= 5 tests per requirement, 30 tests total)

#### Requirement R1: DOM Form Inspection & Lean Schema Extraction
- **`TC-T1-R1-01` — Standard Form Discovery & Field Enumeration**
  - *Objective*: Verify scanner traverses `#form-enterprise` and enumerates every fillable control (`text`, `email`, `number`, `tel`, `date`, `select`, `select-multiple`, `radio`, `checkbox`, `textarea`).
  - *Preconditions*: Fixture loaded in browser; extension content script injected.
  - *Action*: Dispatch `SCAN_DOM` message.
  - *Expected*: Response contains array of fields matching the exact count of fillable controls; each field contains `id`, `name`, `type`, `label`.
- **`TC-T1-R1-02` — Zero Raw HTML / Style Leakage Sanity Check**
  - *Objective*: Assert the generated Lean JSON Schema does not leak raw HTML markup, inline styles, CSS classes, or script tags.
  - *Preconditions*: Fixture with stylized DOM elements loaded.
  - *Action*: Run DOM scan and inspect JSON schema string.
  - *Expected*: String regex test fails for `<div`, `<span`, `<style`, `style=`, `class=`, `css`. Payload size is >95% smaller than `form.outerHTML`.
- **`TC-T1-R1-03` — HTML5 Validation Constraint Extraction Fidelity**
  - *Objective*: Assert that HTML5 attributes (`required`, `min`, `max`, `step`, `pattern`, `minlength`, `maxlength`, `autocomplete`) are parsed into typed schema constraints.
  - *Preconditions*: `#form-enterprise` controls populated with constraints.
  - *Action*: Scan form and inspect `constraints` object per field.
  - *Expected*: `ent-fullname` has `required: true, minLength: 3, maxLength: 50`; `ent-age` has `min: 18, max: 120, step: "1"`; `ent-phone` has `pattern: "\\(\\d{2}\\) \\d{4,5}-\\d{4}"`.
- **`TC-T1-R1-04` — Select Dropdown & Radio Group Option Discovery**
  - *Objective*: Validate option extraction for single select (`#ent-state`), multi-select (`#ent-skills`), and radio groups (`name="ent-contract"`).
  - *Preconditions*: Selects have multiple `<option>` children; radio buttons share identical `name`.
  - *Action*: Scan `#form-enterprise`.
  - *Expected*: Single select field has `options: ["SP", "RJ", "MG", "RS", "PR"]`; radio group is collapsed into a single schema item with `type: "radio"` and options list `["clt", "pj", "estagio"]`.
- **`TC-T1-R1-05` — Non-Fillable Control Filtering**
  - *Objective*: Assert non-fillable elements (`type="hidden"`, CSRF tokens, `type="file"`, `disabled`, honeypots) are excluded from the schema.
  - *Preconditions*: `#form-edge-cases` contains hidden token, disabled input, file input, and honeypots.
  - *Action*: Scan `#form-edge-cases`.
  - *Expected*: Excluded fields do not appear in `schema.fields`. Total field count matches only fillable inputs.
- **`TC-T1-R1-06` — 7-Tier Label Resolution Cascade Completeness**
  - *Objective*: Assert the scanner resolves labels across all 7 precedence tiers on `#form-edge-cases`.
  - *Preconditions*: Edge cases form contains elements utilizing Tiers 1 through 7.
  - *Action*: Scan `#form-edge-cases` and assert resolved label for each test element.
  - *Expected*:
    - Tier 1 (`for` attribute): matches `<label for="edge-tier1-id">`
    - Tier 2 (enclosing `<label>`): matches wrapping text
    - Tier 3 (`aria-labelledby`): resolves space-separated element text
    - Tier 4 (`aria-label`): matches attribute text
    - Tier 5 (`<fieldset><legend>`): matches legend text
    - Tier 6 (preceding sibling/container): matches wrapper text
    - Tier 7 (attribute fallback): matches placeholder/title/normalized name

#### Requirement R2: Multi-Provider AI Configuration & Structured Generation
- **`TC-T1-R2-01` — Settings Persistence in `chrome.storage.sync`**
  - *Objective*: Verify options page saves provider configuration (`baseUrl`, `model`, `apiKey`, `provider`, `temperature`) to `chrome.storage.sync` under key `formgen_settings`.
  - *Preconditions*: Options page mounted.
  - *Action*: Set provider to "gemini", fill API key "test-key-123", model "gemini-2.0-flash", click Save.
  - *Expected*: `chrome.storage.sync.get('formgen_settings')` returns identical configuration object; payload size is well below 8 KB quota.
- **`TC-T1-R2-02` — Single Record Generation (`N=1`) Schema Conformance**
  - *Objective*: Assert AI service generates exactly 1 valid record conforming strictly to the requested form schema.
  - *Preconditions*: Valid schema payload; mock AI service returning valid JSON.
  - *Action*: Dispatch `GENERATE_DATA` with `count: 1`.
  - *Expected*: Response contains `{ success: true, count: 1, records: [ { ... } ] }`; all required fields present with types matching schema constraints.
- **`TC-T1-R2-03` — Batch Generation (`N=10`) Strict JSON Array Structure**
  - *Objective*: Assert AI service generates exactly 10 records enclosed in `{ "records": [ ... ] }`.
  - *Preconditions*: Mock AI configured for 10 records.
  - *Action*: Dispatch `GENERATE_DATA` with `count: 10`.
  - *Expected*: Array length is exactly 10; every record possesses distinct realistic data matching field constraints.
- **`TC-T1-R2-04` — Batch Generation (`N=100`) Chunking & Reassembly**
  - *Objective*: Assert request for 100 records executes chunked sub-requests (e.g. 4 chunks of 25 or 2 chunks of 50) to prevent token truncation, reassembling into a full 100-record array.
  - *Preconditions*: Schema provided for 100-record generation.
  - *Action*: Dispatch `GENERATE_DATA` with `count: 100`.
  - *Expected*: Service worker executes chunked calls, combines records, and returns full array of length 100.
- **`TC-T1-R2-05` — Multi-Provider Request Formatting Parity**
  - *Objective*: Validate that adapter layer formats request payloads correctly for Gemini (`generateContent` + `x-goog-api-key`), OpenAI (`/chat/completions` + `response_format: { type: "json_object" }`), and Ollama (`/api/chat` + `format: "json"`).
  - *Preconditions*: Provider configurations toggled in settings.
  - *Action*: Inspect outbound HTTP requests for each provider type.
  - *Expected*: Gemini uses `x-goog-api-key` header; OpenAI includes Bearer token and `json_object`; Ollama sets `stream: false` and `format: "json"`.
- **`TC-T1-R2-06` — Resilient JSON Sanitization & Parsing**
  - *Objective*: Verify JSON repair engine handles markdown backticks (````json ... ````), trailing commas, and boundary noise.
  - *Preconditions*: Raw LLM response containing markdown wrapper and trailing commas.
  - *Action*: Pass raw string to JSON sanitization pipeline.
  - *Expected*: Sanitizer returns valid JavaScript object without throwing `SyntaxError`.

#### Requirement R3: Browser Queue Management & Dynamic Stepping UI
- **`TC-T1-R3-01` — Single Record Immediate Injection Without Queue Storage**
  - *Objective*: Verify generating 1 record injects immediately into the DOM and leaves NO active queue in `chrome.storage.local`.
  - *Preconditions*: Form visible; queue storage empty.
  - *Action*: Generate 1 record.
  - *Expected*: Form fields filled; `chrome.storage.local.get('formgen_active_queue')` returns `undefined` or null; Popup button displays "Gerar dados".
- **`TC-T1-R3-02` — Batch Record #1 Immediate Injection & Storage of #2..#N**
  - *Objective*: Verify generating 10 records immediately injects record #1 and stores records #2 through #10 in `chrome.storage.local`.
  - *Preconditions*: Form visible on active tab.
  - *Action*: Generate 10 records.
  - *Expected*: Form populated with record #1 values; `formgen_active_queue` in `chrome.storage.local` contains `totalRecords: 10, currentIndex: 2, pendingRecords.length === 9`.
- **`TC-T1-R3-03` — Dynamic Stepping Button State Transitions**
  - *Objective*: Verify popup primary button displays `Inserir registro [2/10]` after batch creation, and advances to `Inserir registro [3/10]` on click.
  - *Preconditions*: 10-record queue active in storage.
  - *Action*: Open popup, observe button text, click button, observe updated button text.
  - *Expected*: Initial button text is `Inserir registro [2/10]`; post-click button text is `Inserir registro [3/10]`; form fields updated with record #2 values.
- **`TC-T1-R3-04` — Final Queue Ingestion & Automatic Storage Purge**
  - *Objective*: When the final record (`[10/10]`) is injected, the queue must be automatically purged from `chrome.storage.local` and popup resets to IDLE.
  - *Preconditions*: Queue is at `currentIndex: 10` (`[10/10]`).
  - *Action*: Click "Inserir registro [10/10]".
  - *Expected*: Record #10 injected into form; `formgen_active_queue` deleted from `chrome.storage.local`; button text resets to "Gerar dados".
- **`TC-T1-R3-05` — User-Initiated Queue Discard Flow ("Descartar fila")**
  - *Objective*: Verify clicking "Descartar fila" purges active queue and resets popup state.
  - *Preconditions*: Active queue at `[4/10]`.
  - *Action*: Click "Descartar fila".
  - *Expected*: `formgen_active_queue` cleared; popup button resets to "Gerar dados"; form inputs retain existing values (not cleared).
- **`TC-T1-R3-06` — Queue Storage Isolation by URL and Form ID**
  - *Objective*: Verify queue is bound to specific page URL and form ID.
  - *Preconditions*: Queue created on Page A / Form 1.
  - *Action*: Inspect queue object keys and access from Page B.
  - *Expected*: Queue contains `url` and `formId`; browsing to Page B renders popup in IDLE state without affecting Page A's stored queue.

#### Requirement R4: Automated DOM Injection & Reactivity Emulation
- **`TC-T1-R4-01` — Multi-Control Value Injection**
  - *Objective*: Verify accurate value injection across all HTML5 input types (`text`, `email`, `number`, `tel`, `date`, `textarea`).
  - *Preconditions*: `#form-enterprise` rendered.
  - *Action*: Inject synthetic record: `{ fullname: "Ada Lovelace", email: "ada@example.com", age: 36, phone: "(11) 98765-4321", birthdate: "1990-12-10", bio: "Computer pioneer" }`.
  - *Expected*: All input element `.value` properties match synthetic values exactly.
- **`TC-T1-R4-02` — Select Option Selection (Single & Multi)**
  - *Objective*: Assert correct selection of single-select (`#ent-state`) and multi-select (`#ent-skills`).
  - *Preconditions*: Selects rendered with predefined options.
  - *Action*: Inject `{ state: "SP", skills: ["javascript", "typescript"] }`.
  - *Expected*: `#ent-state` has `value === "SP"`; `#ent-skills` has options "javascript" and "typescript" marked `selected === true`.
- **`TC-T1-R4-03` — Radio Button & Checkbox Toggling**
  - *Objective*: Verify radio button group selects specific radio by value and checkboxes update `.checked`.
  - *Preconditions*: Radio group `ent-contract` (clt, pj, estagio) and checkboxes `newsletter`, `terms`.
  - *Action*: Inject `{ "ent-contract": "pj", newsletter: true, terms: true }`.
  - *Expected*: Radio with `value="pj"` has `checked === true`, other radios `checked === false`; both checkboxes have `checked === true`.
- **`TC-T1-R4-04` — React Native Prototype Setter Bypass**
  - *Objective*: Verify injector invokes `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)` and resets `_valueTracker`.
  - *Preconditions*: `#form-reactive` attached with React-style `_valueTracker`.
  - *Action*: Inject value "Reactive User" into `#reactive-name`.
  - *Expected*: Synthetic event fires; internal `_valueTracker` accepts change; framework does not overwrite or revert value.
- **`TC-T1-R4-05` — Canonical Event Dispatch Sequence**
  - *Objective*: Assert injector fires events in canonical order: `focus` -> setter -> `input` -> `change` -> `blur`.
  - *Preconditions*: `#ent-fullname` monitored by `window.__FORMGEN_FIXTURE__`.
  - *Action*: Inject value "Test User".
  - *Expected*: Event log records sequence `['focus', 'input', 'change', 'blur']` for target element in that exact order.
- **`TC-T1-R4-06` — Event Propagation & Fidelity (`bubbles`, `composed`)**
  - *Objective*: Verify dispatched synthetic events bubble and are composed, reaching parent form and window listeners.
  - *Preconditions*: Window-level event listener registered.
  - *Action*: Inject value into nested input inside `#form-enterprise`.
  - *Expected*: Captured event object shows `bubbles === true`, `composed === true`, `cancelable === true`.

#### Requirement R5: Standalone Fixture & Verification Suite
- **`TC-T1-R5-01` — Fixture Availability & Global Hook (`window.__FORMGEN_FIXTURE__`)**
  - *Objective*: Assert `test-fixture.html` initializes `window.__FORMGEN_FIXTURE__` with complete API methods (`getCapturedEvents`, `getReactiveState`, `isFormValid`, `resetLogs`).
  - *Preconditions*: Fixture loaded in browser.
  - *Action*: Evaluate `typeof window.__FORMGEN_FIXTURE__` and inspect properties.
  - *Expected*: Returns `"object"`; all four helper functions are present and callable.
- **`TC-T1-R5-02` — Event Capture Verification via `getCapturedEvents()`**
  - *Objective*: Verify fixture records all user and synthetic events with complete metadata (`timestamp`, `targetId`, `type`, `value`, `bubbles`, `composed`).
  - *Preconditions*: Fixture loaded, logs reset.
  - *Action*: Dispatch synthetic `input` and `change` on `#ent-email`.
  - *Expected*: `getCapturedEvents()` returns array of length 2 with matching `targetId: "ent-email"`.
- **`TC-T1-R5-03` — Reactive State Mirror Verification via `getReactiveState()`**
  - *Objective*: Assert that `#form-reactive` two-way data binding updates internal JavaScript `reactiveState` and DOM mirror `<pre id="reactive-state-output">`.
  - *Preconditions*: Fixture loaded.
  - *Action*: Inject values into `#form-reactive` inputs.
  - *Expected*: `getReactiveState()` returns state object matching injected values; DOM mirror text matches `JSON.stringify(reactiveState, null, 2)`.
- **`TC-T1-R5-04` — Full Form Validity Assertion via `isFormValid()`**
  - *Objective*: Assert `isFormValid('#form-enterprise')` returns `false` before injection and `true` after valid synthetic injection.
  - *Preconditions*: Required fields in `#form-enterprise` empty.
  - *Action*: Check validity before injection; inject valid synthetic data; check validity after.
  - *Expected*: `isFormValid` transitions from `false` to `true`.
- **`TC-T1-R5-05` — 100% Non-Interactive Automated Headless Execution**
  - *Objective*: Verify complete E2E test suite executes end-to-end in headless Chrome without any manual clicks or intervention.
  - *Preconditions*: Test runner invoked via terminal command.
  - *Action*: Run `npm run test:e2e`.
  - *Expected*: Exits with code 0; 100% tests pass; test report generated.

---

### Tier 2: Boundary & Corner Cases (>= 5 tests per requirement, 28 tests total)

#### Requirement R1 Boundary & Corner Cases
- **`TC-T2-R1-01` — Orphan Form Controls Outside Any `<form>` Tag**
  - *Objective*: Verify scanner correctly discovers and extracts inputs placed in arbitrary `<div>` containers without an enclosing `<form>` element.
  - *Preconditions*: Element `#orphan-input` in fixture placed outside `<form>`.
  - *Action*: Scan DOM.
  - *Expected*: Orphan input is identified, assigned transient `data-formgen-id`, and included in schema.
- **`TC-T2-R1-02` — Adversarial Honeypot Detection & Exclusion**
  - *Objective*: Ensure honeypot inputs designed to catch spam bots (`style="display:none"`, `left: -9999px`, `opacity: 0; width: 0; height: 0`, `aria-hidden="true"`) are NOT included in the schema.
  - *Preconditions*: `#form-edge-cases` contains 4 distinct honeypot techniques.
  - *Action*: Scan form.
  - *Expected*: None of the 4 honeypot fields appear in `schema.fields`.
- **`TC-T2-R1-03` — Complex Label Formatting & Noisy Punctuation**
  - *Objective*: Verify label normalization strips `*`, `(obrigatório)`, `(required)`, trailing colons, and collapses multiple whitespace.
  - *Preconditions*: Label text: `"\n  Nome Completo * (obrigatório):   \n"`.
  - *Action*: Scan form and inspect normalized label.
  - *Expected*: Extracted label is exactly `"Nome Completo"`.
- **`TC-T2-R1-04` — Ultra-Dense Form Scalability (>150 Controls)**
  - *Objective*: Assert scanner completes within <150ms on a massive form with >150 input fields without DOM freeze.
  - *Preconditions*: Dynamically generated fixture with 150 fields.
  - *Action*: Execute `SCAN_DOM` and measure execution time.
  - *Expected*: Completes in <150ms; memory consumption remains stable.
- **`TC-T2-R1-05` — Dynamic Elements Injected Post-Scan**
  - *Objective*: Verify system gracefully handles DOM changes where inputs are dynamically added or removed after initial scan.
  - *Preconditions*: Scan performed; new input inserted via JS.
  - *Action*: Re-scan form.
  - *Expected*: Updated schema includes the newly inserted element without duplicating existing elements.
- **`TC-T2-R1-06` — Disabled and Readonly Control Handling**
  - *Objective*: Assert `disabled` controls are excluded from fillable schema while `readonly` controls are tagged as non-editable.
  - *Preconditions*: `#edge-disabled` and `#edge-readonly` present.
  - *Action*: Scan `#form-edge-cases`.
  - *Expected*: `disabled` input is omitted; `readonly` input is either omitted or marked `readonly: true` so AI does not generate values to overwrite.

#### Requirement R2 Boundary & Corner Cases
- **`TC-T2-R2-01` — Truncated AI Response at Token Ceiling**
  - *Objective*: Verify handling when AI output is truncated mid-JSON due to max token limits.
  - *Preconditions*: Mock AI returns partial JSON: `{"records": [{"name": "John"`.
  - *Action*: Pass truncated response to parser.
  - *Expected*: Parser identifies unclosed JSON, attempts repair or triggers fallback, and reports meaningful error instead of uncaught crash.
- **`TC-T2-R2-02` — Malformed AI Response with Markdown & Trailing Commas**
  - *Objective*: Verify robust parsing when AI returns markdown commentary and trailing commas inside JSON array.
  - *Preconditions*: String: `Here is your data:\n```json\n{"records": [{"name": "Ana",},]}\n````.
  - *Action*: Execute JSON sanitization engine.
  - *Expected*: Strips markdown wrappers, removes trailing commas, successfully extracts valid records array.
- **`TC-T2-R2-03` — Partial AI Output with Missing Required Fields**
  - *Objective*: Assert that if AI fails to supply values for some schema fields, the injector fills defaults or leaves unchanged without crashing.
  - *Preconditions*: Schema requires 10 fields; AI record contains only 7 fields.
  - *Action*: Process and inject record.
  - *Expected*: 7 fields injected successfully; 3 missing fields gracefully skipped; log notes skipped fields.
- **`TC-T2-R2-04` — Network Outage & HTTP 429 Rate Limiting**
  - *Objective*: Verify extension displays clear user-facing error message when AI API returns HTTP 429 (quota exceeded) or fails due to network disconnect.
  - *Preconditions*: Mock AI configured to return HTTP 429.
  - *Action*: Trigger generation.
  - *Expected*: Popup displays error message "Limite de requisições atingido. Tente novamente em instantes."; queue remains intact.
- **`TC-T2-R2-05` — Storage Quota Resilience with 100 Large Records**
  - *Objective*: Verify storing 100 records with large textareas does not exceed `chrome.storage.local` limits and never writes to `chrome.storage.sync` (8 KB limit).
  - *Preconditions*: 100 records totaling ~150 KB generated.
  - *Action*: Save to storage.
  - *Expected*: Successfully written to `chrome.storage.local`; `chrome.storage.sync` untouched; no `QUOTA_BYTES_PER_ITEM` error.

#### Requirement R3 Boundary & Corner Cases
- **`TC-T2-R3-01` — Rapid Double-Clicking on "Inserir registro"**
  - *Objective*: Verify button click handler is debounced so rapid clicks do not skip queue indices or inject duplicate records out-of-order.
  - *Preconditions*: Active queue at `[2/10]`.
  - *Action*: Dispatch two click events 10ms apart.
  - *Expected*: Only one record step advances (`[2/10]` -> `[3/10]`); second click ignored during processing.
- **`TC-T2-R3-02` — Page Refresh Mid-Queue**
  - *Objective*: Verify active queue persists across full page reloads.
  - *Preconditions*: Queue active at `[5/10]`; browser reloads `test-fixture.html`.
  - *Action*: Reload page; open popup.
  - *Expected*: Popup immediately recognizes active queue for current URL, displays `Inserir registro [5/10]`, and successfully injects record #5 into freshly loaded DOM.
- **`TC-T2-R3-03` — Multiple Concurrent Tabs with Independent Forms**
  - *Objective*: Assert queue in Tab A does not leak into Tab B with a different URL or form.
  - *Preconditions*: Tab A on Form 1 (queue active); Tab B on Form 2 (no queue).
  - *Action*: Switch to Tab B and open popup.
  - *Expected*: Tab B shows IDLE ("Gerar dados"); switching back to Tab A preserves active queue at current index.
- **`TC-T2-R3-04` — Service Worker Termination & Resume During Pauses**
  - *Objective*: Verify MV3 background service worker deactivation after 30s idle time does not corrupt queue state.
  - *Preconditions*: Queue active; service worker stopped via `chrome.runtime.reload()` or idle timeout.
  - *Action*: Re-open popup after 60s and advance queue.
  - *Expected*: Service worker wakes up, reads queue from `chrome.storage.local`, and injects next record seamlessly.
- **`TC-T2-R3-05` — Corrupted Storage Recovery**
  - *Objective*: Verify that if `formgen_active_queue` in storage contains invalid/corrupted JSON, popup resets to clean IDLE state without crashing.
  - *Preconditions*: Inject `{ corrupted: true }` into `formgen_active_queue`.
  - *Action*: Open popup.
  - *Expected*: Popup detects invalid queue schema, logs warning, clears corrupted key, and renders IDLE state.

#### Requirement R4 Boundary & Corner Cases
- **`TC-T4-R4-01` — React 18/19 Controlled Component Overrides**
  - *Objective*: Verify that controlled inputs in React 18/19 fiber trees retain injected values even when state reconciler triggers.
  - *Preconditions*: Controlled input element with state hook attached.
  - *Action*: Inject synthetic value via prototype setter and dispatch canonical event sequence.
  - *Expected*: React internal state updates; value does not revert on subsequent blur or re-render.
- **`TC-T4-R4-02` — Masked Telephone Input Ingestion**
  - *Objective*: Verify injection into input with dynamic JavaScript input mask (e.g. `(XX) XXXXX-XXXX`).
  - *Preconditions*: Mask listener attached to `#ent-phone` formatting input on each keystroke.
  - *Action*: Inject raw digits `"11987654321"` or formatted string `"(11) 98765-4321"`.
  - *Expected*: Resulting input value conforms to mask pattern; pattern constraint passes validation.
- **`TC-T4-R4-03` — Number Input Step & Min/Max Boundary Clamping**
  - *Objective*: Verify injection handles `step="0.01"` or integer clamping without triggering invalid step errors.
  - *Preconditions*: Input with `min="10"`, `max="100"`, `step="5"`.
  - *Action*: Inject value matching step constraint (`25`).
  - *Expected*: Value accepted; `input.checkValidity() === true`.
- **`TC-T4-R4-04` — Date Input Formatting Conformity (ISO `YYYY-MM-DD`)**
  - *Objective*: Verify date inputs receive standard ISO format `YYYY-MM-DD` required by HTML5 date pickers regardless of locale.
  - *Preconditions*: `#ent-birthdate` input of type `date`.
  - *Action*: Inject date string `"1995-05-20"`.
  - *Expected*: `input.value === "1995-05-20"`; `input.valueAsDate` matches date object.
- **`TC-T4-R4-05` — Readonly and Locked Field Preservation**
  - *Objective*: Verify injector strictly skips fields marked `readonly` to prevent violating server-generated state (e.g. Order ID, User UUID).
  - *Preconditions*: `#edge-readonly` with initial value `"PRESERVE_ME"`.
  - *Action*: Attempt injection on form.
  - *Expected*: `#edge-readonly.value` remains `"PRESERVE_ME"`; no event dispatched on this element.
- **`TC-T4-R4-06` — Textarea with Multiline Line Breaks (`\n`)**
  - *Objective*: Verify multiline text containing `\n` is properly injected into `<textarea>` without truncating or escaping characters.
  - *Preconditions*: `#ent-bio` textarea.
  - *Action*: Inject multiline string `"Line 1\nLine 2\nLine 3"`.
  - *Expected*: `.value` matches exactly with linebreaks; `change` and `input` events fired.

#### Requirement R5 Boundary & Corner Cases
- **`TC-T2-R5-01` — High-Frequency Event Log Flooding (>1,000 Events)**
  - *Objective*: Verify `window.__FORMGEN_FIXTURE__` event buffer handles rapid event bursts without browser tab crash or memory exhaustion.
  - *Preconditions*: Fixture loaded.
  - *Action*: Rapidly dispatch 1,200 synthetic events across form inputs.
  - *Expected*: All events recorded; buffer length equals 1,200; page UI remains responsive.
- **`TC-T2-R5-02` — Concurrent Event Reset & Injection**
  - *Objective*: Verify `window.__FORMGEN_FIXTURE__.resetLogs()` immediately before injection cleanly clears previous records without race condition.
  - *Preconditions*: 50 prior events logged.
  - *Action*: Call `resetLogs()`, immediately inject record.
  - *Expected*: `getCapturedEvents()` returns only events originating from current injection.
- **`TC-T2-R5-03` — Strict Event Bubbling & Composed Propagation to Window Level**
  - *Objective*: Verify events dispatched by injector can be caught by window-level capture and bubble listeners.
  - *Preconditions*: Listener attached to `window.addEventListener('input', fn)`.
  - *Action*: Inject value.
  - *Expected*: Window listener captures event with `event.target` matching input.
- **`TC-T2-R5-04` — Headless Chrome Memory Limits in Containerized CI**
  - *Objective*: Verify automated test suite executes cleanly under memory-constrained headless environments (`/dev/shm` small size).
  - *Preconditions*: Chrome launched with `--disable-dev-shm-usage`, `--no-sandbox`.
  - *Action*: Run full test suite.
  - *Expected*: Passes with 0 segmentation faults or browser crashes.
- **`TC-T2-R5-05` — Asynchronous DOM Mutation Detection**
  - *Objective*: Verify test harness detects dynamically rendered fields via `MutationObserver`.
  - *Preconditions*: Fixture with delayed input rendering (50ms timeout).
  - *Action*: Test runner waits for element appearance before asserting scan.
  - *Expected*: Test runner waits and resolves element without timeout.

---

### Tier 3: Cross-Feature Combinations (Pairwise Coverage)

```
       R1 (Scanner)
        │         ▲
        │ Pair-01 │ Pair-04
        ▼         │
       R2 (AI) ───┼──► R4 (Injector)
        │         │         ▲
        │ Pair-02 │ Pair-05 │ Pair-07
        ▼         ▼         │
       R3 (Queue) ──────────┘
            │
            ▼ Pair-06
       R5 (Fixture)
```

- **`TC-T3-PAIR-01` — [R1 Scanner + R2 AI Service] Lean Schema to AI Prompt Pipeline**
  - *Description*: Verify schema extracted by R1 is directly serializable into R2 prompt format without missing field constraints, and AI response maps 1:1 back to schema fields.
  - *Inputs*: Scanned `#form-enterprise`.
  - *Action*: Pass schema to AI prompt builder -> Generate mock AI response -> Validate keys.
  - *Expected*: Every fillable field in schema is present in the AI generated record; no phantom keys created.
- **`TC-T3-PAIR-02` — [R2 AI Service + R3 Queue Manager] 100-Record Batch Chunking & Storage**
  - *Description*: Verify that 100-record batch generated by AI service is chunked, reassembled, and correctly handed over to `queue-manager` for `chrome.storage.local` persistence.
  - *Inputs*: 100 records generated.
  - *Action*: Store queue -> Read back from storage.
  - *Expected*: Storage contains exactly 99 pending records (since record #1 is separated for immediate injection); storage payload valid.
- **`TC-T3-PAIR-03` — [R3 Queue Manager + R4 Injector] Step-by-Step Queue Ingestion into DOM**
  - *Description*: Verify sequential popping of records from queue manager updates DOM inputs on each step, updating `window.__FORMGEN_FIXTURE__` events sequentially.
  - *Inputs*: 3-record queue active.
  - *Action*: Inject #1 -> Advance to #2 -> Advance to #3.
  - *Expected*: On step #2, DOM reflects record #2 data; on step #3, DOM reflects record #3 data; queue purges after step #3.
- **`TC-T3-PAIR-04` — [R1 Scanner + R4 Injector] Deterministic Mapping via Transient Stamping**
  - *Description*: Verify that transient `data-formgen-id` attributes stamped by R1 scanner remain attached to DOM nodes and allow R4 injector to target elements unambiguously even if elements share identical names or classes.
  - *Inputs*: DOM containing multiple inputs with similar classes.
  - *Action*: Scan form -> Inject record using stamped IDs.
  - *Expected*: Values land in correct targets; zero cross-contamination between duplicate selectors.
- **`TC-T3-PAIR-05` — [R2 AI Service + R4 Injector] Single Record Direct Flow (`N=1`)**
  - *Description*: Verify complete end-to-end flow of single record generation: AI generates JSON record -> Injector directly populates DOM -> Canonical events fired -> Zero queue overhead.
  - *Inputs*: `N=1` generation request on `#form-enterprise`.
  - *Action*: Trigger single fill.
  - *Expected*: Form filled in <300ms; event logger shows full canonical sequence for all inputs; storage has no queue.
- **`TC-T3-PAIR-06` — [R3 Queue Manager + R5 Fixture] Multi-Step Queue Ingestion Across Page Reloads**
  - *Description*: Verify queue stepping against fixture across page navigation/reloads.
  - *Inputs*: Batch queue generated on `test-fixture.html`.
  - *Action*: Inject #1 -> Reload fixture -> Open popup -> Inject #2.
  - *Expected*: Queue recovers seamlessly; record #2 injects into freshly loaded DOM; event logger captures record #2 events.
- **`TC-T3-PAIR-07` — [R4 Injector + R5 Fixture] Reactivity Engine Verification Against Reactive Simulator**
  - *Description*: Verify injector's prototype setter and event sequence updates `#form-reactive` simulator's internal `reactiveState` and mirrors into `<pre id="reactive-state-output">`.
  - *Inputs*: `#form-reactive` inputs.
  - *Action*: Inject synthetic record `{ reactiveName: "Marie Curie", reactiveEmail: "marie@radium.org" }`.
  - *Expected*: `window.__FORMGEN_FIXTURE__.getReactiveState()` returns exact values; DOM mirror updates; `_valueTracker` intact.

---

### Tier 4: Real-World Application Scenarios (5 Realistic Scenarios)

#### `TC-T4-SCEN-01` — Enterprise ERP Employee Onboarding Form
- **Context**: An HR manager onboarding an employee into an ERP platform (simulated by `#form-enterprise`). The form contains 11 distinct input types across personal details, contact data, employment contract, and compliance consent.
- **Flow**:
  1. User opens `test-fixture.html#form-enterprise`.
  2. Clicks FormGen extension icon -> Selects provider (Gemini / OpenAI) -> Clicks "Gerar dados (1 registro)".
  3. Scanner scans the form, resolves Portuguese labels ("Nome completo", "Tipo de Contrato", "Estado"), extracts constraints (min age 18, phone pattern, required terms).
  4. AI returns realistic synthetic persona matching constraints.
  5. Injector uses native prototype setters to inject all 11 fields.
  6. Dispatches `focus`, `input`, `change`, `blur` on each field.
- **Assertions**:
  - `window.__FORMGEN_FIXTURE__.isFormValid('form-enterprise') === true`.
  - Event logger contains at least 33 events (3+ events per field across 11 fields).
  - Selected radio is "clt", "pj", or "estagio".
  - Age is integer between 18 and 120.
  - Terms checkbox `checked === true`.

#### `TC-T4-SCEN-02` — High-Volume CRM Lead Batch Ingestion (100 Records)
- **Context**: A sales operations specialist populating a CRM system with 100 realistic leads.
- **Flow**:
  1. User requests "100 registros".
  2. Background service worker chunks requests into 4 batches of 25 records.
  3. Reassembles 100 records in memory.
  4. Injects record #1 immediately into the form.
  5. Persists records #2..#100 in `chrome.storage.local`.
  6. Popup UI primary button displays `Inserir registro [2/100]`.
  7. User steps through records: clicks button -> record #2 injected -> button advances to `[3/100]`.
  8. Test simulates fast-forwarding or advancing to `[100/100]`.
  9. Injects final record #100 -> Queue auto-purges -> Button resets to "Gerar dados".
- **Assertions**:
  - Lead #1 populated immediately.
  - Storage size stays under local quota (no sync write).
  - Each step advances index monotonically.
  - Final step deletes `formgen_active_queue` from `storage.local`.

#### `TC-T4-SCEN-03` — Modern Reactive SPA Controlled Form (React / Vue Simulation)
- **Context**: A modern single-page application built with React 19 where inputs are strictly controlled components with `value={state}` and `onChange={(e) => setState(e.target.value)}`. Standard vanilla `.value = ...` fails because React's `_valueTracker` detects no user typing.
- **Flow**:
  1. User targets `#form-reactive`.
  2. FormGen identifies reactive inputs.
  3. Injects values using `HTMLInputElement.prototype` setter bypass and clears `_valueTracker`.
  4. Dispatches bubbling `input` and `change` events.
  5. React state updater listener fires and updates `reactiveState`.
  6. DOM mirror `<pre id="reactive-state-output">` updates.
- **Assertions**:
  - `window.__FORMGEN_FIXTURE__.getReactiveState().reactiveName !== ''`.
  - DOM mirror content matches injected data.
  - Form validation passes.

#### `TC-T4-SCEN-04` — Adversarial E-Commerce Checkout with Anti-Bot Honeypots & Traps
- **Context**: An e-commerce checkout page `#form-edge-cases` containing hidden anti-bot honeypot fields (`style="display:none"`, `left: -9999px`), disabled coupon code input, readonly transaction token, and CSRF token. If a bot fills the honeypot, the checkout is blocked.
- **Flow**:
  1. FormGen scans `#form-edge-cases`.
  2. Scanner visibility checks detect and filter out all honeypots and hidden CSRF tokens.
  3. Scanner marks `#edge-disabled` and `#edge-readonly` as non-fillable.
  4. FormGen generates data and fills legitimate inputs.
- **Assertions**:
  - Honeypot inputs remain strictly empty (`value === ""`).
  - Readonly input value remains untouched.
  - Disabled input remains untouched.
  - All legitimate visible inputs receive valid synthetic values.

#### `TC-T4-SCEN-05` — Multi-Tab Concurrency & Queue Discard Flow
- **Context**: A user working with multiple browser tabs concurrently.
- **Flow**:
  1. Tab 1 opens `test-fixture.html` -> generates 10 records -> queue is at `[2/10]`.
  2. Tab 2 opens a different page or form -> opens popup -> observes IDLE state.
  3. User returns to Tab 1 -> popup displays `Inserir registro [2/10]`.
  4. User clicks "Descartar fila".
  5. Storage active queue is deleted; button reverts to "Gerar dados".
- **Assertions**:
  - No cross-tab queue bleeding.
  - Discard operation completely purges storage.
  - Form inputs on Tab 1 retain previously filled data.

---

## 4. Comprehensive HTML Test Fixture Specification (`tests/fixtures/test-fixture.html`)

The standalone test fixture is a self-contained, offline-first HTML5 application containing no external dependencies or CDN links.

### Structural Architecture

```
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>FormGen Standalone HTML Test Fixture</title>
  <style>/* Clean modern responsive layout, panel grid, badges, event console */</style>
</head>
<body>
  <header><h1>FormGen Test Fixture Harness</h1></header>
  <main class="grid-container">
    <!-- Panel 1: Canonical Enterprise Form -->
    <section class="card" id="panel-enterprise">
      <h2>1. Canonical Enterprise Form (#form-enterprise)</h2>
      <form id="form-enterprise" novalidate>
        <!-- Text, Email, Number, Tel, Date, Selects, Radio Group, Checkboxes, Textarea -->
      </form>
    </section>

    <!-- Panel 2: Reactive State Simulator -->
    <section class="card" id="panel-reactive">
      <h2>2. Reactive State Simulator (#form-reactive)</h2>
      <form id="form-reactive">
        <!-- Controlled inputs with React/Vue _valueTracker emulation -->
      </form>
      <div class="state-mirror">
        <h3>DOM State Mirror</h3>
        <pre id="reactive-state-output">{}</pre>
      </div>
    </section>

    <!-- Panel 3: Label Association & Adversarial Edge Cases -->
    <section class="card" id="panel-edge-cases">
      <h2>3. Edge Cases & Honeypots (#form-edge-cases)</h2>
      <form id="form-edge-cases">
        <!-- Tiers 1-7 labels, honeypots, hidden CSRF, disabled, readonly -->
      </form>
      <!-- Orphan control outside form -->
      <div class="orphan-container">
        <label for="orphan-input">Orphan Input Outside Form</label>
        <input id="orphan-input" type="text" placeholder="Orphan field">
      </div>
    </section>

    <!-- Panel 4: Interactive Verification Console & Event Logger -->
    <section class="card full-width" id="panel-console">
      <h2>4. Verification Console & Captured Events</h2>
      <div class="console-actions">
        <button id="btn-reset-logs">Reset Logs</button>
        <button id="btn-validate-all">Validate All Forms</button>
        <span id="event-counter-badge" class="badge">0 events captured</span>
      </div>
      <table id="table-events">
        <thead>
          <tr>
            <th>Time</th><th>Target ID</th><th>Target Name</th><th>Event</th>
            <th>Value</th><th>Checked</th><th>Bubbles</th><th>Composed</th>
          </tr>
        </thead>
        <tbody id="tbody-events"></tbody>
      </table>
    </section>
  </main>
  <script>/* Event logger & window.__FORMGEN_FIXTURE__ harness */</script>
</body>
</html>
```

### Complete Specification of Controls in `#form-enterprise`

| Field ID | Type | Name | Validation Constraints & Attributes | Label Strategy |
|:---|:---|:---|:---|:---|
| `ent-fullname` | `text` | `fullname` | `required`, `minlength="3"`, `maxlength="50"`, `autocomplete="name"` | Tier 1 (`label[for]`) "Nome Completo *" |
| `ent-email` | `email` | `email` | `required`, `autocomplete="email"`, `placeholder="usuario@dominio.com"` | Tier 1 (`label[for]`) "E-mail Corporativo *" |
| `ent-age` | `number` | `age` | `required`, `min="18"`, `max="120"`, `step="1"` | Tier 1 (`label[for]`) "Idade (anos) *" |
| `ent-phone` | `tel` | `phone` | `pattern="\(\d{2}\) \d{4,5}-\d{4}"`, `placeholder="(11) 98765-4321"` | Tier 1 (`label[for]`) "Telefone Comercial" |
| `ent-birthdate` | `date` | `birthdate` | `min="1950-01-01"`, `max="2026-12-31"` | Tier 1 (`label[for]`) "Data de Nascimento" |
| `ent-state` | `select` | `state` | `required`, options: `['', 'SP', 'RJ', 'MG', 'RS', 'PR']` | Tier 1 (`label[for]`) "Estado (UF) *" |
| `ent-skills` | `select[multiple]` | `skills` | `multiple`, options: `['javascript', 'typescript', 'python', 'rust', 'go']` | Tier 1 (`label[for]`) "Habilidades Técnicas" |
| `ent-contract-clt` | `radio` | `contract_type` | `value="clt"`, required | Tier 5 (`<fieldset><legend>`) "Tipo de Contrato *" |
| `ent-contract-pj` | `radio` | `contract_type` | `value="pj"` | Tier 5 (`<fieldset><legend>`) "Tipo de Contrato *" |
| `ent-contract-est` | `radio` | `contract_type` | `value="estagio"` | Tier 5 (`<fieldset><legend>`) "Tipo de Contrato *" |
| `ent-newsletter` | `checkbox` | `newsletter` | `value="1"` | Tier 2 (Wrapping `<label>`) "Desejo receber novidades" |
| `ent-terms` | `checkbox` | `terms` | `required`, `value="accepted"` | Tier 2 (Wrapping `<label>`) "Concordo com os termos *" |
| `ent-bio` | `textarea` | `bio` | `maxlength="500"`, `placeholder="Breve resumo profissional"` | Tier 1 (`label[for]`) "Biografia Resumida" |

### Test Harness API: `window.__FORMGEN_FIXTURE__`

```javascript
window.__FORMGEN_FIXTURE__ = {
  version: "1.0.0",
  events: [],
  
  // Event inspection
  getCapturedEvents: function() {
    return this.events.slice();
  },
  getEventsByTarget: function(targetId) {
    return this.events.filter(e => e.targetId === targetId);
  },
  getEventsByType: function(eventType) {
    return this.events.filter(e => e.type === eventType);
  },
  
  // Reactive state inspection
  getReactiveState: function() {
    return JSON.parse(JSON.stringify(window.__REACTIVE_STATE__ || {}));
  },
  
  // Validation checks
  isFormValid: function(formId) {
    const el = document.getElementById(formId);
    return el ? el.checkValidity() : false;
  },
  
  // Form value inspection
  getFormValues: function(formId) {
    const form = document.getElementById(formId);
    if (!form) return {};
    const formData = new FormData(form);
    const result = {};
    for (const [k, v] of formData.entries()) {
      if (result[k]) {
        if (!Array.isArray(result[k])) result[k] = [result[k]];
        result[k].push(v);
      } else {
        result[k] = v;
      }
    }
    return result;
  },
  
  // Log management
  resetLogs: function() {
    this.events = [];
    const tbody = document.getElementById('tbody-events');
    if (tbody) tbody.innerHTML = '';
    const badge = document.getElementById('event-counter-badge');
    if (badge) badge.textContent = '0 events captured';
  },
  
  // Event recording internal handler
  logEvent: function(evt) {
    const target = evt.target;
    const entry = {
      timestamp: Number(performance.now().toFixed(2)),
      targetId: target.id || '',
      targetName: target.name || '',
      tagName: target.tagName.toLowerCase(),
      type: evt.type,
      value: target.value !== undefined ? target.value : null,
      checked: target.checked !== undefined ? target.checked : null,
      bubbles: evt.bubbles,
      composed: evt.composed,
      isTrusted: evt.isTrusted
    };
    this.events.push(entry);
    
    // Render to console table
    const tbody = document.getElementById('tbody-events');
    if (tbody) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${entry.timestamp}</td>
        <td><code>${entry.targetId || '-'}</code></td>
        <td><code>${entry.targetName || '-'}</code></td>
        <td><span class="badge badge-${entry.type}">${entry.type}</span></td>
        <td>${String(entry.value).substring(0, 30)}</td>
        <td>${entry.checked !== null ? entry.checked : '-'}</td>
        <td>${entry.bubbles}</td>
        <td>${entry.composed}</td>
      `;
      tbody.prepend(tr);
      if (tbody.children.length > 200) tbody.removeChild(tbody.lastChild);
    }
    const badge = document.getElementById('event-counter-badge');
    if (badge) badge.textContent = `${this.events.length} events captured`;
  }
};
```

---

## 5. Automated Headless Test Runner Architecture

### Tooling Strategy & Rationale

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FormGen Test Architecture                       │
├──────────────────────────────────┬─────────────────────────────────────┤
│    Fast Unit / Component Tests   │     End-to-End Browser Tests        │
│       (Vitest + Happy-DOM)       │   (Puppeteer / Headless Chrome 149) │
├──────────────────────────────────┼─────────────────────────────────────┤
│ • Scanner algorithm validation   │ • Full Manifest V3 extension load   │
│ • 7-Tier label cascade           │ • Background Service Worker lifecycle│
│ • Prompt engine JSON structure   │ • Real chrome.storage coordination  │
│ • JSON repair & trailing commas  │ • Content script DOM injection      │
│ • Native prototype setter unit   │ • Real synthetic event propagation  │
│ • Speed: ~1.5 seconds            │ • Speed: ~6.0 seconds               │
└──────────────────────────────────┴─────────────────────────────────────┘
```

1. **Why Google Chrome 149 (`/usr/bin/google-chrome`) with Puppeteer?**
   - Manifest V3 extensions rely on Chrome's Service Worker architecture (`background.service_worker`) and extension APIs (`chrome.storage`, `chrome.scripting`, `chrome.runtime`). JSDOM or Happy-DOM cannot run Chrome Extension APIs or unpack MV3 CRX/folders.
   - Chrome 149 supports modern headless mode (`--headless=new`) which fully supports extension loading via `--disable-extensions-except` and `--load-extension`.
2. **Headless Chrome Launch Parameters**:
   ```javascript
   const browser = await puppeteer.launch({
     executablePath: '/usr/bin/google-chrome',
     headless: 'new',
     args: [
       `--disable-extensions-except=${EXTENSION_DIST_PATH}`,
       `--load-extension=${EXTENSION_DIST_PATH}`,
       '--no-sandbox',
       '--disable-setuid-sandbox',
       '--disable-dev-shm-usage',
       '--disable-gpu',
       '--window-size=1280,800'
     ]
   });
   ```

### E2E Test Runner Implementation (`tests/e2e/runner.mjs`)

The runner executes a standalone Node.js script that:
1. Spawns a lightweight HTTP server serving `tests/fixtures/test-fixture.html` on `http://localhost:8080/test-fixture.html`.
2. Launches headless Google Chrome with FormGen unpacked from `dist/`.
3. Navigates to the test fixture.
4. Executes the complete 4-Tier test suite:
   - Scans DOM via extension messaging and asserts Lean Schema.
   - Generates 1 record and asserts immediate fill + event dispatch in `window.__FORMGEN_FIXTURE__`.
   - Generates 10 records and asserts queue stepping `[2/10]` -> `[3/10]` -> auto-purge.
   - Asserts reactivity mirror updates in `#form-reactive`.
   - Asserts zero honeypot corruption in `#form-edge-cases`.
5. Exits with 0 on 100% pass, or code 1 with failure diff.

---

## 6. Verification Commands & Execution Target

The following commands are standardized for local development and CI:

| Command | Target | Scope |
|:---|:---|:---|
| `npm run test:unit` | Vitest | Unit tests for scanner, AI parser, queue, and injector |
| `npm run test:e2e` | Puppeteer + Chrome 149 | Headless E2E verification against `test-fixture.html` |
| `npm test` | All | Runs `npm run test:unit && npm run test:e2e` |

These commands and prerequisites will be codified in `TEST_READY.md` upon test harness instantiation.

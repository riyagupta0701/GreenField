# GreenField

A VS Code extension that detects **unused ("dead") JSON fields** between frontend and backend codebases. Fields the backend sends but the frontend never reads — and vice versa — are flagged as inline diagnostics with estimated wasted bytes and CO₂ impact.

> TU Delft "Hacking Sustainability"  project for Sustainable Software Engineering.

---

## Motivation

Modern web apps frequently transmit more data than the frontend consumes. If a backend sends `{ id, name, email, lastLoginIp }` but the frontend only reads `name` and `email`, then `id` and `lastLoginIp` are dead fields — wasted bandwidth, CPU, and energy at scale. GreenField detects these automatically via static analysis.

---

## Supported Stack

| Layer    | Supported |
|----------|-----------|
| Frontend | TypeScript / JavaScript (React, Vue, fetch / axios / doFetch) |
| Backend  | Python (Flask, FastAPI), Java (Spring Boot), Node.js (Express), Go (Gin, Gorilla Mux, net/http) |
| API      | REST / JSON |
| Workspace | VS Code monorepo or multi-root workspace |

---

## Reproducibility

### Prerequisites

- Node.js ≥ 18, npm ≥ 9

```bash
git clone <repo-url>
cd greenfield
npm install
npm test              # compiles dist-test/ and runs all unit tests
```

---

## Running the Extension

1. Open the GreenField project folder in VS Code (`File → Open Folder`)
2. Press `F5` — this launches the **Extension Development Host** (a second VS Code window)
3. In that second window, open the project you want to scan
4. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
5. Run **`GreenField: Scan Workspace`**

The extension scans all `.ts/.tsx/.js/.jsx/.py/.java/.go` files, maps API endpoints, extracts field definitions and usages, and reports dead fields as inline diagnostics.

For scanning a project without VS Code, use the standalone CLI: `node scripts/scan.js <path-to-project>`. It runs the same analysis pipeline and prints a structured summary of endpoints, dead fields, wasted bytes/day, and CO₂ estimate.

---

## Development

```bash
npm run compile   # compile src/ → dist/
npm run watch     # incremental compile on save
npm test          # compile test build → dist-test/, then run all tests
npm run package   # package as .vsix
```

**Two tsconfigs:**
- `tsconfig.json` — compiles `src/` → `dist/` (extension)
- `tsconfig.test.json` — compiles `src/` + `test/` → `dist-test/` (tests); maps the `vscode` module to `test/__mocks__/vscode.ts`

---

## Tests

```bash
npm test
```

Run a single test file:

```bash
npx mocha 'dist-test/test/suite/fieldExtractor.test.js' --timeout 10000
```

| Test file | What it covers |
|-----------|----------------|
| `fieldExtractor.test.ts` | TS/JS frontend field extraction (axios, fetch + JSON.stringify) |
| `usageTracker.test.ts` | TS/JS usage tracking (destructuring, optional chaining, JSX) |
| `pythonFieldExtractor.test.ts` | Python backend field extraction (Flask, FastAPI, Pydantic) |
| `pythonUsageTracker.test.ts` | Python usage tracking (request.json.get, bracket access, Pydantic params) |
| `javaFieldExtractor.test.ts` | Java field extraction (DTO fields, @JsonProperty, Map.of()) |
| `javaUsageTracker.test.ts` | Java usage tracking (@RequestBody, @RequestParam, getParameter) |
| `goFieldExtractor.test.ts` | Go field extraction (gin.H, map literals, response structs) |
| `goUsageTracker.test.ts` | Go usage tracking |
| `diffEngine.test.ts` | computeDiff, scoreWaste, estimateCO2kWh, runDiff |
| `integration.test.ts` | End-to-end: endpoint mapping → extraction → tracking → diff |

Test fixtures are in `test/suite/fixtures/unit/`.

---

## Architecture

```
Workspace
   ↓
Endpoint Mapper       — detects fetch/axios/Express/Flask/Spring/Gin routes; normalizes :id/{id}/${id} → :param
   ↓
Field Extractors      — extracts request/response field names (ts-morph for TS/JS; regex for Python, Java, Go)
   ↓
Usage Tracker         — detects which fields are actually read on the receiving side
   ↓
Diff Engine           — dead_fields = defined − accessed; scores waste in bytes/day and CO₂/day
   ↓
VS Code Diagnostics   — inline squiggles, hover messages, status bar summary
```

**Waste scoring:**
```
waste_score  = avg_field_bytes × daily_requests
CO₂/day      = wasted_bytes/day × 0.000000006 kWh/byte   (Aslan et al. 2018)
```

Default assumptions: 32 bytes/field, 10,000 requests/day.

### Repository Structure

```
src/
 ├ endpointMapper/     # route detection + URL normalization
 ├ diffEngine/         # differ.ts, scorer.ts, index.ts
 ├ parsers/
 │   ├ typescript/     # fieldExtractor.ts, usageTracker.ts, backendFieldExtractor.ts
 │   ├ python/         # fieldExtractor.ts, usageTracker.ts
 │   ├ java/           # fieldExtractor.ts, usageTracker.ts
 │   └ go/             # fieldExtractor.ts, usageTracker.ts
 ├ ui/                 # statusBar.ts
 ├ types.ts            # shared Endpoint, Field, FieldSet interfaces
 └ extension.ts        # activation entry point

test/
 ├ __mocks__/vscode.ts
 ├ suite/
 │   ├ fixtures/       # real source files used as parser inputs
 │   └ *.test.ts
 └ benchmarks/synthetic/
```

---

### RQ1 — Accuracy on Synthetic Benchmarks

```bash
# Generate 20 synthetic benchmark projects
npx ts-node test/benchmarks/synthetic/generate.ts

# Run evaluation (precision + recall per project)
npx ts-node evaluation/run.ts
```

Each project has a backend file (TS, Python, Java, or Go), a frontend TS file, and an `expected.json` ground-truth.

### RQ2 — Real-World Prevalence

**Mattermost** (React + Redux / Go):

| Metric | Value |
|--------|-------|
| Files scanned | 4,796 TS / 1,966 Go |
| Endpoints mapped | 457 |
| Response fields scanned | 8,344 |
| Dead fields | 4,178 |
| Est. wasted bytes/day | ~1,218,340.0 KB |
| Est. CO₂ waste | ~73.1 Wh/day |
| Analysis mode | Global fallback |

> Mattermost uses a two-level sub-router pattern that prevents full URL reconstruction from a single file, so per-endpoint analysis is unavailable. Results use the global fallback (all Go response fields vs all frontend-accessed names).

**freeCodeCamp** (TypeScript / Node.js):

| Metric | Value |
|--------|-------|
| Files scanned | 1,085 TS |
| Endpoints mapped | 7 |
| Response fields scanned | 55 |
| Dead fields | 16 |
| Est. wasted bytes/day | ~3,520 KB |
| Est. CO₂ waste | ~0.21 Wh/day |
| Analysis mode | Global fallback |

> Like Mattermost, freeCodeCamp also uses the global fallback analysis.

# GreenField

**GreenField** is a VS Code extension that detects **unused JSON fields between frontend and backend codebases**, highlighting wasted network payload and unnecessary serialization work.

By statically analysing API calls and route handlers across a project, GreenField identifies fields that are transmitted but never used, helping developers improve **efficiency, sustainability, and maintainability**.


# Motivation

Modern web applications frequently transmit **more data than the frontend actually consumes**.

Example:

```json
{
  "id": 1,
  "name": "Alice",
  "email": "alice@test.com",
  "lastLoginIp": "192.168.1.10"
}
```

If the frontend only reads `name` and `email`, then `id` and `lastLoginIp` are **dead fields**. These cause unnecessary bandwidth usage, additional CPU parsing overhead, and wasted energy in large-scale systems. GreenField detects these automatically.


# Architecture

GreenField operates as a **static analysis pipeline inside VS Code**.

```
Workspace
   ↓
Endpoint Mapper
   ↓
Field Extractors
   ↓
Usage Tracker
   ↓
Diff Engine
   ↓
Sustainability Scorer
   ↓
VS Code Diagnostics
```


# Core Components

## 1. Endpoint Mapper

Builds a **canonical registry of API endpoints** by analysing both frontend and backend code.

**Frontend detection** — detects `fetch`, `axios.get/post/put/delete`, `doFetch` calls and extracts the URL.

**Backend detection** — detects Express `app.get/post/put/delete`, Flask `@app.route`, and Spring `@GetMapping/@PostMapping` and extracts the route pattern.

**URL normalization:**

| Input              | Normalized          |
| ------------------ | ------------------- |
| `/api/users/:id`   | `/api/users/:param` |
| `/api/users/{id}`  | `/api/users/:param` |
| `/api/users/<id>`  | `/api/users/:param` |
| `/api/users/${id}` | `/api/users/:param` |


## 2. Field Extractor

Extracts the fields a backend *sends* in responses, and the fields a frontend *sends* in request bodies.

**TypeScript/JavaScript** — uses `ts-morph` AST. Detects inline object literals in:

```ts
axios.post('/api/users', { username, email, password })

fetch('/api/orders', {
  method: 'POST',
  body: JSON.stringify({ customerId, items, notes })
})
```

**Python** — regex-based. Detects response fields from:

```python
return jsonify({"userId": 1, "email": "a@b.com"})   # Flask
return {"status": "ok", "token": "abc"}              # FastAPI direct dict
return JSONResponse(content={"id": 1, "name": "x"}) # FastAPI JSONResponse

class UserResponse(BaseModel):   # Pydantic model fields
    userId: int
    displayName: str
```

**Java** — regex-based. Detects response fields from:

```java
private String firstName;           // DTO class fields
@JsonProperty("phone_number")       // annotation overrides Java identifier
private String phoneNumber;

Map.of("userId", id, "name", name)  // Map.of()
map.put("displayName", value)       // HashMap.put()
```

## 3. Usage Tracker

Detects which fields are actually *read* on the receiving side.

**TypeScript/JavaScript** — uses `ts-morph` AST. Covers all frontend access patterns:

```ts
response.id                          // direct property access
response.user?.name                  // optional chaining
const { email, role } = response     // destructuring
const { createdAt: joinedAt } = res  // aliased destructuring → tracks "createdAt"
const { address: { city } } = res    // nested destructuring
`Hello ${user.firstName}`            // template literals
<p>{user.displayName}</p>            // JSX
```

**Python** — regex-based. Detects which request fields the backend reads:

```python
request.json.get('username')         # direct get
request.json['email']                # bracket access
data = request.json; data.get('x')   # indirect via variable
request.form.get('title')            # form fields
request.args.get('page')             # query params

def create(item: UserModel): ...     # Pydantic param — all model fields marked as accessed
```

**Java** — regex-based. Detects which request fields the backend reads:

```java
@RequestBody UserDto req             // getter calls: req.getFirstName() → "firstName"
req.firstName                        // direct field access
@RequestParam("query") String q      // explicit param name
@RequestParam String category        // param variable name used as field name
request.getParameter("authToken")    // servlet API
```

## 4. Go Parser

Regex-based parser for Go backends. Supports Gin, Gorilla Mux, and net/http routing patterns.

**Field extraction** — detects response fields from:

```go
c.JSON(200, gin.H{"userId": 1, "name": "Alice"})           // gin.H literal
w.Header().Set(...)
json.NewEncoder(w).Encode(map[string]interface{}{           // map literal
    "status": "ok", "token": token,
})

type UserResponse struct {                                  // response struct with json tags
    ID       int    `json:"id"`
    Username string `json:"username"`
    Email    string `json:"email"`
}
```

Request structs bound via `ShouldBindJSON` / `BindJSON` / `Decode` are automatically excluded from response field analysis.

**Usage tracking** — detects which fields the frontend reads from Go API responses (tracked via the TypeScript usage tracker on the frontend side).

## 5. Diff Engine

Located in `src/diffEngine/`. Computes dead fields and scores their sustainability impact.

```
dead_fields = defined_fields − accessed_fields
```

**`differ.ts`** — core set subtraction:
```typescript
computeDiff(defined: Field[], accessed: Field[]): Field[]
// Returns fields in `defined` whose name does not appear in `accessed`
// Case-sensitive. Does not mutate inputs.
```

**`scorer.ts`** — waste estimation:
```typescript
scoreWaste(field: Field, avgBytes: number, dailyRequests: number): number
// Returns avgBytes × dailyRequests (bytes wasted per day for one dead field)

estimateCO2kWh(wastedBytesPerDay: number): number
// Returns wastedBytesPerDay × 0.000000006 kWh
// Coefficient from Aslan et al. (2018)
```

**`index.ts`** — orchestrator:
```typescript
runDiff(fieldSet: FieldSet, avgBytes = 32, dailyRequests = 10_000): FieldSet
// Runs computeDiff, scores each dead field, returns new FieldSet with deadFields populated
// Does not mutate the original FieldSet
```

**Per-endpoint analysis** — for repos where the endpoint mapper successfully links backend files to frontend files via URL matching (TS/JS, Python, Java backends, and simpler Go services).

**Global fallback analysis** — for repos with complex routing (e.g. Mattermost's Go sub-router pattern), the extension also runs a workspace-wide comparison: all backend response fields across all files vs all frontend-accessed field names. This surfaces dead fields even when URL matching fails.

## 6. Sustainability Scorer

```
waste_score     = avg_field_bytes × daily_requests        (bytes/day per dead field)
CO₂/day         = total_wasted_bytes × 0.000000006 kWh/byte
```

Default assumptions: 32 bytes/field, 10,000 requests/day. Both are configurable when calling `runDiff`.

CO₂ coefficient from Aslan et al. (2018), surfaced as an estimate.

# Supported Stack

| Layer | Support |
|---|---|
| Frontend | TypeScript / JavaScript (React, Vue, fetch / axios / doFetch) |
| Backend | Python (Flask, FastAPI), Java (Spring Boot), Node.js (Express), Go (Gin, Gorilla Mux, net/http) |
| API style | REST / JSON |


# Repository Structure

```
src/
 ├ endpointMapper/
 │   ├ backendDetector.ts      # Express / Flask / Spring / Gin / Gorilla / net/http route detection
 │   ├ frontendDetector.ts     # fetch / axios / doFetch call detection
 │   ├ urlNormalizer.ts        # :id / {id} / ${id} → :param
 │   └ index.ts
 ├ diffEngine/
 │   ├ differ.ts               # computeDiff — set subtraction
 │   ├ scorer.ts               # scoreWaste, estimateCO2kWh
 │   └ index.ts                # runDiff — orchestrator
 ├ parsers/
 │   ├ typescript/
 │   │   ├ fieldExtractor.ts          # request body fields (axios / fetch)
 │   │   ├ usageTracker.ts            # response field access patterns
 │   │   ├ backendFieldExtractor.ts   # TS backend res.json({...}) extraction
 │   │   └ index.ts
 │   ├ python/
 │   │   ├ fieldExtractor.ts   # jsonify / JSONResponse / Pydantic BaseModel
 │   │   └ usageTracker.ts     # request.json.get / request.form / @RequestParam
 │   ├ java/
 │   │   ├ fieldExtractor.ts   # DTO fields / @JsonProperty / Map.of() / .put()
 │   │   └ usageTracker.ts     # @RequestBody getters / @RequestParam / getParameter()
 │   └ go/
 │       ├ fieldExtractor.ts   # gin.H / map literals / response structs with json tags
 │       └ usageTracker.ts
 ├ ui/
 │   └ statusBar.ts
 ├ types.ts
 └ extension.ts

scripts/
 └ scan.js    # Standalone CLI scanner (no VS Code required)

test/
 ├ __mocks__/vscode.ts
 ├ suite/
 │   ├ fixtures/unit/          # real source files used as parser inputs
 │   └ *.test.ts               # unit + integration tests
 └ benchmarks/
     └ synthetic/
         └ generate.ts         # generates 20 benchmark projects dynamically
```


# Shared Interfaces

All components communicate through `src/types.ts`:

```typescript
interface Endpoint {
  pattern: string        // "GET /api/users/:param"
  method: string
  backendFile: string
  frontendFiles: string[]
}

interface Field {
  name: string
  side: 'request' | 'response'
  definedAt: string      // "path/to/file.ts:42"
  wasteScore?: number    // bytes × request volume
}

interface FieldSet {
  endpoint: Endpoint
  definedFields: Field[]
  accessedFields: Field[]
  deadFields?: Field[]
}
```


# Installation

```bash
git clone <repo-url>
cd GreenField
npm install
npm run compile
```


# Running the Extension

1. Open the GreenField project folder in VS Code (`File → Open Folder → select the GreenField directory`)

2. Press F5 — this opens a second VS Code window called the Extension Development Host

3. In that second window (not the original one), open a folder that contains the project you want to scan

4. In that second window, open the Command Palette with `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)

5. Type `GreenField: Scan Workspace` and press Enter

The extension scans all `.ts/.tsx/.js/.jsx/.py/.java` files and outputs a JSON endpoint registry.


# Standalone CLI Scanner

Run GreenField against any TypeScript project without VS Code:

```bash
node scripts/scan.js /path/to/project/
```

It prints endpoints, extracted fields, usage tracking, and dead field analysis in the terminal. 


# Development Workflow

```bash
npm run compile   # compile extension
npm test          # compile + run test suite
npm run watch     # incremental compile on save
F5                # launch Extension Development Host
```


# Running the Tests

```bash
npm test
```

This compiles the test build (`tsconfig.test.json` → `dist-test/`) and then runs all test files matching `dist-test/test/suite/**/*.test.js` with Mocha.

**Run a single test file:**

```bash
npx mocha 'dist-test/test/suite/pythonFieldExtractor.test.js' --timeout 10000
```

Replace the filename with any of the test files below.

**Test suites:**

| File | What it tests |
|---|---|
| `test/suite/fieldExtractor.test.ts` | TypeScript/JS frontend field extraction (axios, fetch + JSON.stringify) |
| `test/suite/usageTracker.test.ts` | TypeScript/JS frontend usage tracking (destructuring, optional chaining, JSX) |
| `test/suite/pythonFieldExtractor.test.ts` | Python backend field extraction (Flask `jsonify`, FastAPI `JSONResponse`, Pydantic `BaseModel`) |
| `test/suite/pythonUsageTracker.test.ts` | Python backend usage tracking (`request.json.get()`, bracket access, indirect access, Pydantic params) |
| `test/suite/javaFieldExtractor.test.ts` | Java backend field extraction (DTO fields, `@JsonProperty` override, `Map.of()`, `.put()`) |
| `test/suite/javaUsageTracker.test.ts` | Java backend usage tracking (`@RequestBody` getters + direct access, `@RequestParam`, `getParameter()`) |
| `test/suite/goFieldExtractor.test.ts` | Go backend field extraction (`gin.H`, map literals, response structs, bind-target exclusion) |
| `test/suite/goUsageTracker.test.ts` | Go backend usage tracking |
| `test/suite/diffEngine.test.ts` | Diff Engine: `computeDiff`, `scoreWaste`, `estimateCO2kWh`, `runDiff` — 22 unit tests |
| `test/suite/integration.test.ts` | End-to-end pipeline: endpoint mapping → field extraction → usage tracking → dead field diff |

**Test fixtures** (real source files the parsers run against) are in `test/suite/fixtures/unit/`.

# RQ1 — Benchmark Suite

The benchmark suite (`test/benchmarks/synthetic/`) validates diff engine accuracy across 20 synthetic projects covering all supported languages and dead field patterns.

**Generate the benchmarks:**

```bash
npx ts-node test/benchmarks/synthetic/generate.ts
```

This creates 20 project directories under `test/benchmarks/synthetic/`, each containing:
- A backend file (TypeScript, Python, Java, or Go) that defines response fields
- A frontend TypeScript file that accesses some of those fields
- A `fields.json` ground truth specifying which fields are dead

**Patterns covered:**

| Pattern | Description |
|---|---|
| Direct property access | `response.fieldName` |
| Destructuring | `const { a, b } = response` |
| Optional chaining | `response?.field` |
| JSX | `<p>{user.name}</p>` |
| Template literals | `` `${user.email}` `` |
| Dynamic access | `response[key]` (field not statically detectable) |
| Python backend | FastAPI / Flask response dicts |
| Java backend | Spring Boot DTO + `Map.of()` |

**Run the RQ1 evaluation:**

```bash
npx ts-node evaluation/rq1/run.ts
```

Reports per-project and aggregate **precision** and **recall** for dead field detection.


# Real-World Evaluation (RQ2)

GreenField has been run against a public open-source repository to validate detection at scale.

## Mattermost

A large-scale production codebase: React + Redux TypeScript frontend, Go backend.

| Metric | Value |
|---|---|
| Files scanned | 4,161 TS / 1,971 Go |
| Endpoints mapped | 455 |
| Request body fields found | 178 |
| Response fields tracked | 49,748 |
| Go dead response fields | 4,219 / 8,343 (51%) |
| Est. wasted bytes/request | ~101,256 bytes |
| Est. CO₂ waste @10k req/d | ~6,075 Wh/day |

> **Note:** Mattermost uses a two-level sub-router pattern (`api.BaseRoutes.X.Handle(...)`) where full URL paths are not present in a single file. The endpoint mapper cannot reconstruct them via single-file regex analysis, so per-endpoint dead field analysis is unavailable. The figures above come from the global fallback analysis (all Go response fields vs all frontend-accessed names). This is a known limitation documented as future work.

### To replicate:

```bash
git clone https://github.com/mattermost/mattermost.git
node scripts/scan.js /path/to/mattermost
```

## open-webui

A production AI chat application: Svelte/TypeScript frontend, Python (FastAPI) backend.

| Metric | Value |
|---|---|
| Files scanned | 72 TS / 223 Py |
| Endpoints mapped | 637 |
| Request body fields found | 153 |
| Response fields tracked | 690 |
| TS dead response fields | 85 / 106 (80%) |
| Est. wasted bytes/request | ~2,040 bytes |
| Est. CO₂ waste @10k req/d | ~122.4 Wh/day |

The Python FastAPI backend defines 106 response fields across its route handlers. GreenField detected 85 (80%) as dead — never accessed by the frontend. This demonstrates the tool working end-to-end on a real Python + TypeScript stack.

### To replicate:

```bash
git clone https://github.com/open-webui/open-webui.git
node scripts/scan.js /path/to/open-webui
```

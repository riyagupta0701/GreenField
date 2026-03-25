# GreenField — Technical Plan

## Goal
A VS Code extension that detects unused JSON fields between frontend and backend codebases, surfacing wasted network payload and serialization energy as inline editor diagnostics.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  VS Code Extension                   │
│                                                      │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────┐  │
│  │  AST Parser │──▶│  GreenField  │──▶│   VS Code│  │
│  │  (per lang) │   │    Engine    │   │   DiagAPI│  │
│  └─────────────┘   │              │   └──────────┘  │
│                    │ 1. Endpoint  │                  │
│  Languages:        │    Mapper    │   ┌──────────┐  │
│  - TS/JS           │ 2. Field     │──▶│  Panel + │  │
│    (ts-morph)      │    Extractor │   │  Report  │  │
│  - Python          │ 3. Usage     │   └──────────┘  │
│    (tree-sitter)   │    Tracker   │                  │
│  - Java            │ 4. Diff +    │                  │
│    (tree-sitter)   │    Scorer    │                  │
│                    └──────────────┘                  │
└─────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Endpoint Mapper
Builds a canonical map: `URL pattern → { backend handler, frontend callers }`.

- Frontend: detect `fetch`, `axios`, `useQuery`, `HttpClient` calls → extract URL + request body shape
- Backend: detect route decorators (`@GetMapping`, `@app.route`, `router.get`) → extract URL pattern
- Normalize URL params: `:id`, `{id}`, `<id>` → same canonical form

### 2. Field Extractor
For each endpoint, extract the set of fields *defined* on each side.

- Backend response: fields in returned JSON literals, DTOs, Pydantic models, Spring `@ResponseBody` classes
- Frontend request: fields in `JSON.stringify({...})`, axios body objects, form submission objects

### 3. Usage Tracker
For each endpoint, extract the set of fields *accessed* on each side.

Handles:
- Direct access: `response.email`
- Destructuring: `const { email, name } = response`
- Optional chaining: `response.user?.email`
- Template literals / JSX: `{user.name}`
- Backend request reading: `request.json.get('field')`, `data['field']`, Pydantic schema binding

Conservative rule: dynamic bracket access (`obj[key]`) → mark field as *possibly used*, do not flag.

### 4. Diff Engine + Scorer
```
dead_response_fields = Defined(backend response) − Accessed(frontend)
dead_request_fields  = Defined(frontend request) − Accessed(backend)
```

Each dead field gets a **waste score**:
```
score = avg_field_value_bytes × estimated_daily_requests
```
Used to prioritize findings by actual sustainability impact.

---

## Sustainability Metrics Surfaced

| Metric | How Computed |
|---|---|
| Wasted bytes/request | Dead fields × estimated avg value size |
| Est. CO₂/day | Wasted bytes × request volume × energy/byte coefficient (from literature) |
| Serialization overhead | Dead field count × parse cost heuristic |

The CO₂/day estimate uses the 0.000000006 kWh/byte coefficient from Aslan et al. (2018) as a reference point, surfaced transparently as an estimate with citation.

---

## VS Code Integration

- **Inline diagnostics**: warning squiggles on dead field definitions
- **Hover tooltip**: `"lastLoginIp" — never accessed by frontend. Estimated waste: ~24 bytes/req`
- **GreenField Panel**: per-endpoint breakdown (live vs dead fields, waste score)
- **Status bar**: `⚡ GreenField: 18 dead fields | ~3.1 KB/req wasted`
- **Quick fix**: suggested code action to remove the dead field

---

## Supported Stack (MVP)

| Layer | Supported |
|---|---|
| Frontend | TypeScript (React, Vue, fetch/axios) |
| Backend | Python (FastAPI, Flask), Node.js (Express), Java (Spring Boot) |
| API style | REST / JSON |
| Workspace | VS Code monorepo or multi-root workspace |

---

## Evaluation Plan

### RQ1
- To what extent do web applications transmit JSON fields that are not used?

### RQ2
- How effectively can static analysis identify and help reduce redundant JSON field transmission to improve efficiency and sustainability?
---

## Task Split (5 People, ~4 Weeks)

Tasks are designed to be independently developable against shared interfaces defined in Week 1.

### Person A — Extension Shell + Endpoint Mapper
- VS Code extension scaffolding (`package.json`, activation, commands)
- Endpoint mapping logic: frontend API call detection + backend route detection
- URL normalization and canonical endpoint registry
- Integration glue between all components

### Person B — TypeScript AST Parser
- Field extraction from frontend request bodies (fetch, axios, form objects)
- Usage tracking in frontend: destructuring, JSX, optional chaining, template literals
- Uses `ts-morph` for full TS compiler API access

### Person C — Python + Java AST Parser
- Field extraction from Flask/FastAPI/Spring response objects and DTOs
- Usage tracking in backend request handlers (Pydantic, `request.json`, Spring binding)
- Uses `tree-sitter` bindings for both languages

### Person D — Diff Engine + Sustainability Scorer
- Implements the diff between defined and accessed fields
- Waste scoring (bytes/request, CO₂/day estimate)
- Benchmark suite construction for RQ1 evaluation

### Person E — VS Code UI + Evaluation
- Diagnostic provider (inline squiggles, hover tooltips, quick fixes)
- GreenField panel (per-endpoint breakdown, waste summary)
- Status bar indicator
- Runs RQ2 and RQ3 evaluation on real repos; writes results section of paper

---

## Shared Interface (defined Week 1, owned by Person A)

```typescript
interface Endpoint {
  pattern: string                  // e.g. GET /api/users/:id
  backendFile: string
  frontendFiles: string[]
}

interface FieldSet {
  endpoint: Endpoint
  definedFields: Field[]           // what is sent
  accessedFields: Field[]          // what is read
  deadFields: Field[]              // diff result
}

interface Field {
  name: string
  side: 'request' | 'response'
  definedAt: Location
  wasteScore: number               // bytes × request volume
}
```

---

## 4-Week Timeline

| Week | Milestone |
|---|---|
| 1 | Shared interfaces defined; extension shell runs; each parser reads a hello-world project |
| 2 | End-to-end working on a single TypeScript + Node monorepo; inline diagnostics visible |
| 3 | Full stack support (Python, Java); panel + status bar complete; benchmark suite ready |
| 4 | RQ1–RQ3 evaluation complete; paper written; published to VS Code Marketplace |

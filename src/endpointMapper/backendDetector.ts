// Backend route detection
// Detects @GetMapping, @app.route, router.get, gin/gorilla/net/http → extracts URL pattern

import { normalizeUrl } from "./urlNormalizer";

export function detectBackendEndpoints(code: string) {

  const endpoints = []

  const expressRegex = /(?:app|router)\.(get|post|put|delete|patch)\(['"`](.*?)['"`]/g

  const chainedRegex = /(?:router|app)\.route\(['"`](.*?)['"`]\)\s*(?:\.[a-z]+\([^)]*\)\s*)*\.(get|post|put|delete|patch)\(/g

  const flaskRegex = /@app\.route\(['"`](.*?)['"`]/g

  const springRegex = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\(['"`](.*?)['"`]/g

  // Gin: r.GET("/path", handler) or router.POST("/path", handler)
  const ginRegex = /(?:\w+)\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\(\s*"([^"]+)"/g

  // Gorilla mux: .HandleFunc("/path", h).Methods("GET") or .Methods(http.MethodGet)
  // Also matches plain .Handle("/path", h).Methods(...) used by gorilla sub-routers.
  // NOTE: Mattermost-style two-level routing (api.BaseRoutes.X.Handle("relative", h))
  // can only produce relative path fragments here — full-path reconstruction requires
  // reading the PathPrefix sub-router definitions in a separate file (multi-file analysis,
  // not supported in single-file regex mode).
  const gorillaMuxRegex = /\.Handle(?:Func)?\(\s*"([^"]+)"[^)]*\)(?:[^.]*\.Methods\(\s*(?:"([A-Z]+)"|http\.Method([A-Za-z]+))\))?/g

  // net/http: http.HandleFunc("/path", handler) or http.Handle("/path", handler)
  // Deliberately narrow — generic .Handle() is covered by gorillaMuxRegex above.
  const netHttpRegex = /\bhttp\.Handle(?:Func)?\(\s*"([^"]+)"/g

  for (const match of code.matchAll(expressRegex)) {
    endpoints.push({ method: match[1].toUpperCase(), path: normalizeUrl(match[2]) })
  }

  for (const match of code.matchAll(chainedRegex)) {
    endpoints.push({ method: match[2].toUpperCase(), path: normalizeUrl(match[1]) })
  }

  for (const match of code.matchAll(flaskRegex)) {
    endpoints.push({ method: "GET", path: normalizeUrl(match[1]) })
  }

  for (const match of code.matchAll(springRegex)) {
    endpoints.push({
      method: match[1].replace("Mapping", "").toUpperCase(),
      path: normalizeUrl(match[2])
    })
  }

  for (const match of code.matchAll(ginRegex)) {
    endpoints.push({ method: match[1].toUpperCase(), path: normalizeUrl(match[2]) })
  }

  for (const match of code.matchAll(gorillaMuxRegex)) {
    // match[2] = string literal method e.g. "POST"
    // match[3] = http.Method* suffix e.g. "Post" from http.MethodPost
    const method = match[2] ?? (match[3] ? match[3].toUpperCase() : "GET")
    endpoints.push({ method, path: normalizeUrl(match[1]) })
  }

  for (const match of code.matchAll(netHttpRegex)) {
    endpoints.push({ method: "GET", path: normalizeUrl(match[1]) })
  }

  const seen = new Set<string>()
  return endpoints.filter(e => {
    const key = `${e.method} ${e.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

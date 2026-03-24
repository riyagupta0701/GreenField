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

  // Gorilla mux: r.HandleFunc("/path", handler).Methods("GET")
  const gorillaMuxRegex = /\.HandleFunc\(\s*"([^"]+)"[^)]*\)(?:[^.]*\.Methods\(\s*"([A-Z]+)"\))?/g

  // net/http: http.HandleFunc("/path", handler) or mux.Handle("/path", handler)
  const netHttpRegex = /(?:http\.HandleFunc|http\.Handle|\w+\.Handle(?:Func)?)\(\s*"([^"]+)"/g

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
    endpoints.push({
      method: match[2] ?? "GET",
      path: normalizeUrl(match[1])
    })
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

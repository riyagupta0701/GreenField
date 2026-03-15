// Frontend API call detection
// Detects fetch, axios, useQuery, HttpClient calls → extracts URL + request body shape

import { normalizeUrl } from "./urlNormalizer";

const ROUTE_HELPER_MAP: Record<string, string> = {
  getBaseRoute:                    '/api/v4',
  getUsersRoute:                   '/api/v4/users',
  getUserRoute:                    '/api/v4/users/:param',
  getTeamsRoute:                   '/api/v4/teams',
  getTeamRoute:                    '/api/v4/teams/:param',
  getTeamMembersRoute:             '/api/v4/teams/:param/members',
  getTeamMemberRoute:              '/api/v4/teams/:param/members/:param',
  getTeamSchemeRoute:              '/api/v4/teams/:param/scheme',
  getChannelsRoute:                '/api/v4/channels',
  getChannelRoute:                 '/api/v4/channels/:param',
  getChannelMembersRoute:          '/api/v4/channels/:param/members',
  getChannelMemberRoute:           '/api/v4/channels/:param/members/:param',
  getChannelSchemeRoute:           '/api/v4/channels/:param/scheme',
  getPostsRoute:                   '/api/v4/posts',
  getPostRoute:                    '/api/v4/posts/:param',
  getFilesRoute:                   '/api/v4/files',
  getFileRoute:                    '/api/v4/files/:param',
  getCommandsRoute:                '/api/v4/commands',
  getPreferencesRoute:             '/api/v4/users/:param/preferences',
  getReactionsRoute:               '/api/v4/reactions',
};

function resolveTemplateLiteralUrl(templateText: string): string | null {
  const helperMatch = templateText.match(/^\$\{this\.([a-zA-Z]+)\([^)]*\)\}(.*)$/);
  if (!helperMatch) return null;

  const helperName = helperMatch[1];
  const suffix = helperMatch[2].trim();

  const base = ROUTE_HELPER_MAP[helperName];
  if (!base) return null;

  return normalizeUrl(base + suffix);
}

function extractMethodFromOptions(optionsText: string): string {
  const methodMatch = optionsText.match(/\bmethod\s*:\s*['"`](\w+)['"`]/);
  return methodMatch ? methodMatch[1].toUpperCase() : 'GET';
}

export function detectFrontendEndpoints(code: string) {

  const endpoints = []

  const fetchRegex = /fetch\(['"`](.*?)['"`](?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/g
  for (const match of code.matchAll(fetchRegex)) {
    const path = normalizeUrl(match[1])
    const method = match[2] ? extractMethodFromOptions(match[2]) : 'GET'
    endpoints.push({ method, path })
  }

  const axiosRegex = /axios\.(get|post|put|delete|patch)\(['"`](.*?)['"`]/g
  for (const match of code.matchAll(axiosRegex)) {
    endpoints.push({ method: match[1].toUpperCase(), path: normalizeUrl(match[2]) })
  }

  const doFetchRegex = /this\.doFetch(?:WithResponse)?(?:<[^>]+>)?\(\s*([\s\S]*?),\s*(\{[\s\S]*?\})\s*\)/g
  for (const match of code.matchAll(doFetchRegex)) {
    const urlExpr     = match[1].trim()
    const optionsText = match[2]
    const method      = extractMethodFromOptions(optionsText)

    const plainStr = urlExpr.match(/^['"]([^'"]+)['"]$/)
    if (plainStr) {
      endpoints.push({ method, path: normalizeUrl(plainStr[1]) })
      continue
    }

    const tmplContent = urlExpr.match(/^`([\s\S]*?)`$/)
    if (tmplContent) {
      const resolved = resolveTemplateLiteralUrl(tmplContent[1])
      if (resolved) endpoints.push({ method, path: resolved })
      continue
    }
  }

  return endpoints
}

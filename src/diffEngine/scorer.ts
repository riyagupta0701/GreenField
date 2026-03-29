// score = estimated_field_bytes × estimated_daily_requests
// CO₂/day = wasted_bytes_per_day × 6×10⁻¹¹ kWh/byte  (Aslan et al. 2018, 0.06 kWh/GB fixed-line)
import { Field } from '../types';

/**
 * Estimate serialized JSON byte size of a field's value based on its name.
 * Uses naming heuristics since we perform static analysis without runtime data.
 *
 * Estimates derived from:
 *   - UUID/GUID: 36 chars (e.g. "550e8400-e29b-41d4-a716-446655440000")
 *   - ISO 8601 timestamps: 24 chars (e.g. "2024-01-15T10:30:00.000Z")
 *   - Email addresses: ~25 chars average
 *   - URLs: ~50 chars average
 *   - Boolean literals: 4–5 chars ("true"/"false")
 *   - Integers: ~4 chars average
 *   - General strings: ~20 chars average
 */
export function estimateFieldBytes(fieldName: string): number {
  const n = fieldName.toLowerCase();

  // Booleans
  if (/^(is|has|can|should|was|did|enabled|active|visible|deleted|verified|confirmed|success|failed|done)/.test(n)
      || n.endsWith('enabled') || n.endsWith('active') || n.endsWith('visible')) {
    return 5;
  }

  // UUIDs / entity IDs — check before integer tier to avoid *Id fields being misclassified
  if (n === 'id' || n.endsWith('id') || n.endsWith('uuid') || n.endsWith('guid') || /[_-]id$/.test(n)) {
    return 38; // 36 chars + 2 JSON quotes
  }

  // Integers / counts / scores
  if (/^(count|total|num|number|age|score|size|length|limit|offset|page|rank|index|version|code|status)/.test(n)
      || n.endsWith('count')) {
    return 6;
  }

  // Timestamps / dates
  if (/^(created|updated|deleted|modified|published|expires|started|ended|timestamp|date|time)/.test(n)
      || n.endsWith('at') || n.endsWith('date') || n.endsWith('time') || n.endsWith('timestamp')) {
    return 26; // ISO 8601: 24 chars + 2 JSON quotes
  }

  // Emails
  if (n.includes('email') || n.includes('mail')) {
    return 27;
  }

  // URLs / URIs / paths
  if (n.includes('url') || n.includes('uri') || n.includes('link') || n.includes('href') || n.includes('path')) {
    return 52;
  }

  // Tokens / hashes / secrets (typically hex or base64 — longer strings)
  if (n.includes('token') || n.includes('hash') || n.includes('secret') || n.includes('key') || n.includes('signature')) {
    return 66;
  }

  // Names / labels / titles
  if (n.includes('name') || n.includes('title') || n.includes('label') || n.includes('slug')) {
    return 22;
  }

  // Messages / descriptions / content (longer free-text)
  if (n.includes('message') || n.includes('description') || n.includes('content') || n.includes('body') || n.includes('text') || n.includes('bio')) {
    return 80;
  }

  // Objects / nested structures
  if (n.includes('data') || n.includes('meta') || n.includes('info') || n.includes('config') || n.includes('settings') || n.includes('options')) {
    return 64;
  }

  // Arrays / lists
  if (n.includes('list') || n.includes('items') || n.includes('array') || n.includes('tags') || n.includes('roles') || n.endsWith('s')) {
    return 40; // Conservative: small array with 2–3 elements
  }

  // Default: general string
  return 22;
}

/**
 * Estimate daily request volume for an endpoint based on its URL pattern.
 * Tiered heuristic — replace with real traffic data from API gateway metrics
 * (e.g. CloudWatch, Prometheus) when available.
 */
export function estimateDailyRequests(endpointPattern?: string): number {
  if (!endpointPattern) return 10_000;

  const p = endpointPattern.toLowerCase();

  // Health / status checks — hit very frequently by load balancers and monitors
  if (/\/(health|ping|status|ready|live)(\/|$)/.test(p)) return 100_000;

  // Auth endpoints — high traffic, hit on every session
  if (/\/(auth|login|logout|signin|signout|session|token|refresh)(\/|$)/.test(p)) return 50_000;

  // Admin / internal — low traffic by nature
  if (/\/(admin|internal|debug|metrics|_)(\/|$)/.test(p)) return 500;

  // Webhooks — event-driven, low volume
  if (/\/webhook/.test(p)) return 1_000;

  // Write operations (POST/PUT/PATCH/DELETE) — generally less frequent than reads
  if (/^(POST|PUT|PATCH|DELETE)/.test(endpointPattern)) return 5_000;

  // Default for general read endpoints
  return 10_000;
}

export function scoreWaste(field: Field, endpointPattern?: string): number {
  const bytes = estimateFieldBytes(field.name);
  const requests = estimateDailyRequests(endpointPattern);
  return bytes * requests;
}

// Aslan et al. (2018): 0.06 kWh/GB for fixed-line networks = 6×10⁻¹¹ kWh/byte
export const KWH_PER_BYTE = 6e-11; // Aslan 2018, fixed-line

export function estimateCO2kWh(wastedBytesPerDay: number): number {
  return wastedBytesPerDay * KWH_PER_BYTE;
}

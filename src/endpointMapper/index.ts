// Builds a canonical map: URL pattern → { backend handler, frontend callers }
import { Endpoint } from '../types';

import { detectBackendEndpoints } from "./backendDetector";
import { detectFrontendEndpoints } from "./frontendDetector";

type RegistryValue = {
  frontend: string[];
  backend: string[];
};

export function mapEndpoints(files: { path: string; content: string }[]): Endpoint[] {
  const registry = new Map<string, RegistryValue>();

  for (const file of files) {
    const frontend = detectFrontendEndpoints(file.content);
    const backend = detectBackendEndpoints(file.content);

    for (const ep of frontend) {
      const key = `${ep.method} ${ep.path}`;

      if (!registry.has(key)) {
        registry.set(key, { frontend: [], backend: [] });
      }

      const entry = registry.get(key)!;
      if (!entry.frontend.includes(file.path)) {
        entry.frontend.push(file.path);
      }
    }

    for (const ep of backend) {
      const key = `${ep.method} ${ep.path}`;

      if (!registry.has(key)) {
        registry.set(key, { frontend: [], backend: [] });
      }

      const entry = registry.get(key)!;
      if (!entry.backend.includes(file.path)) {
        entry.backend.push(file.path);
      }
    }
  }

  const endpoints: Endpoint[] = [];

  for (const [pattern, entry] of registry.entries()) {
    const method = pattern.split(" ")[0];

    endpoints.push({
      pattern,
      method,
      backendFile: entry.backend[0] ?? "",
      frontendFiles: entry.frontend
    });
  }

  endpoints.sort((a, b) => a.pattern.localeCompare(b.pattern));

  return endpoints;
}


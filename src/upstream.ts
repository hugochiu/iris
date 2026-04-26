import { config, type Upstream, type UpstreamId } from './config.js';
import { getActiveUpstreamId, setActiveUpstreamId } from './db/settings.js';

export function getActiveUpstream(): Upstream {
  const stored = getActiveUpstreamId();
  if (stored) {
    const found = config.upstreams.find((u) => u.id === stored);
    if (found) return found;
  }
  return config.upstreams[0];
}

export function setActiveUpstream(id: UpstreamId): Upstream {
  const found = config.upstreams.find((u) => u.id === id);
  if (!found) {
    throw new Error(`Unknown upstream: ${id}`);
  }
  setActiveUpstreamId(id);
  return found;
}

export function listUpstreams(): { items: { id: UpstreamId; name: string; baseUrl: string }[]; active: UpstreamId } {
  const active = getActiveUpstream();
  return {
    items: config.upstreams.map((u) => ({ id: u.id, name: u.name, baseUrl: u.baseUrl })),
    active: active.id,
  };
}

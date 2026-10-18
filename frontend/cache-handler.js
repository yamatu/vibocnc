// Bounded in-memory cache for ISR pages and the fetch Data Cache.
//
// Next's default handler also flushes every rendered page to .next/ on disk and
// never evicts it. With a catalogue of 100k+ products (x locales) that grows
// without limit inside the container. This handler keeps entries in memory
// only, evicts least-recently-used entries past a byte budget, and mirrors the
// default handler's tag-invalidation rules. A restart simply starts cold.

const MAX_BYTES = Math.max(16, Number(process.env.NEXT_CACHE_MAX_MB) || 256) * 1024 * 1024;
// One oversized entry must not flush everything else out of the cache.
const MAX_ENTRY_BYTES = Math.max(1, Number(process.env.NEXT_CACHE_MAX_ENTRY_MB) || 4) * 1024 * 1024;
const TAGS_HEADER = 'x-next-cache-tags';

const entries = new Map(); // key -> { value, lastModified, tags, size }
const tagRevalidatedAt = new Map(); // tag -> timestamp
let totalBytes = 0;

function byteLength(value) {
  if (!value) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (typeof value.byteLength === 'number') return value.byteLength;
  return 0;
}

function estimateSize(value) {
  if (!value || typeof value !== 'object') return 64;
  let size = 512;
  size += byteLength(value.html);
  size += byteLength(value.rscData);
  size += byteLength(value.body);
  if (value.segmentData instanceof Map) {
    for (const segment of value.segmentData.values()) size += byteLength(segment);
  }
  if (value.data && typeof value.data === 'object') size += byteLength(value.data.body);
  if (typeof value.postponed === 'string') size += byteLength(value.postponed);
  return size;
}

function headerTags(value) {
  const header = value && value.headers ? value.headers[TAGS_HEADER] : undefined;
  return typeof header === 'string' && header ? header.split(',') : [];
}

function isStale(tags, lastModified) {
  for (const tag of tags) {
    const revalidatedAt = tagRevalidatedAt.get(tag);
    if (typeof revalidatedAt === 'number' && revalidatedAt >= lastModified) return true;
  }
  return false;
}

function remove(key) {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  totalBytes -= entry.size;
}

module.exports = class BoundedMemoryCacheHandler {
  constructor(options) {
    this.revalidatedTags = (options && options.revalidatedTags) || [];
  }

  async get(key, ctx) {
    const entry = entries.get(key);
    if (!entry) return null;

    const kind = entry.value && entry.value.kind;
    let tags = entry.tags;
    if (kind === 'FETCH' && ctx) {
      tags = tags.concat(ctx.tags || [], ctx.softTags || []);
      if (tags.some((tag) => this.revalidatedTags.includes(tag))) {
        remove(key);
        return null;
      }
    }
    if (tags.length && isStale(tags, entry.lastModified)) {
      remove(key);
      return null;
    }

    // Refresh recency: Map iteration order is insertion order.
    entries.delete(key);
    entries.set(key, entry);
    return { value: entry.value, lastModified: entry.lastModified };
  }

  async set(key, data, ctx) {
    remove(key);
    if (!data) return;
    const size = estimateSize(data);
    if (size > MAX_ENTRY_BYTES) return;

    const tags = Array.from(new Set([...(ctx && ctx.tags ? ctx.tags : []), ...headerTags(data)]));
    entries.set(key, { value: data, lastModified: Date.now(), tags, size });
    totalBytes += size;

    for (const oldestKey of entries.keys()) {
      if (totalBytes <= MAX_BYTES) break;
      remove(oldestKey);
    }
  }

  async revalidateTag(tagOrTags) {
    const tags = (Array.isArray(tagOrTags) ? tagOrTags : [tagOrTags]).filter(Boolean);
    if (!tags.length) return;
    const now = Date.now();
    for (const tag of tags) tagRevalidatedAt.set(tag, now);
    for (const [key, entry] of entries) {
      if (entry.tags.some((tag) => tags.includes(tag))) remove(key);
    }
  }

  resetRequestCache() {}
};

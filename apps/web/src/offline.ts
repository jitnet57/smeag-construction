// ============================================================================
// OFFLINE-FIRST LAYER for the Supabase build
// ----------------------------------------------------------------------------
// Plugged into supabase-js as its `global.fetch`, so every table read, table
// write and storage upload passes through here.
//
//   Reads  (REST GET, cached RPCs)  network first → response saved in
//          IndexedDB. Network down → last saved response is served instead.
//   Writes (REST POST/PATCH/DELETE, storage upload/remove)  sent straight
//          away when online. Network down → stored in an outbox (IndexedDB)
//          and a synthetic success is returned, so the screen carries on.
//   Sync   the outbox is replayed in order when the browser comes back online,
//          every 30 s, and before any read while it is non-empty.
//   Overlay while writes are still queued, reads apply them to the cached
//          rows (eq/gte/lte/in filters), so entered data stays on screen.
// ============================================================================

const DB_NAME = 'brightem-offline';
const CACHE = 'cache';
const OUTBOX = 'outbox';
const READ_TIMEOUT_MS = 10_000;
const DEGRADED_MS = 20_000; // after a failure, skip the network for this long
const SYNC_INTERVAL_MS = 30_000;
const FAILED_KEY = 'brightem.sync.failed';

/** RPCs whose answers are safe to cache and replay offline (read-only). */
const CACHEABLE_RPC = new Set(['app_session', 'app_list_accounts']);

const nativeFetch: typeof fetch = (...args) => fetch(...args);

// ---- IndexedDB (tiny promise wrapper) --------------------------------------
let _db: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(CACHE)) d.createObjectStore(CACHE);
      if (!d.objectStoreNames.contains(OUTBOX))
        d.createObjectStore(OUTBOX, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

interface CacheEntry {
  table: string;
  body: string; // raw response text
  at: number;
}

type StoredBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'form'; entries: Array<[string, string | Blob, string?]> }
  | { kind: 'blob'; blob: Blob };

interface OutboxEntry {
  key?: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: StoredBody;
  table: string | null; // REST table, null for storage
  at: number;
}

// ---- status (for the header badge) -----------------------------------------
export interface SyncStatus {
  online: boolean;
  pending: number;
  syncing: boolean;
  failed: number;
}
let status: SyncStatus = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  syncing: false,
  failed: readFailed().length,
};
const listeners = new Set<(s: SyncStatus) => void>();
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
}
export function getSyncStatus(): SyncStatus {
  return status;
}
export function subscribeSync(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearFailed() {
  localStorage.removeItem(FAILED_KEY);
  setStatus({ failed: 0 });
}

function readFailed(): unknown[] {
  try {
    return JSON.parse(localStorage.getItem(FAILED_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function recordFailed(e: OutboxEntry, statusCode: number, text: string) {
  const list = readFailed();
  list.push({ url: e.url, method: e.method, status: statusCode, error: text.slice(0, 500), at: e.at });
  localStorage.setItem(FAILED_KEY, JSON.stringify(list.slice(-50)));
  setStatus({ failed: list.length });
  console.warn('[offline] queued write rejected by server', statusCode, e.url, text);
}

let degradedUntil = 0;
function networkLikelyDown(): boolean {
  return !navigator.onLine || Date.now() < degradedUntil;
}
function markDown() {
  degradedUntil = Date.now() + DEGRADED_MS;
  setStatus({ online: false });
}
function markUp() {
  degradedUntil = 0;
  setStatus({ online: true });
}

class OfflineError extends TypeError {
  constructor() {
    super('OFFLINE: network unavailable');
  }
}
/** True for errors caused by no network (as opposed to a server answer). */
export function isNetworkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e ?? '');
  return /OFFLINE|Failed to fetch|NetworkError|Load failed|network|timed? ?out/i.test(m);
}

// ---- request classification -----------------------------------------------
interface Parsed {
  url: URL;
  kind: 'rest' | 'rpc' | 'storage' | 'other';
  table: string | null;
  rpc: string | null;
}
function parse(url: string): Parsed {
  const u = new URL(url, location.href);
  const p = u.pathname;
  let m = p.match(/\/rest\/v1\/rpc\/([^/]+)$/);
  if (m) return { url: u, kind: 'rpc', table: null, rpc: m[1] };
  m = p.match(/\/rest\/v1\/([^/]+)$/);
  if (m) return { url: u, kind: 'rest', table: decodeURIComponent(m[1]), rpc: null };
  if (p.includes('/storage/v1/')) return { url: u, kind: 'storage', table: null, rpc: null };
  return { url: u, kind: 'other', table: null, rpc: null };
}

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h ?? {}).forEach((v, k) => (out[k] = v));
  return out;
}

async function storeBody(body: BodyInit | null | undefined): Promise<StoredBody> {
  if (body == null) return { kind: 'none' };
  if (typeof body === 'string') return { kind: 'text', text: body };
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const entries: Array<[string, string | Blob, string?]> = [];
    body.forEach((v, k) => {
      if (typeof v === 'string') entries.push([k, v]);
      else entries.push([k, v, (v as File).name]);
    });
    return { kind: 'form', entries };
  }
  if (body instanceof Blob) return { kind: 'blob', blob: body };
  return { kind: 'text', text: await new Response(body).text() };
}
function restoreBody(b: StoredBody): BodyInit | undefined {
  if (b.kind === 'none') return undefined;
  if (b.kind === 'text') return b.text;
  if (b.kind === 'blob') return b.blob;
  const fd = new FormData();
  for (const [k, v, name] of b.entries) {
    if (typeof v === 'string') fd.append(k, v);
    else fd.append(k, v, name);
  }
  return fd;
}

// ---- mini PostgREST filter evaluation (for the overlay) ---------------------
const NON_FILTER = new Set(['select', 'order', 'on_conflict', 'limit', 'offset', 'columns']);
type Filter = { col: string; op: string; val: string };

function filtersOf(u: URL): Filter[] {
  const out: Filter[] = [];
  u.searchParams.forEach((raw, col) => {
    if (NON_FILTER.has(col)) return;
    const i = raw.indexOf('.');
    if (i < 0) return;
    out.push({ col, op: raw.slice(0, i), val: raw.slice(i + 1) });
  });
  return out;
}

function cmp(a: unknown, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const sa = String(a);
  return sa < b ? -1 : sa > b ? 1 : 0;
}

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  for (const f of filters) {
    if (!(f.col in row)) continue; // unknown column → be lenient
    const v = row[f.col];
    switch (f.op) {
      case 'eq':
        if (v == null || cmp(v, f.val) !== 0) return false;
        break;
      case 'neq':
        if (v != null && cmp(v, f.val) === 0) return false;
        break;
      case 'gt':
        if (v == null || cmp(v, f.val) <= 0) return false;
        break;
      case 'gte':
        if (v == null || cmp(v, f.val) < 0) return false;
        break;
      case 'lt':
        if (v == null || cmp(v, f.val) >= 0) return false;
        break;
      case 'lte':
        if (v == null || cmp(v, f.val) > 0) return false;
        break;
      case 'is':
        if (f.val === 'null' ? v != null : String(v) !== f.val) return false;
        break;
      case 'in': {
        const list = f.val
          .replace(/^\(|\)$/g, '')
          .split(',')
          .map((s) => s.trim().replace(/^"|"$/g, ''));
        if (v == null || !list.some((x) => cmp(v, x) === 0)) return false;
        break;
      }
      default:
        break; // unsupported operator → lenient
    }
  }
  return true;
}

type Row = Record<string, unknown>;

function bodyRows(e: OutboxEntry): Row[] {
  if (e.body.kind !== 'text') return [];
  try {
    const v = JSON.parse(e.body.text);
    return Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
  } catch {
    return [];
  }
}

/** Apply one queued write to a list of rows from a GET with `readFilters`. */
function applyOp(rows: Row[], e: OutboxEntry, readFilters: Filter[]): Row[] {
  const u = new URL(e.url);
  if (e.method === 'POST') {
    const keys = (u.searchParams.get('on_conflict') ?? 'id').split(',');
    const now = new Date(e.at).toISOString();
    for (const nr of bodyRows(e)) {
      const i = rows.findIndex((r) =>
        keys.every((k) => nr[k] != null && r[k] != null && String(r[k]) === String(nr[k]))
      );
      if (i >= 0) {
        const merged = { ...rows[i], ...nr };
        if (matches(merged, readFilters)) rows[i] = merged;
        else rows.splice(i, 1);
      } else {
        const fresh = { created_at: now, ...nr };
        if (matches(fresh, readFilters)) rows.push(fresh);
      }
    }
    return rows;
  }
  const opFilters = filtersOf(u);
  if (e.method === 'PATCH') {
    const patch = bodyRows(e)[0] ?? {};
    return rows
      .map((r) => (matches(r, opFilters) ? { ...r, ...patch } : r))
      .filter((r) => matches(r, readFilters));
  }
  if (e.method === 'DELETE') return rows.filter((r) => !matches(r, opFilters));
  return rows;
}

async function overlay(table: string, url: URL, text: string, objectAccept: boolean): Promise<string> {
  const pending = (await outboxAll()).filter((e) => e.table === table);
  if (!pending.length) return text;
  let data: unknown;
  try {
    data = text === '' ? [] : JSON.parse(text);
  } catch {
    return text;
  }
  let rows: Row[] = Array.isArray(data) ? [...data] : data && typeof data === 'object' ? [data as Row] : [];
  const readFilters = filtersOf(url);
  for (const e of pending) rows = applyOp(rows, e, readFilters);
  return JSON.stringify(objectAccept ? rows[0] ?? null : rows);
}

// ---- cache ------------------------------------------------------------------
function cacheKey(method: string, url: string, body?: string): string {
  return body ? `${method} ${url} ${body}` : `${method} ${url}`;
}
const cacheGet = (k: string) => tx<CacheEntry | undefined>(CACHE, 'readonly', (s) => s.get(k));
const cachePut = (k: string, v: CacheEntry) => tx(CACHE, 'readwrite', (s) => s.put(v, k));

// ---- outbox -----------------------------------------------------------------
async function outboxAll(): Promise<OutboxEntry[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const out: OutboxEntry[] = [];
    const t = d.transaction(OUTBOX, 'readonly');
    const req = t.objectStore(OUTBOX).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      out.push({ ...(c.value as OutboxEntry), key: c.key as number });
      c.continue();
    };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}
const outboxAdd = (e: OutboxEntry) => tx(OUTBOX, 'readwrite', (s) => s.add(e));
const outboxDel = (k: number) => tx(OUTBOX, 'readwrite', (s) => s.delete(k));
const outboxPut = (k: number, e: OutboxEntry) =>
  tx(OUTBOX, 'readwrite', (s) => s.put({ ...e, key: undefined }, k));

function rowsText(e: OutboxEntry, rows: Row[], wasArray: boolean): { url: string; body: StoredBody } {
  const u = new URL(e.url);
  if (u.searchParams.has('columns')) {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    u.searchParams.set('columns', cols.map((c) => `"${c}"`).join(','));
  }
  return { url: u.toString(), body: { kind: 'text', text: JSON.stringify(wasArray ? rows : rows[0]) } };
}

/**
 * No duplicates in the queue: when an upsert is queued for a key (e.g. one
 * worker on one date) that an earlier queued upsert already holds, the old
 * row is folded into the new one and removed, so each key is sent once with
 * its latest values. Skipped while a sync is running (it holds a snapshot).
 */
async function compactUpserts(entry: OutboxEntry): Promise<OutboxEntry> {
  if (flushing || entry.method !== 'POST' || !entry.table) return entry;
  if (!(entry.headers['prefer'] ?? '').includes('resolution=merge-duplicates')) return entry;
  const u = new URL(entry.url);
  const conflict = u.searchParams.get('on_conflict');
  if (!conflict || entry.body.kind !== 'text') return entry;
  const keys = conflict.split(',');
  const keyOf = (r: Row) => keys.map((k) => String(r[k] ?? '')).join('\u0001');

  const newRows = bodyRows(entry);
  const wasArray = entry.body.text.trimStart().startsWith('[');
  const wanted = new Map(newRows.map((r, i) => [keyOf(r), i]));

  for (const old of await outboxAll()) {
    if (old.method !== 'POST' || old.table !== entry.table) continue;
    if (new URL(old.url).searchParams.get('on_conflict') !== conflict) continue;
    if (!(old.headers['prefer'] ?? '').includes('resolution=merge-duplicates')) continue;
    const oldRows = bodyRows(old);
    const keep: Row[] = [];
    for (const r of oldRows) {
      const i = wanted.get(keyOf(r));
      if (i === undefined) keep.push(r);
      else newRows[i] = { ...r, ...newRows[i] }; // later values win
    }
    if (keep.length === oldRows.length) continue;
    if (!keep.length) await outboxDel(old.key!);
    else {
      const oldWasArray = old.body.kind === 'text' && old.body.text.trimStart().startsWith('[');
      await outboxPut(old.key!, { ...old, ...rowsText(old, keep, oldWasArray) });
    }
  }
  return { ...entry, ...rowsText(entry, newRows, wasArray) };
}

async function refreshPending() {
  const n = await tx<number>(OUTBOX, 'readonly', (s) => s.count());
  setStatus({ pending: n });
  return n;
}

// Photos uploaded while offline: show the local copy until the upload lands.
const localPhotos = new Map<string, string>(); // public URL → blob: URL
function rememberLocalPhoto(e: OutboxEntry) {
  if (e.method !== 'POST' || !e.url.includes('/storage/v1/object/')) return;
  const blob =
    e.body.kind === 'blob'
      ? e.body.blob
      : e.body.kind === 'form'
        ? (e.body.entries.find(([, v]) => typeof v !== 'string')?.[1] as Blob | undefined)
        : undefined;
  if (!blob) return;
  const pub = e.url.replace('/storage/v1/object/', '/storage/v1/object/public/');
  localPhotos.set(pub, URL.createObjectURL(blob));
}
/** Swap a storage public URL for the local copy of a not-yet-synced upload. */
export function resolvePhotoUrl(url: string): string;
export function resolvePhotoUrl(url: string | undefined): string | undefined;
export function resolvePhotoUrl(url: string | undefined) {
  return (url && localPhotos.get(url)) || url;
}

// ---- sync -------------------------------------------------------------------
let flushing: Promise<boolean> | null = null;

/** Replay queued writes in order. Resolves true when the outbox is empty. */
export function flushOutbox(): Promise<boolean> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    if (!navigator.onLine) return false;
    try {
      // Loop so writes queued while a sync is running go out in the same pass.
      for (;;) {
        const entries = await outboxAll();
        if (!entries.length) return true;
        setStatus({ syncing: true });
        for (const e of entries) {
          let res: Response;
          try {
            res = await nativeFetch(e.url, {
              method: e.method,
              headers: e.headers,
              body: restoreBody(e.body),
            });
          } catch {
            markDown();
            return false;
          }
          markUp();
          if (res.status >= 500 || res.status === 429) {
            return false; // transient — keep it and retry later
          }
          if (!res.ok) recordFailed(e, res.status, await res.text().catch(() => ''));
          else sent++;
          await outboxDel(e.key!);
          await refreshPending();
        }
      }
    } finally {
      setStatus({ syncing: false });
      if (sent > 0) notifyDataChanged();
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// ---- "data changed" signal for screens ---------------------------------------
const DATA_EVENT = 'brightem:data-changed';
function notifyDataChanged() {
  window.dispatchEvent(new Event(DATA_EVENT));
}
const REFRESH_INTERVAL_MS = 30_000;
/**
 * Calls `refresh` whenever shared data may have changed: after this device
 * uploads its queued changes, when the connection comes back, when the tab
 * regains focus, and every 30 s while online (to pick up other devices'
 * uploads). Returns an unsubscribe function.
 */
export function onDataChanged(refresh: () => void): () => void {
  const run = () => {
    if (document.visibilityState === 'visible' && !networkLikelyDown()) refresh();
  };
  const onVisible = () => document.visibilityState === 'visible' && run();
  window.addEventListener(DATA_EVENT, refresh);
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(run, REFRESH_INTERVAL_MS);
  return () => {
    window.removeEventListener(DATA_EVENT, refresh);
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}

// ---- synthetic responses ----------------------------------------------------
function jsonResponse(text: string, statusCode = 200): Response {
  return new Response(statusCode === 204 ? null : text, {
    status: statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-offline': '1' },
  });
}

async function syntheticWriteResponse(e: OutboxEntry, p: Parsed, objectAccept: boolean): Promise<Response> {
  if (p.kind === 'storage') {
    if (e.method === 'DELETE') return jsonResponse('[]');
    const key = p.url.pathname.split('/storage/v1/object/')[1] ?? '';
    return jsonResponse(JSON.stringify({ Id: crypto.randomUUID(), Key: decodeURIComponent(key) }));
  }
  const wantsRows = (e.headers['prefer'] ?? '').includes('return=representation');
  if (!wantsRows) return jsonResponse('', 201);
  let rows: Row[];
  if (e.method === 'POST') {
    const now = new Date().toISOString();
    rows = bodyRows(e).map((r) => ({ created_at: now, ...r }));
  } else if (e.method === 'PATCH') {
    const f = filtersOf(p.url);
    const patch = bodyRows(e)[0] ?? {};
    // Cached rows plus every queued write (this PATCH is already queued).
    let all = await derivedRows(p.table!);
    for (const q of (await outboxAll()).filter((q) => q.table === p.table)) all = applyOp(all, q, []);
    const hit = all.filter((r) => matches(r, f));
    rows = hit.length ? [hit[0]] : [patch];
  } else {
    rows = [];
  }
  return jsonResponse(JSON.stringify(objectAccept ? rows[0] ?? null : rows), 201);
}

/** Give client-generated ids to plain inserts so later edits can target them. */
function withClientIds(p: Parsed, method: string, text: string): string {
  if (method !== 'POST' || p.kind !== 'rest' || p.url.searchParams.has('on_conflict')) return text;
  if (!UUID_ID_TABLES.has(p.table!)) return text;
  try {
    const v = JSON.parse(text);
    const add = (r: Row) => (r.id == null ? { id: crypto.randomUUID(), ...r } : r);
    return JSON.stringify(Array.isArray(v) ? v.map(add) : add(v));
  } catch {
    return text;
  }
}
const UUID_ID_TABLES = new Set(['tasks', 'material_requests', 'room_photos', 'task_assignments', 'material_stock', 'material_stock_moves']);

// ---- the fetch ----------------------------------------------------------------
async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS);
  init.signal?.addEventListener('abort', () => ctrl.abort());
  try {
    return await nativeFetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function handleRead(url: string, init: RequestInit, p: Parsed, key: string, table: string): Promise<Response> {
  const accept = new Headers(init.headers).get('accept') ?? '';
  const objectAccept = accept.includes('vnd.pgrst.object');
  if (status.pending > 0 && !networkLikelyDown()) await flushOutbox();

  if (!networkLikelyDown()) {
    try {
      const res = await timedFetch(url, init);
      markUp();
      if (!res.ok) return res;
      const text = await res.text();
      await cachePut(key, { table, body: text, at: Date.now() }).catch(() => undefined);
      const shown = p.kind === 'rest' && status.pending > 0 ? await overlay(table, p.url, text, objectAccept) : text;
      return new Response(shown, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' && init.signal?.aborted) throw err;
      markDown();
    }
  }
  const hit = await cacheGet(key).catch(() => undefined);
  let body = hit?.body;
  if (body === undefined && p.kind === 'rest') {
    // This exact query was never cached: answer it from rows other cached
    // queries on the same table returned (e.g. one employee by id).
    const rows = sortRows(
      (await derivedRows(table)).filter((r) => matches(r, filtersOf(p.url))),
      p.url.searchParams.get('order')
    );
    if (objectAccept && !rows.length) throw new OfflineError();
    body = JSON.stringify(objectAccept ? rows[0] : rows);
  }
  if (body === undefined) throw new OfflineError();
  const shown = p.kind === 'rest' ? await overlay(table, p.url, body, objectAccept) : body;
  return jsonResponse(shown);
}

/** Every distinct cached row of `table`, newest cache entry winning. */
async function derivedRows(table: string): Promise<Row[]> {
  const all = (await tx<CacheEntry[]>(CACHE, 'readonly', (s) => s.getAll()))
    .filter((c) => c.table === table)
    .sort((a, b) => b.at - a.at);
  const seen = new Map<string, Row>();
  for (const c of all) {
    let v: unknown;
    try {
      v = JSON.parse(c.body);
    } catch {
      continue;
    }
    const list: Row[] = Array.isArray(v) ? v : v && typeof v === 'object' ? [v as Row] : [];
    for (const r of list) {
      const k = r.id != null ? String(r.id) : JSON.stringify(r);
      const newer = seen.get(k);
      seen.set(k, newer ? { ...r, ...newer } : r); // older fills missing columns
    }
  }
  return [...seen.values()];
}

function sortRows(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const specs = order.split(',').map((s) => {
    const [col, dir] = s.split('.');
    return { col, desc: dir === 'desc' };
  });
  return rows.sort((a, b) => {
    for (const { col, desc } of specs) {
      const c = cmp(a[col] ?? '', String(b[col] ?? ''));
      if (c) return desc ? -c : c;
    }
    return 0;
  });
}

async function handleWrite(url: string, init: RequestInit, p: Parsed, method: string): Promise<Response> {
  const objectAccept = (new Headers(init.headers).get('accept') ?? '').includes('vnd.pgrst.object');
  const bodyIn = typeof init.body === 'string' ? withClientIds(p, method, init.body) : init.body;

  if (status.pending === 0 && !networkLikelyDown()) {
    try {
      const res = await nativeFetch(url, { ...init, body: bodyIn });
      markUp();
      return res;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      markDown();
    }
  }
  const entry: OutboxEntry = {
    url,
    method,
    headers: headersToObject(init.headers),
    body: await storeBody(bodyIn),
    table: p.kind === 'rest' ? p.table : null,
    at: Date.now(),
  };
  await outboxAdd(await compactUpserts(entry));
  rememberLocalPhoto(entry);
  await refreshPending();
  if (!networkLikelyDown()) void flushOutbox();
  return syntheticWriteResponse(entry, p, objectAccept);
}

/** Drop-in `fetch` for supabase-js. */
export const offlineFetch: typeof fetch = async (input, init = {}) => {
  if (typeof input !== 'string' && !(input instanceof URL)) return nativeFetch(input, init);
  const url = String(input);
  const p = parse(url);
  const method = (init.method ?? 'GET').toUpperCase();
  await ready;

  if (p.kind === 'rest') {
    if (method === 'GET') return handleRead(url, init, p, cacheKey(method, url), p.table!);
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') return handleWrite(url, init, p, method);
  }
  if (p.kind === 'rpc' && CACHEABLE_RPC.has(p.rpc!)) {
    const body = typeof init.body === 'string' ? init.body : '';
    return handleRead(url, init, p, cacheKey(method, url, body), `rpc:${p.rpc}`);
  }
  if (p.kind === 'storage' && p.url.pathname.includes('/storage/v1/object/') && (method === 'POST' || method === 'DELETE')) {
    return handleWrite(url, init, p, method);
  }
  // Everything else (login, account admin RPCs, …): network only.
  if (networkLikelyDown()) throw new OfflineError();
  try {
    const res = await nativeFetch(input, init);
    markUp();
    return res;
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') markDown();
    throw new OfflineError();
  }
};

// ---- startup ------------------------------------------------------------------
const ready: Promise<void> =
  typeof indexedDB === 'undefined'
    ? Promise.resolve()
    : (async () => {
        try {
          const all = await outboxAll();
          all.forEach(rememberLocalPhoto);
          setStatus({ pending: all.length });
        } catch (e) {
          console.warn('[offline] IndexedDB unavailable', e);
        }
      })();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    degradedUntil = 0;
    setStatus({ online: true });
    void flushOutbox();
  });
  window.addEventListener('offline', () => setStatus({ online: false }));
  setInterval(() => {
    if (status.pending > 0 && navigator.onLine) {
      degradedUntil = 0;
      void flushOutbox();
    }
  }, SYNC_INTERVAL_MS);
  void ready.then(() => flushOutbox());
}

// ---- offline login ----------------------------------------------------------
// After a successful online login the session is remembered against a hash of
// the credentials, so the same user can log in again on this device offline.
const CRED_KEY = 'brightem.offlineCreds';
async function credHash(username: string, password: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`brightem-offline:${username}:${password}`)
  );
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function readCreds(): Record<string, { hash: string; session: unknown }> {
  try {
    return JSON.parse(localStorage.getItem(CRED_KEY) ?? '{}');
  } catch {
    return {};
  }
}
export async function rememberOfflineLogin(username: string, password: string, session: unknown) {
  const u = username.trim().toLowerCase();
  const creds = readCreds();
  creds[u] = { hash: await credHash(u, password), session };
  localStorage.setItem(CRED_KEY, JSON.stringify(creds));
}
export async function offlineLogin<T>(username: string, password: string): Promise<T | null> {
  const u = username.trim().toLowerCase();
  const c = readCreds()[u];
  if (!c || c.hash !== (await credHash(u, password))) return null;
  return c.session as T;
}
/** The remembered session for `token`, if this device logged in with it. */
export function offlineSession<T>(token: string): T | null {
  const hit = Object.values(readCreds()).find((c) => (c.session as { token?: string })?.token === token);
  return (hit?.session as T) ?? null;
}
export function forgetOfflineLogin(username: string) {
  const creds = readCreds();
  delete creds[username.trim().toLowerCase()];
  localStorage.setItem(CRED_KEY, JSON.stringify(creds));
}

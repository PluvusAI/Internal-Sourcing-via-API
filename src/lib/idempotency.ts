// ---------------------------------------------------------------------------
// One idempotency key per intended search, kept across retries, timeouts and reloads
// ---------------------------------------------------------------------------
// A key is minted when "Find creators" / "Find more" is first clicked and stored for that list
// and kind until the source has accepted the search. A double click, a retry after a timeout or a
// reload re-sends the SAME key, so the source returns the same operation and never starts a second
// paid job. After acceptance the key is cleared: the next click is a genuinely new search.

export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const slot = (listId: string, kind: string): string => `isl:pending-op:${listId}:${kind}`;
const importSlot = (fingerprint: string): string => `isl:pending-import:${fingerprint}`;

function mint(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `op-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function pendingKey(store: KeyStore | null, listId: string, kind: "initial" | "find_more", fallback: Map<string, string>): string {
  const k = slot(listId, kind);
  const existing = safe(() => store?.getItem(k)) ?? fallback.get(k) ?? null;
  if (existing) return existing;
  const fresh = mint();
  fallback.set(k, fresh);
  safe(() => store?.setItem(k, fresh));
  return fresh;
}

export function clearKey(store: KeyStore | null, listId: string, kind: "initial" | "find_more", fallback: Map<string, string>): void {
  const k = slot(listId, kind);
  fallback.delete(k);
  safe(() => store?.removeItem(k));
}

/** A storage key for the exact import request, without retaining CSV contents in storage. */
export async function importFingerprint(request: string): Promise<string> {
  const bytes = new TextEncoder().encode(request);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // The in-memory and storage retry path still works in older non-secure browsers.
  let a = 2166136261;
  let b = 0x9e3779b9;
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 16777619);
    b = Math.imul(b ^ byte, 2246822519);
  }
  return `fallback-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

/** Reuse the key after a timeout or reload; changing the request uses a different key. */
export function pendingImportKey(store: KeyStore | null, fingerprint: string, fallback: Map<string, string>): string {
  const k = importSlot(fingerprint);
  const existing = safe(() => store?.getItem(k)) ?? fallback.get(k) ?? null;
  if (existing) return existing;
  const fresh = mint();
  fallback.set(k, fresh);
  safe(() => store?.setItem(k, fresh));
  return fresh;
}

export function clearImportKey(store: KeyStore | null, fingerprint: string, fallback: Map<string, string>): void {
  const k = importSlot(fingerprint);
  fallback.delete(k);
  safe(() => store?.removeItem(k));
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    // Private windows can refuse storage: the in-memory fallback still covers this tab.
    return undefined;
  }
}

/** sessionStorage when the browser allows it. */
export function browserKeyStore(): KeyStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

// ============================================================
// Browser secret storage — AES-256-GCM ciphertext in localStorage
//
// The wrapping key lives in IndexedDB when available, with a
// localStorage fallback when IndexedDB is blocked. Ciphertext
// stays in localStorage; a localStorage-only dump is not enough
// to recover the API key when IndexedDB works. XSS on this origin
// can still use the wrapping key.
// ============================================================

const LEGACY_DEVICE_KEY_STORAGE = 'vibeguard_device_key';
const ZUSTAND_PERSIST_KEY = 'codevibes-storage';
export const API_KEY_STORAGE_KEY = 'vibeguard_deepseek_api_key';
const IV_BYTES = 12;
const IDB_NAME = 'vibeguard-secrets';
const IDB_STORE = 'keys';
const IDB_WRAP_KEY = 'wrapping-key';

let memoryWrap: Uint8Array | null = null;
let wrapPromise: Promise<Uint8Array> | null = null;
let idbWriteBlockedForTests = false;

function toHex(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return [...view].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function getSubtle(): SubtleCrypto {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('Web Crypto is required to store API keys');
    }
    return subtle;
}

function idbAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
}

function readLegacyLocalWrap(): Uint8Array | null {
    const legacy = localStorage.getItem(LEGACY_DEVICE_KEY_STORAGE);
    if (legacy && /^[0-9a-f]+$/i.test(legacy) && legacy.length === 64) {
        return fromHex(legacy);
    }
    return null;
}

function writeLegacyLocalWrap(raw: Uint8Array): void {
    localStorage.setItem(LEGACY_DEVICE_KEY_STORAGE, toHex(raw));
}

function openWrapDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
        } catch (error) {
            reject(error instanceof Error ? error : new Error('IndexedDB open failed'));
        }
    });
}

function normalizeRawBytes(value: unknown): Uint8Array | null {
    if (value instanceof Uint8Array && value.length === 32) {
        return value;
    }
    if (value instanceof ArrayBuffer && value.byteLength === 32) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        if (view.byteLength === 32) {
            return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        }
    }
    return null;
}

async function idbReadRaw(): Promise<Uint8Array | null> {
    if (!idbAvailable()) {
        return null;
    }
    try {
        const db = await openWrapDb();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const req = tx.objectStore(IDB_STORE).get(IDB_WRAP_KEY);
                req.onsuccess = () => resolve(normalizeRawBytes(req.result));
                req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
            });
        } finally {
            db.close();
        }
    } catch {
        return null;
    }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

/**
 * Load or create the wrapping key in one readwrite transaction so concurrent
 * tabs serialize on IndexedDB and reuse the same stored key.
 */
async function idbLoadOrCreateRaw(seed?: Uint8Array): Promise<Uint8Array | null> {
    if (!idbAvailable() || idbWriteBlockedForTests) {
        return null;
    }
    try {
        const db = await openWrapDb();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                let pending: Uint8Array | null = null;
                const getReq = store.get(IDB_WRAP_KEY);
                getReq.onerror = () => reject(getReq.error ?? new Error('IndexedDB read failed'));
                getReq.onsuccess = () => {
                    const existing = normalizeRawBytes(getReq.result);
                    if (existing) {
                        pending = existing;
                        return;
                    }
                    const raw = seed ? new Uint8Array(seed) : globalThis.crypto.getRandomValues(new Uint8Array(32));
                    store.put(raw, IDB_WRAP_KEY);
                    pending = raw;
                };
                tx.oncomplete = () => {
                    if (pending) {
                        resolve(pending);
                    } else {
                        reject(new Error('IndexedDB load-or-create finished without a key'));
                    }
                };
                tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
            });
        } finally {
            db.close();
        }
    } catch {
        return null;
    }
}

async function idbWriteRaw(raw: Uint8Array): Promise<boolean> {
    if (!idbAvailable() || idbWriteBlockedForTests) {
        return false;
    }
    try {
        const db = await openWrapDb();
        try {
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
                tx.objectStore(IDB_STORE).put(raw, IDB_WRAP_KEY);
            });
            return true;
        } finally {
            db.close();
        }
    } catch {
        return false;
    }
}

async function persistRawWrappingKey(raw: Uint8Array): Promise<void> {
    const idbOk = await idbWriteRaw(raw);
    if (idbOk) {
        localStorage.removeItem(LEGACY_DEVICE_KEY_STORAGE);
        return;
    }
    writeLegacyLocalWrap(raw);
}

async function loadRawWrappingKeyInternal(): Promise<Uint8Array> {
    const legacy = readLegacyLocalWrap();
    const idbExisting = await idbReadRaw();

    if (legacy) {
        if (idbExisting && !bytesEqual(idbExisting, legacy)) {
            // IndexedDB recovered with a stale key while the active fallback lives in localStorage.
            const promoted = await idbWriteRaw(legacy);
            if (promoted) {
                localStorage.removeItem(LEGACY_DEVICE_KEY_STORAGE);
            }
            return legacy;
        }
        if (idbExisting) {
            localStorage.removeItem(LEGACY_DEVICE_KEY_STORAGE);
            return idbExisting;
        }
        const fromIdb = await idbLoadOrCreateRaw(legacy);
        if (fromIdb) {
            localStorage.removeItem(LEGACY_DEVICE_KEY_STORAGE);
            return fromIdb;
        }
        return legacy;
    }

    const fromIdb = await idbLoadOrCreateRaw();
    if (fromIdb) {
        localStorage.removeItem(LEGACY_DEVICE_KEY_STORAGE);
        return fromIdb;
    }

    const local = readLegacyLocalWrap();
    if (local) {
        return local;
    }

    const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
    writeLegacyLocalWrap(raw);
    return raw;
}

async function loadRawWrappingKey(): Promise<Uint8Array> {
    if (memoryWrap) {
        return memoryWrap;
    }
    if (!wrapPromise) {
        wrapPromise = loadRawWrappingKeyInternal()
            .then((raw) => {
                memoryWrap = raw;
                return raw;
            })
            .finally(() => {
                wrapPromise = null;
            });
    }
    return wrapPromise;
}

async function importDeviceKey(raw: Uint8Array): Promise<CryptoKey> {
    return getSubtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function getOrCreateDeviceKey(): Promise<CryptoKey> {
    return importDeviceKey(await loadRawWrappingKey());
}

/**
 * Test helpers — tree-shaken from production builds (MODE !== 'test').
 */
async function replaceWrappingKeyForTestsImpl(raw: Uint8Array): Promise<void> {
    memoryWrap = new Uint8Array(raw);
    wrapPromise = null;
    await persistRawWrappingKey(memoryWrap);
}

function resetMemoryWrapCacheForTestsImpl(): void {
    memoryWrap = null;
    wrapPromise = null;
}

function blockIdbWritesForTestsImpl(block: boolean): void {
    idbWriteBlockedForTests = block;
}

async function resetSecretStorageForTestsImpl(): Promise<void> {
    memoryWrap = null;
    wrapPromise = null;
    idbWriteBlockedForTests = false;
    localStorage.removeItem(LEGACY_DEVICE_KEY_STORAGE);
    if (!idbAvailable()) {
        return;
    }
    try {
        const db = await openWrapDb();
        try {
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'));
                tx.objectStore(IDB_STORE).delete(IDB_WRAP_KEY);
            });
        } finally {
            db.close();
        }
    } catch {
        // ignore blocked IndexedDB in tests
    }
}

export type SecretStorageTestHooks = {
    replaceWrappingKeyForTests: (raw: Uint8Array) => Promise<void>;
    resetMemoryWrapCacheForTests: () => void;
    blockIdbWritesForTests: (block: boolean) => void;
    resetSecretStorageForTests: () => Promise<void>;
};

export const secretStorageTestHooks: SecretStorageTestHooks | undefined =
    import.meta.env.MODE === 'test'
        ? {
              replaceWrappingKeyForTests: replaceWrappingKeyForTestsImpl,
              resetMemoryWrapCacheForTests: resetMemoryWrapCacheForTestsImpl,
              blockIdbWritesForTests: blockIdbWritesForTestsImpl,
              resetSecretStorageForTests: resetSecretStorageForTestsImpl,
          }
        : undefined;

/**
 * Encrypt plaintext with AES-256-GCM.
 * Output format: ivHex:ciphertextHex (GCM tag is appended by Web Crypto).
 */
export async function encryptSecret(plaintext: string): Promise<string> {
    const key = await getOrCreateDeviceKey();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await getSubtle().encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return `${toHex(iv)}:${toHex(ciphertext)}`;
}

/**
 * Decrypt a value produced by encryptSecret. Legacy plaintext API keys
 * (sk-...) are returned unchanged so existing installs keep working.
 */
export async function decryptSecret(stored: string): Promise<string> {
    if (stored.startsWith('sk-') || !stored.includes(':')) {
        return stored;
    }
    const [ivHex, dataHex] = stored.split(':');
    if (!ivHex || !dataHex || ivHex.length !== IV_BYTES * 2) {
        return stored;
    }
    const key = await getOrCreateDeviceKey();
    const iv = fromHex(ivHex);
    const data = fromHex(dataHex);
    const plaintext = await getSubtle().decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plaintext);
}

export async function writeEncryptedSecret(storageKey: string, plaintext: string): Promise<void> {
    const ciphertext = await encryptSecret(plaintext);
    localStorage.setItem(storageKey, ciphertext);
}

export async function readEncryptedSecret(storageKey: string): Promise<string | null> {
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
        return null;
    }
    try {
        const plaintext = await decryptSecret(stored);
        if (plaintext.startsWith('sk-') && stored === plaintext) {
            await writeEncryptedSecret(storageKey, plaintext);
        }
        return plaintext;
    } catch {
        localStorage.removeItem(storageKey);
        return null;
    }
}

export function clearEncryptedSecret(storageKey: string): void {
    localStorage.removeItem(storageKey);
}

/**
 * Read a plaintext apiKey from the old zustand persist blob without deleting it.
 */
export function peekLegacyZustandApiKey(): string | null {
    const raw = localStorage.getItem(ZUSTAND_PERSIST_KEY);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as { state?: { apiKey?: unknown } };
        const key = parsed.state?.apiKey;
        return typeof key === 'string' && key ? key : null;
    } catch {
        return null;
    }
}

export function clearLegacyZustandApiKey(): void {
    const raw = localStorage.getItem(ZUSTAND_PERSIST_KEY);
    if (!raw) {
        return;
    }
    try {
        const parsed = JSON.parse(raw) as { state?: { apiKey?: unknown } };
        if (!parsed.state || parsed.state.apiKey === undefined) {
            return;
        }
        delete parsed.state.apiKey;
        localStorage.setItem(ZUSTAND_PERSIST_KEY, JSON.stringify(parsed));
    } catch {
        // ignore corrupt persist blobs
    }
}

/**
 * Pull a plaintext apiKey out of the old zustand persist blob, if present.
 */
export function takeLegacyZustandApiKey(): string | null {
    const key = peekLegacyZustandApiKey();
    if (key) {
        clearLegacyZustandApiKey();
    }
    return key;
}

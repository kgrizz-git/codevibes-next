// ============================================================
// Browser secret storage — AES-256-GCM at rest in localStorage
//
// DeepSeek API keys are encrypted before localStorage.setItem so
// disk/browser profiles do not hold the plaintext key. The wrapping
// key is a random device secret (not the API key). XSS can still
// read both; this addresses cleartext-at-rest, not XSS.
// ============================================================

const DEVICE_KEY_STORAGE = 'vibeguard_device_key';
const ZUSTAND_PERSIST_KEY = 'codevibes-storage';
export const API_KEY_STORAGE_KEY = 'vibeguard_deepseek_api_key';
const IV_BYTES = 12;

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

async function importDeviceKey(raw: Uint8Array): Promise<CryptoKey> {
    return getSubtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function getOrCreateDeviceKey(): Promise<CryptoKey> {
    const existing = localStorage.getItem(DEVICE_KEY_STORAGE);
    if (existing && /^[0-9a-f]+$/i.test(existing) && existing.length === 64) {
        return importDeviceKey(fromHex(existing));
    }
    const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(DEVICE_KEY_STORAGE, toHex(raw));
    return importDeviceKey(raw);
}

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
 * Pull a plaintext apiKey out of the old zustand persist blob, if present.
 */
export function takeLegacyZustandApiKey(): string | null {
    const raw = localStorage.getItem(ZUSTAND_PERSIST_KEY);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as { state?: { apiKey?: unknown } };
        const key = parsed.state?.apiKey;
        if (typeof key !== 'string' || !key) {
            return null;
        }
        delete parsed.state.apiKey;
        localStorage.setItem(ZUSTAND_PERSIST_KEY, JSON.stringify(parsed));
        return key;
    } catch {
        return null;
    }
}

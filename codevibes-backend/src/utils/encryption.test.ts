import { afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { encrypt, decrypt, isEncrypted, looksEncrypted } from "./encryption.js";
import { decryptTokenField, encryptToken, type User } from "./database.js";

function flipHex(hex: string, pos: number): string {
  const flipped = (parseInt(hex[pos], 16) ^ 0x8).toString(16);
  return hex.slice(0, pos) + flipped + hex.slice(pos + 1);
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    github_id: 12345,
    username: "testuser",
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

describe("encrypt", () => {
  it("returns empty string for empty input (symmetry with decrypt)", () => {
    expect(encrypt("")).toBe("");
  });

  it("produces iv:authTag:ciphertext format with canonical lengths", () => {
    const ciphertext = encrypt("secret");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(32); // 16-byte IV
    expect(parts[1]).toHaveLength(32); // 16-byte auth tag
    expect(parts[2]).toMatch(/^[0-9a-fA-F]+$/);
    expect(parts[2].length).toBeGreaterThan(0);
  });
});

describe("decrypt", () => {
  it("round-trips encrypted data", () => {
    const plaintext = "ghp_1234567890abcdef";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("returns known legacy plaintext unchanged", () => {
    expect(decrypt("ghp_legacyToken123")).toBe("ghp_legacyToken123");
    expect(decrypt("sk-legacykey123")).toBe("sk-legacykey123");
  });

  it("returns legacy plaintext with colons unchanged (e.g. URL)", () => {
    expect(decrypt("https://api.github.com/repos")).toBe(
      "https://api.github.com/repos"
    );
  });

  it("returns empty string unchanged (symmetry with encrypt)", () => {
    expect(decrypt("")).toBe("");
  });

  it("throws on a damaged envelope with a removed delimiter", () => {
    const parts = encrypt("secret").split(":");
    const removedDelimiter = `${parts[0]}:${parts[1]}${parts[2]}`;
    expect(removedDelimiter.split(":")).toHaveLength(2);
    expect(() => decrypt(removedDelimiter)).toThrow("tampered or corrupt");
  });

  it("throws on a damaged envelope with an added delimiter", () => {
    const parts = encrypt("secret").split(":");
    const addedDelimiter = `${parts[0]}:${parts[1]}::${parts[2]}`;
    expect(addedDelimiter.split(":")).toHaveLength(4);
    expect(() => decrypt(addedDelimiter)).toThrow("tampered or corrupt");
  });

  it("throws on single-part non-legacy garbage (e.g. truncated envelope)", () => {
    expect(() => decrypt(encrypt("secret").split(":")[2])).toThrow(
      "tampered or corrupt"
    );
  });

  it("throws on unknown non-legacy values instead of echoing them", () => {
    expect(() => decrypt("plain-garbage")).toThrow("tampered or corrupt");
    expect(() => decrypt("a:b")).toThrow("tampered or corrupt");
    expect(() => decrypt("a:b:c:d")).toThrow("tampered or corrupt");
  });

  it("throws on tampered auth tag instead of returning the input", () => {
    const parts = encrypt("secret").split(":");
    const forged = `${parts[0]}:${flipHex(parts[1], 0)}:${parts[2]}`;
    expect(() => decrypt(forged)).toThrow("tampered or corrupt");
  });

  it("throws on tampered ciphertext instead of returning the input", () => {
    const parts = encrypt("secret").split(":");
    const forged = `${parts[0]}:${parts[1]}:${flipHex(parts[2], 0)}`;
    expect(() => decrypt(forged)).toThrow("tampered or corrupt");
  });

  it("throws on invalid hex in any part (does not echo)", () => {
    const iv = "z".repeat(32);
    const tag = "0".repeat(32);
    expect(() => decrypt(`${iv}:${tag}:abcd`)).toThrow("tampered or corrupt");
    expect(() => decrypt(`${tag}:${iv}:abcd`)).toThrow("tampered or corrupt");
    expect(() => decrypt(`${tag}:${tag}:abcg`)).toThrow("tampered or corrupt");
  });

  it("throws on wrong-length parts (e.g. 8-byte IV)", () => {
    const iv8 = "0".repeat(16); // 8 bytes
    const tag16 = "0".repeat(32);
    expect(() => decrypt(`${iv8}:${tag16}:abcd`)).toThrow("tampered or corrupt");
  });

  it("throws on empty parts in encrypted shape", () => {
    expect(() => decrypt("::")).toThrow("tampered or corrupt");
  });
});

describe("isEncrypted / looksEncrypted", () => {
  it("agree on a valid encrypted string", () => {
    const ciphertext = encrypt("secret");
    expect(isEncrypted(ciphertext)).toBe(true);
    expect(looksEncrypted(ciphertext)).toBe(true);
  });

  it("agree on boundary cases", () => {
    const boundary = [
      "",
      "plain",
      "https://api.github.com/repos",
      "a:b:c",
      `${"z".repeat(32)}:${"0".repeat(32)}:abcd`,
      `${"0".repeat(16)}:${"0".repeat(32)}:abcd`,
      `${"0".repeat(32)}:${"0".repeat(32)}:`,
    ];
    for (const input of boundary) {
      expect(isEncrypted(input)).toBe(looksEncrypted(input));
    }
  });

  it("only accepts exact 3-part valid-hex format", () => {
    expect(looksEncrypted(`${"0".repeat(32)}:${"0".repeat(32)}:abcd`)).toBe(
      true
    );
    expect(
      looksEncrypted(`${"z".repeat(32)}:${"0".repeat(32)}:abcd`)
    ).toBe(false);
    expect(looksEncrypted(`${"0".repeat(16)}:${"0".repeat(32)}:abcd`)).toBe(
      false
    );
    expect(looksEncrypted(`${"0".repeat(32)}:${"0".repeat(32)}:`)).toBe(false);
  });
});

describe("encryptToken (storage normalization)", () => {
  it("encrypts non-empty tokens and round-trips them", () => {
    const stored = encryptToken("ghp_abc");
    expect(stored).not.toBeNull();
    expect(decrypt(stored as string)).toBe("ghp_abc");
  });

  it("normalizes empty/whitespace tokens to null (never plaintext '')", () => {
    expect(encryptToken("")).toBeNull();
    expect(encryptToken("   ")).toBeNull();
    expect(encryptToken(null)).toBeNull();
    expect(encryptToken(undefined)).toBeNull();
  });
});

describe("decryptTokenField (per-field isolation)", () => {
  it("decrypts both fields when valid", () => {
    const user = makeUser({
      github_token: encrypt("ghp_abc"),
      deepseek_key: encrypt("sk-def"),
    });
    decryptTokenField(user, "github_token");
    decryptTokenField(user, "deepseek_key");
    expect(user.github_token).toBe("ghp_abc");
    expect(user.deepseek_key).toBe("sk-def");
  });

  it("nulls a malformed token without touching the other field", () => {
    const user = makeUser({
      github_token: "corrupt:value:here",
      deepseek_key: encrypt("sk-good"),
    });
    decryptTokenField(user, "github_token");
    decryptTokenField(user, "deepseek_key");
    expect(user.github_token).toBeNull();
    expect(user.deepseek_key).toBe("sk-good");
  });

  it("nulls a tampered-format token", () => {
    const good = encrypt("secret").split(":");
    const forged = `${good[0]}:${flipHex(good[1], 0)}:${good[2]}`;
    const user = makeUser({ github_token: forged });
    decryptTokenField(user, "github_token");
    expect(user.github_token).toBeNull();
  });

  it("leaves falsy values untouched", () => {
    const user = makeUser({ github_token: "" });
    decryptTokenField(user, "github_token");
    expect(user.github_token).toBe("");
  });

  it("leaves known legacy plaintext untouched", () => {
    const user = makeUser({ github_token: "ghp_legacy-plain" });
    decryptTokenField(user, "github_token");
    expect(user.github_token).toBe("ghp_legacy-plain");
  });

  it("nulls a damaged envelope with a removed delimiter", () => {
    const parts = encrypt("secret").split(":");
    const damaged = `${parts[0]}:${parts[1]}${parts[2]}`;
    const user = makeUser({ github_token: damaged });
    decryptTokenField(user, "github_token");
    expect(user.github_token).toBeNull();
  });
});

describe("startup key validation", () => {
  const VALID_KEY = "ab".repeat(32);

  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.NODE_ENV;
  });

  async function importEncryption(): Promise<typeof import("./encryption.js")> {
    return import("./encryption.js");
  }

  it("throws in production when the key is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ENCRYPTION_KEY;
    await expect(importEncryption()).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it("throws in production for a short key", async () => {
    process.env.NODE_ENV = "production";
    process.env.ENCRYPTION_KEY = "abcd";
    await expect(importEncryption()).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it("throws in production for a non-hex key", async () => {
    process.env.NODE_ENV = "production";
    process.env.ENCRYPTION_KEY = "zz".repeat(32);
    await expect(importEncryption()).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it("throws in production for an overlong key", async () => {
    process.env.NODE_ENV = "production";
    process.env.ENCRYPTION_KEY = VALID_KEY + "00";
    await expect(importEncryption()).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it("accepts an exact 64-hex-char key in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.ENCRYPTION_KEY = VALID_KEY;
    const mod = await importEncryption();
    const ciphertext = mod.encrypt("prod-secret");
    expect(mod.decrypt(ciphertext)).toBe("prod-secret");
  });

  it("uses an ephemeral dev key when unset outside production", async () => {
    delete process.env.NODE_ENV;
    delete process.env.ENCRYPTION_KEY;
    const mod = await importEncryption();
    const ciphertext = mod.encrypt("dev-secret");
    expect(mod.decrypt(ciphertext)).toBe("dev-secret");
  });
});
import { describe, it, expect } from "vitest";
import { shouldIgnoreFile, getFilePriority } from "./fileFilter.js";

describe("fileFilter", () => {
  it("ignores lock files and build output", () => {
    expect(shouldIgnoreFile("package-lock.json")).toBe(true);
    expect(shouldIgnoreFile("dist/server.js")).toBe(true);
  });

  it("does not ignore ordinary source files", () => {
    expect(shouldIgnoreFile("src/services/analysisService.ts")).toBe(false);
  });

  it("assigns a priority to source files", () => {
    expect(getFilePriority("src/utils/auth.ts")).toBe(3);
  });

  it("returns null for ignored files", () => {
    expect(getFilePriority("package-lock.json")).toBeNull();
  });
});

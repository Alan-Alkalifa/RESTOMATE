import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let result: () => unknown = () => ({ data: {}, error: null });
const verifyOtp = vi.fn(async () => result());
vi.mock("../../supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp } }) }));

import { GET } from "../../../app/auth/confirm/route";

const ORIGIN = "https://app.restomate.app";
const get = (query: string) => GET(new NextRequest(`${ORIGIN}/auth/confirm?${query}`));
const location = (res: Response) => res.headers.get("location");
const TOKEN = "pkce_0123456789abcdef";

beforeEach(() => {
  verifyOtp.mockClear();
  result = () => ({ data: {}, error: null });
});

describe("/auth/confirm", () => {
  it("verifies by token_hash and type, then goes to /app", async () => {
    const res = await get(`token_hash=${TOKEN}&type=signup`);
    expect(verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: TOKEN });
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${ORIGIN}/app`);
  });

  it("sends a recovery link to the reset page, whatever `next` says", async () => {
    const res = await get(`token_hash=${TOKEN}&type=recovery&next=/app/menu`);
    expect(location(res)).toBe(`${ORIGIN}/reset-password`);
  });

  it("follows a safe next and never leaves the site", async () => {
    expect(location(await get(`token_hash=${TOKEN}&type=email&next=/app/menu%3Fa%3D1`))).toBe(
      `${ORIGIN}/app/menu?a=1`,
    );
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/%2F%2Fevil.example",
    ]) {
      expect(
        location(await get(`token_hash=${TOKEN}&type=email&next=${encodeURIComponent(next)}`)),
      ).toBe(`${ORIGIN}/app`);
    }
  });

  it("never calls Auth for a missing, short or unknown-type link, and goes back with a code", async () => {
    for (const query of [
      "",
      "type=signup",
      `token_hash=${TOKEN}`,
      `token_hash=${TOKEN}&type=admin`,
      "token_hash=x&type=signup",
    ]) {
      expect(location(await get(query))).toBe(`${ORIGIN}/login?error=invalid_link`);
    }
    expect(location(await get(`token_hash=x&type=recovery`))).toBe(
      `${ORIGIN}/forgot-password?error=invalid_link`,
    );
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("an expired or used link goes back to the page it belongs to", async () => {
    result = () => ({
      data: {},
      error: { code: "otp_expired", status: 403, name: "AuthApiError" },
    });
    expect(location(await get(`token_hash=${TOKEN}&type=signup`))).toBe(
      `${ORIGIN}/login?error=invalid_link`,
    );
    expect(location(await get(`token_hash=${TOKEN}&type=recovery`))).toBe(
      `${ORIGIN}/forgot-password?error=invalid_link`,
    );
  });

  it("an outage is not an invalid link", async () => {
    result = () => ({ data: {}, error: { name: "AuthRetryableFetchError", status: 503 } });
    expect(location(await get(`token_hash=${TOKEN}&type=signup`))).toBe(
      `${ORIGIN}/login?error=unavailable`,
    );
    result = () => Promise.reject(new TypeError("fetch failed"));
    expect(location(await get(`token_hash=${TOKEN}&type=signup`))).toBe(
      `${ORIGIN}/login?error=unavailable`,
    );
  });
});

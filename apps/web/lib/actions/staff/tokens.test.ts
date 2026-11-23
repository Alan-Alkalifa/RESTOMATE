import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TOKEN_LENGTH, TOKEN_PATTERN, hashToken, newInvitationToken, toBytea } from "./tokens";

describe("invitation tokens", () => {
  it("are 32 random bytes as base64url: 43 characters, never 32 bytes long", async () => {
    const { token } = await newInvitationToken();
    expect(token).toHaveLength(TOKEN_LENGTH);
    expect(token).toMatch(TOKEN_PATTERN);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(new TextEncoder().encode(token).length).not.toBe(32);
  });

  it("store only sha256(utf8(token)), as accept_invitation computes it, never the raw token", async () => {
    const { token, tokenHash } = await newInvitationToken();
    const digest = createHash("sha256").update(Buffer.from(token, "utf8")).digest("hex");
    expect(tokenHash).toBe(`\\x${digest}`);
    expect(tokenHash).not.toContain(token);
    expect(tokenHash.slice(2)).toHaveLength(64); // 32 bytes: fits `octet_length(token_hash) = 32`
    expect(Buffer.from(tokenHash.slice(2), "hex").toString("base64url")).not.toBe(token);
  });

  it("are new every time", async () => {
    const tokens = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = await newInvitationToken();
      tokens.add(t.token);
      hashes.add(t.tokenHash);
    }
    expect(tokens.size).toBe(200);
    expect(hashes.size).toBe(200);
  });

  it("hash a known value as Postgres sha256(convert_to(token, 'UTF8')) does", async () => {
    expect(toBytea(await hashToken("abc"))).toBe(
      "\\xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

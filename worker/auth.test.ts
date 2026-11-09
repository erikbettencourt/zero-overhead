import { describe, expect, it } from "vitest";
import { authenticate, normalizeTeamDomain, parseAllowedEmails } from "./auth";

const env = {
  TEAM_DOMAIN: "https://example.cloudflareaccess.com",
  POLICY_AUD: "aud-123",
  ALLOWED_EMAILS: "Owner@Example.com",
};

const req = (token?: string) =>
  new Request("https://admin.example.com/", {
    headers: token ? { "cf-access-jwt-assertion": token } : {},
  });

// A stand-in for jose's verifier so tests never hit the network.
const verifyAs =
  (payload: Record<string, unknown> | Error) =>
  async (..._args: unknown[]) => {
    if (payload instanceof Error) throw payload;
    return { payload, protectedHeader: { alg: "RS256" } } as never;
  };

describe("authenticate", () => {
  it("fails closed when Access is not configured", async () => {
    const r = await authenticate(req("t"), {}, verifyAs({ email: "owner@example.com" }));
    expect(r).toMatchObject({ ok: false, status: 500 });
  });

  it("fails closed when the allow list is empty", async () => {
    const r = await authenticate(req("t"), { ...env, ALLOWED_EMAILS: " , " }, verifyAs({ email: "owner@example.com" }));
    expect(r).toMatchObject({ ok: false, status: 500 });
  });

  it("rejects a request with no token", async () => {
    const r = await authenticate(req(), env, verifyAs({ email: "owner@example.com" }));
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a token that fails verification", async () => {
    const r = await authenticate(req("forged"), env, verifyAs(new Error("bad signature")));
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a valid token for an email not on the list", async () => {
    const r = await authenticate(req("t"), env, verifyAs({ email: "stranger@example.com" }));
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a valid token with no email", async () => {
    const r = await authenticate(req("t"), env, verifyAs({ sub: "service-token" }));
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("allows a valid token for an allowed email, case-insensitively", async () => {
    const r = await authenticate(req("t"), env, verifyAs({ email: "owner@EXAMPLE.com" }));
    expect(r).toEqual({ ok: true, email: "owner@example.com" });
  });
});

describe("config parsing", () => {
  it("only accepts an https cloudflareaccess.com team domain", () => {
    expect(normalizeTeamDomain("https://team.cloudflareaccess.com/")).toBe("https://team.cloudflareaccess.com");
    expect(normalizeTeamDomain("http://team.cloudflareaccess.com")).toBeNull();
    expect(normalizeTeamDomain("https://evil.example.com")).toBeNull();
    expect(normalizeTeamDomain(undefined)).toBeNull();
  });

  it("parses a comma-separated allow list", () => {
    expect([...parseAllowedEmails(" a@x.com, B@x.com ,,")]).toEqual(["a@x.com", "b@x.com"]);
  });
});

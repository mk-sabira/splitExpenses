import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { signToken } from "../src/auth/tokens";

const app = createApp();
// Unique per run so tests never collide with real dev data or each other.
const suffix = `${Date.now()}@auth-test.local`;
const email = `alice-${suffix}`;
const password = "correct horse battery";

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
  await prisma.$disconnect();
});

describe("auth", () => {
  let token: string;

  it("registers a user and returns a token without the password hash", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: `  Alice-${suffix.toUpperCase()} `, name: "Alice", password });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, name: "Alice" });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.token).toBe("string");
    token = res.body.token;
  });

  it("rejects a duplicate email regardless of case", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: email.toUpperCase(), name: "Other", password });
    expect(res.status).toBe(409);
  });

  it("validates the request body", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", name: "", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((i: { path: string }) => i.path).sort()).toEqual([
      "email",
      "name",
      "password",
    ]);
  });

  it("rejects passwords longer than bcrypt's 72-byte limit", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: `long-${suffix}`, name: "Long", password: "a".repeat(73) });
    expect(res.status).toBe(400);
  });

  it("logs in with the right password", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ email, password: "nope-nope" });
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: `nobody-${suffix}`, password });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("returns the current user for a valid token", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it("rejects missing, malformed and forged tokens", async () => {
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect(
      (await request(app).get("/api/auth/me").set("Authorization", "Bearer garbage")).status,
    ).toBe(401);
    const [h, p] = token.split(".");
    const forged = `${h}.${p}.${"A".repeat(43)}`;
    expect(
      (await request(app).get("/api/auth/me").set("Authorization", `Bearer ${forged}`)).status,
    ).toBe(401);
  });

  it("rejects a valid token for a user that no longer exists", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${signToken("deleted-user-id")}`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
  });
});

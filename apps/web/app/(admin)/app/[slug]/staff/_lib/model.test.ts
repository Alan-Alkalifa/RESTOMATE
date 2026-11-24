import { describe, expect, it } from "vitest";
import { errorMessageKey, fieldMessageKey, reachesAllLocations, seatsUsed } from "./model";

describe("seatsUsed", () => {
  it("counts active members and open invitations only", () => {
    expect(
      seatsUsed(
        [{ status: "active" }, { status: "active" }, { status: "deactivated" }],
        [{ status: "open" }, { status: "expired" }, { status: "accepted" }, { status: "revoked" }],
      ),
    ).toBe(3);
  });
});

describe("errorMessageKey", () => {
  it("prefers the form key", () => {
    expect(
      errorMessageKey({ code: "forbidden", fieldErrors: { form: ["staff.member.self"] } }),
    ).toBe("staff.member.self");
  });
  it("falls back to a field key, then to the code", () => {
    expect(
      errorMessageKey({ code: "validation", fieldErrors: { email: ["staff.email.invalid"] } }),
    ).toBe("staff.email.invalid");
    expect(errorMessageKey({ code: "forbidden" })).toBe("error.forbidden");
  });
  it("never returns an unknown key", () => {
    expect(errorMessageKey({ code: "conflict", fieldErrors: { form: ["made.up.key"] } })).toBe(
      "error.conflict",
    );
    expect(fieldMessageKey({ code: "validation", fieldErrors: { a: ["nope"] } }, "a")).toBe(
      undefined,
    );
  });
});

describe("reachesAllLocations", () => {
  it("is true for Owner and Manager only", () => {
    expect(reachesAllLocations("owner")).toBe(true);
    expect(reachesAllLocations("manager")).toBe(true);
    expect(reachesAllLocations("cashier")).toBe(false);
    expect(reachesAllLocations(null)).toBe(false);
  });
});

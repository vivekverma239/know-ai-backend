import {
  getRequestContext,
  setSubjectIdentity,
  withRequestContext,
} from "@/utils/requestContext";
import { describe, expect, it } from "vitest";

describe("requestContext.setSubjectIdentity", () => {
  it("overrides subject identity while preserving actor", async () => {
    await withRequestContext(
      {
        requestId: "req-1",
        userId: "admin-1",
        sessionId: undefined,
        orgId: "admin-org",
        actorUserId: "admin-1",
        path: "/admin/playground/chat",
        method: "POST",
        timestamp: new Date(),
        metadata: {},
      },
      async () => {
        setSubjectIdentity({
          userId: "impersonated-user",
          orgId: "user-org",
          sessionId: "sess-1",
        });
        const ctx = getRequestContext();
        expect(ctx?.userId).toBe("impersonated-user");
        expect(ctx?.orgId).toBe("user-org");
        expect(ctx?.sessionId).toBe("sess-1");
        // actorUserId NOT overridden by this call — preserved from init
        expect(ctx?.actorUserId).toBe("admin-1");
      },
    );
  });

  it("defaults actorUserId to userId when not impersonating", async () => {
    await withRequestContext(
      {
        requestId: "req-2",
        userId: "user-1",
        sessionId: "sess-2",
        orgId: "user-org",
        actorUserId: "user-1",
        path: "/finAgent",
        method: "POST",
        timestamp: new Date(),
        metadata: {},
      },
      async () => {
        const ctx = getRequestContext();
        expect(ctx?.userId).toBe(ctx?.actorUserId);
      },
    );
  });

  it("allows explicit actorUserId override (admin impersonation pattern)", async () => {
    await withRequestContext(
      {
        requestId: "req-3",
        userId: undefined,
        sessionId: undefined,
        orgId: undefined,
        actorUserId: undefined,
        path: "/admin/playground/chat",
        method: "POST",
        timestamp: new Date(),
        metadata: {},
      },
      async () => {
        setSubjectIdentity({
          userId: "impersonated-user",
          orgId: "user-org",
          sessionId: "sess-3",
          actorUserId: "admin-1",
        });
        const ctx = getRequestContext();
        expect(ctx?.userId).toBe("impersonated-user");
        expect(ctx?.actorUserId).toBe("admin-1");
      },
    );
  });
});

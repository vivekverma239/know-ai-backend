/**
 * Poll file parse status against the local backend.
 * Usage: node --env-file=.env scripts/check-file-status.mjs <fileId>
 */
import { SignJWT } from "jose";

const fileId = process.argv[2];
if (!fileId) {
  console.error("usage: node scripts/check-file-status.mjs <fileId>");
  process.exit(1);
}

const API = "http://localhost:3100/api/v1";
const USER_ID = "558f72a3-13ab-481b-b91c-001de87aa297";
const ORG_ID = "5b65c553-86bb-417c-a37d-4700ddabaf0f";

const secret = process.env.ADMIN_JWT_SECRET;
if (!secret) throw new Error("ADMIN_JWT_SECRET not set");

const jwt = await new SignJWT({
  tokenType: "admin_access",
  userId: "test-admin",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("8h")
  .sign(new TextEncoder().encode(secret));

const url = `${API}/admin/documents?orgId=${ORG_ID}&status=all&type=all&page=1&pageSize=100`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
if (!res.ok) {
  console.error(`HTTP ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}
const body = await res.json();
const file = body.items?.find((f) => f.id === fileId);
if (!file) {
  console.error(`fileId ${fileId} not found in this org. Sample of recent ids:`);
  console.error(body.items?.slice(0, 5).map((f) => f.id).join("\n"));
  process.exit(1);
}
console.log(JSON.stringify(file, null, 2));

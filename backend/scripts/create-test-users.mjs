#!/usr/bin/env node
/**
 * Creates client + freelancer via POST /database/users/with-email.
 * Uses HTTP only — no DATABASE_URL. Point API_BASE_URL at dev if needed, e.g.
 *   API_BASE_URL=https://dev.grumbuild.com/backend/api/v1 node scripts/create-test-users.mjs
 * (path must match nginx: often .../backend/api/v1 when BACKEND_URL ends with /backend)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const API_BASE = process.env.API_BASE_URL || "http://localhost:5000/api/v1";

const USERS = [
  {
    email: process.env.TEST_CLIENT_EMAIL || "client.test+1@example.com",
    password: process.env.TEST_CLIENT_PASSWORD || "Client@12345",
    role: "client",
  },
  {
    email: process.env.TEST_FREELANCER_EMAIL || "freelancer.test+1@example.com",
    password: process.env.TEST_FREELANCER_PASSWORD || "Freelancer@12345",
    role: "freelancer",
  },
];

async function createUser(user) {
  const response = await fetch(`${API_BASE}/database/users/with-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // ignore json parse errors; fallback below
  }

  if (response.ok && payload?.success) {
    console.log(`Created: ${user.role} -> ${user.email}`);
    return;
  }

  const message =
    payload?.error?.message ||
    payload?.message ||
    `HTTP ${response.status} ${response.statusText}`;

  if (String(message).toLowerCase().includes("already exists")) {
    console.log(`Already exists: ${user.role} -> ${user.email}`);
    return;
  }

  throw new Error(`Failed (${user.email}): ${message}`);
}

async function main() {
  console.log(`Using API: ${API_BASE}`);
  for (const user of USERS) {
    await createUser(user);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});


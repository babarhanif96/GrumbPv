/**
 * Import legacy Grumbuild users from a JSON file.
 *
 * Usage (from backend folder):
 *   node scripts/import-legacy-users.mjs ./scripts/legacy-users.example.json
 *
 * Or via admin API (authenticated):
 *   POST /api/v1/admin/users/import  { "users": [ ... ] }
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';

config();

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/import-legacy-users.mjs <path-to-users.json>');
  process.exit(1);
}

const apiBase = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}/api/v1`;
const adminEmail = process.env.ADMIN_IMPORT_EMAIL;
const adminPassword = process.env.ADMIN_IMPORT_PASSWORD;

async function main() {
  const users = JSON.parse(readFileSync(resolve(filePath), 'utf8'));
  if (!Array.isArray(users)) {
    throw new Error('JSON file must contain an array of user objects');
  }

  if (!adminEmail || !adminPassword) {
    console.error('Set ADMIN_IMPORT_EMAIL and ADMIN_IMPORT_PASSWORD in .env for script-based import.');
    process.exit(1);
  }

  const loginRes = await fetch(`${apiBase}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok || !loginJson.data) {
    throw new Error(`Admin login failed: ${JSON.stringify(loginJson)}`);
  }

  const importRes = await fetch(`${apiBase}/admin/users/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginJson.data}`,
    },
    body: JSON.stringify({ users }),
  });
  const importJson = await importRes.json();
  console.log(JSON.stringify(importJson, null, 2));

  if (!importRes.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

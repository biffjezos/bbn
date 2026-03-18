#!/usr/bin/env node
// One-off fixer: make the users.email index sparse so venue accounts
// (which have no email field) don't collide on null.
//
// Usage:
//   MONGO_URI="mongodb+srv://..." node fix-email-index-sparse.js
//   # optionally: DB_NAME=boomboom (defaults to 'boomboom')

import { MongoClient } from 'mongodb';

const uri    = process.env.MONGO_URI;
const dbName = process.env.DB_NAME || 'boomboom';

if (!uri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const client = new MongoClient(uri);
await client.connect();
const users = client.db(dbName).collection('users');

// Drop the old non-sparse index (ignore error if it doesn't exist)
try {
  await users.dropIndex('email_1');
  console.log('Dropped old email_1 index.');
} catch {
  console.log('email_1 index not found — skipping drop.');
}

// Recreate as sparse + unique
await users.createIndex({ email: 1 }, { unique: true, sparse: true });
console.log('Created new sparse unique index on email. Done.');

await client.close();

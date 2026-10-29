import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../db');
const withSeed = process.argv.includes('--seed');

try {
  await pool.query(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
  console.log('Schema applied');
  if (withSeed) {
    await pool.query(fs.readFileSync(path.join(dir, 'seed.sql'), 'utf8'));
    console.log('Seed applied');
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}

/**
 * Migration runner for x-dm-service.
 *
 * Reads .sql files from migrations/ in order and executes them against the
 * MySQL database.
 *
 * Usage: npm run migrate
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { getConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function runMigrations(): Promise<void> {
  const cfg = getConfig();
  console.log('[Migrate] Connecting to database...');

  const connection = await mysql.createConnection({
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    database: cfg.DB_NAME,
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
  });

  try {
    // Ensure migrations tracking table exists
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);

    // Read migration files sorted by name (e.g. 001_..., 002_...)
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const [rows] = await connection.execute(
        'SELECT 1 FROM _migrations WHERE name = ?',
        [file],
      );

      if ((rows as unknown[]).length > 0) {
        console.log(`[Migrate] Skipping already-applied: ${file}`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[Migrate] Applying: ${file}`);

      for (const statement of splitStatements(sql)) {
        if (statement.trim()) {
          await connection.execute(statement);
        }
      }

      await connection.execute(
        'INSERT INTO _migrations (name) VALUES (?)',
        [file],
      );

      console.log(`[Migrate] Applied: ${file}`);
    }

    console.log('[Migrate] All migrations complete');
  } finally {
    await connection.end();
  }
}

/**
 * Split a .sql file into individual statements, respecting delimiter changes.
 * Supports MySQL-style compound statements (CREATE PROCEDURE, etc.).
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let delimiter = ';';

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();

    // Handle delimiter changes
    const delimMatch = trimmed.match(/^DELIMITER\s+(.+)/i);
    if (delimMatch) {
      delimiter = delimMatch[1];
      continue;
    }

    // Check if current line ends with the active delimiter
    if (trimmed.endsWith(delimiter)) {
      current += line.slice(0, line.lastIndexOf(delimiter)) + '\n';
      statements.push(current.trim());
      current = '';
      // Reset delimiter after compound statements
      if (delimiter !== ';') {
        delimiter = ';';
      }
    } else {
      current += line + '\n';
    }
  }

  // Push any remaining content
  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements.filter((s) => s.length > 0);
}

runMigrations().catch((err) => {
  console.error('[Migrate] Fatal:', err);
  process.exit(1);
});
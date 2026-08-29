// scripts/backup-db.js
// Dumps every table in the configured DB (Turso if TURSO_URL is set, else local
// inventory.db) to a timestamped, restorable .sql file under backups/.
// Run before any schema migration: node scripts/backup-db.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return value.toString();
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const db = process.env.TURSO_URL
    ? createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN })
    : createClient({ url: 'file:./inventory.db' });

  const target = process.env.TURSO_URL ? 'Turso (cloud)' : 'local inventory.db';
  console.log(`Backing up: ${target}`);

  const tablesResult = await db.execute(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );

  const lines = [`-- Backup of ${target}`, `-- Generated ${new Date().toISOString()}`, ''];

  for (const table of tablesResult.rows) {
    lines.push(`-- Table: ${table.name}`);
    lines.push(`${table.sql};`);

    const rows = await db.execute(`SELECT * FROM ${table.name}`);
    for (const row of rows.rows) {
      const cols = rows.columns;
      const values = cols.map(c => sqlLiteral(row[c]));
      lines.push(`INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${values.join(', ')});`);
    }
    lines.push('');
    console.log(`  ${table.name}: ${rows.rows.length} row(s)`);
  }

  const backupsDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(backupsDir, `backup-${stamp}.sql`);
  fs.writeFileSync(outFile, lines.join('\n'));

  console.log(`\nBackup written to ${outFile}`);
}

main().catch(err => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});

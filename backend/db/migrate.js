// backend/db/migrate.js
// Idempotent database schema migration runner for Phase G

const fs = require('fs');
const path = require('path');
const { execute } = require('../config/database');

/**
 * Split SQL script into individual statements preserving single-quoted literals.
 * @param {string} sql Raw SQL text
 * @returns {string[]} Array of individual SQL statements
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'") {
      if (inString && sql[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inString = !inString;
      current += char;
    } else if (char === ';' && !inString) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
    } else {
      current += char;
    }
  }

  const remainder = current.trim();
  if (remainder) {
    statements.push(remainder);
  }

  return statements;
}

/**
 * Apply database schema migrations idempotently.
 * @returns {Promise<{ statementsRun: number, durationMs: number }>}
 */
async function migrate() {
  const start = Date.now();
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const statements = splitSqlStatements(schemaSql);

  let statementsRun = 0;
  for (const statement of statements) {
    try {
      await execute(statement);
      statementsRun++;
    } catch (error) {
      throw new Error(`[MIGRATION ERROR] Failed executing statement: "${statement}". Error: ${error.message}`);
    }
  }

  return {
    statementsRun,
    durationMs: Date.now() - start,
  };
}

module.exports = {
  migrate,
  splitSqlStatements,
};

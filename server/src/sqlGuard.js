// Hardened SELECT-only guard for the raw-SQL passthrough endpoint.
// Goal: allow read-only ad-hoc queries (matching the original cpanel's pattern)
// while making it impossible for a browser caller to mutate the database.
//
// We block mutation/DDL keywords as whole words. We DON'T block bare `sp_*` /
// `xp_*` identifiers — those are only callable via EXEC/EXECUTE, which is
// already blocked, and the broad pattern was producing false positives on
// legitimate column aliases like `sp_code`.

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|EXEC|EXECUTE|TRUNCATE|MERGE|GRANT|REVOKE|CREATE|BACKUP|RESTORE|SHUTDOWN|BULK)\b/i;

const ALLOWED_START = /^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*(SELECT|WITH)\b/i;

export function checkSelectOnly(qry) {
  if (typeof qry !== 'string') return 'qry must be a string';
  if (qry.length === 0) return 'qry is empty';
  if (qry.length > 4000) return 'qry too long (max 4000 chars)';

  // Strip a single trailing semicolon, then disallow any other semicolons
  const stripped = qry.replace(/;\s*$/, '');
  if (stripped.includes(';')) return 'multiple statements not allowed';

  if (!ALLOWED_START.test(qry)) return 'only SELECT or WITH queries are allowed';
  if (FORBIDDEN.test(qry)) return 'forbidden keyword in query';

  return null; // ok
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("cleanup uses explicit ID predicates compatible with hosted safeupdate", () => {
  const sql = readFileSync(
    "supabase/migrations/20261113141421_fix_scoped_test_cleanup.sql",
    "utf8",
  );
  const statements = sql.match(/DELETE FROM public\.[^;]+;/g) || [];
  assert.equal(statements.length, 3);
  for (const statement of statements) assert.match(statement, / WHERE /);
  assert.match(sql, /DELETE FROM public\.sessions WHERE id=ANY\(target_ids\)/);
  assert.doesNotMatch(sql, /safeupdate\.enabled\s*=\s*(?:false|off)|TRUNCATE/i);
});

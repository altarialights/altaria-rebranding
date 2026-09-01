# Project rules

Preserve the existing Astro architecture, visual identity, fonts and optimized assets. Do not introduce a UI framework unless the project genuinely needs one.

## DATABASE RULES

Before changing any database-related code:

1. Read `docs/database/SCHEMA.md`.
2. Read all migrations relevant to the affected tables.
3. Never modify an applied migration.
4. Create a new append-only migration for schema changes.
5. Update `docs/database/SCHEMA.md` after every schema modification.
6. Use Turso only.
7. Use parameterized SQL.
8. Never expose database credentials client-side.

## DIGITAL ASSESSMENT RULES

Before changing the assessment:

1. Read `docs/digital-assessment/README.md`.
2. Read `docs/digital-assessment/SCORING.md`.
3. Do not change historical questionnaire versions after real answers exist.
4. Create a new questionnaire version when questions, weights or scoring change.
5. Server-side scoring is authoritative. Client scoring is only a preview.

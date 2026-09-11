const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const path = require('node:path');
const databaseDir = path.resolve(__dirname, '../packages/database');
const databaseRequire = createRequire(path.join(databaseDir, 'package.json'));
const { PrismaClient } = databaseRequire('@prisma/client');
const db = new PrismaClient();
function prisma(args) {
  const result = spawnSync(process.execPath, [databaseRequire.resolve('prisma/build/index.js'), ...args], { cwd: databaseDir, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`Prisma ${args[0]} failed (${result.status})`);
}
async function main() {
  const [tables] = await db.$queryRaw`SELECT to_regclass('public."User"')::text AS users, to_regclass('public._prisma_migrations')::text AS migrations`;
  if (tables.users && !tables.migrations) {
    // Adopt the old db-push installation only when it matches the baseline exactly.
    prisma(['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code']);
    prisma(['migrate', 'resolve', '--applied', '20260911000000_baseline']);
  }
  prisma(['migrate', 'deploy']);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());

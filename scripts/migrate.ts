/** Apply checked-in Prisma SQL migrations with the native PostgreSQL driver.
 * This small runner avoids a schema-engine binary download in restricted cloud machines.
 * The Prisma migration table is compatible with `prisma migrate deploy`.
 */
import { Client } from 'pg';
import { createHash,randomUUID } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
const db=new Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try {
 await db.query('SELECT pg_advisory_lock(8675309)');
 await db.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
 for(const name of (await readdir('prisma/migrations')).filter(x=>/^\d/.test(x)).sort()){
  const sql=await readFile(`prisma/migrations/${name}/migration.sql`,'utf8');const checksum=createHash('sha256').update(sql).digest('hex');
  const prior=await db.query('SELECT checksum FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL',[name]);
  if(prior.rows.length){if(prior.rows[0].checksum!==checksum)throw Error(`Migration checksum mismatch: ${name}`);continue;}
  await db.query('BEGIN');
  try{await db.query(sql);await db.query('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),1)',[randomUUID(),checksum,name]);await db.query('COMMIT');console.log(`Applied ${name}`);}catch(e){await db.query('ROLLBACK');throw e;}
 }
}finally{await db.query('SELECT pg_advisory_unlock(8675309)');await db.end();}

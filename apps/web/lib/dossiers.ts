import { eq, desc } from 'drizzle-orm';
import { db } from './db';
import { dossiers } from './db/schema';

export async function listDossiers(ownerId: string) {
  return db
    .select()
    .from(dossiers)
    .where(eq(dossiers.ownerId, ownerId))
    .orderBy(desc(dossiers.createdAt));
}

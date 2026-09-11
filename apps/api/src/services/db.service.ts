import { PrismaClient, getPrisma } from '@work-ai/database';

export function getDb(): PrismaClient {
  return getPrisma();
}

export const db = getDb();

import 'dotenv/config';
import { Disposable, injectable, singleton } from 'tsyringe';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';
import { Config } from '@isla-bot/core';

export const DATABASE_TOKEN = Symbol('DATABASE_TOKEN');

@injectable({ token: DATABASE_TOKEN })
@singleton()
export class Database implements Disposable {
  readonly prisma: PrismaClient;

  constructor(config: Config) {
    const url = config.get('database.url');
    if (!url) throw new Error('Missing database url');
    const adapter = new PrismaBetterSqlite3({ url });
    this.prisma = new PrismaClient({ adapter });
  }

  async dispose() {
    await this.prisma.$disconnect();
  }
}

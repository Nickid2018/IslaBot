import { inject, injectable } from 'tsyringe';
import { Database } from './database';
import { PermissionLevel } from '../../generated/prisma/enums';
import { CACHE_TOKEN, ICache } from './cache';

export const LEVELS_INDEX = {
  [PermissionLevel.SYSOP]: 5,
  [PermissionLevel.ADMIN]: 4,
  [PermissionLevel.NORMAL]: 3,
  [PermissionLevel.SEMIBANNED]: 2,
  [PermissionLevel.BANNED]: 1,
};

@injectable()
export class Permission {
  constructor(
    private readonly db: Database,
    @inject(CACHE_TOKEN) private readonly cache: ICache,
  ) {
    this.setPermission('console:user:0', PermissionLevel.SYSOP);
  }

  async getPermission(target: string) {
    const cacheKey = `permission:${target}`;
    const cached = await this.cache.get<PermissionLevel>(cacheKey);
    if (cached) return cached;
    const entry = await this.db.prisma.permissions.findUnique({
      select: { level: true },
      where: { id: target },
    });
    const level = entry?.level || PermissionLevel.NORMAL;
    await this.cache.set(cacheKey, level, 3600);
    return level;
  }

  async hasPermission(target: string, level: PermissionLevel) {
    return LEVELS_INDEX[await this.getPermission(target)] >= LEVELS_INDEX[level];
  }

  async setPermission(target: string, permission: PermissionLevel) {
    await this.db.prisma.permissions.upsert({
      create: { id: target, level: permission },
      update: { level: permission },
      where: { id: target },
    });
    await this.cache.set(target, permission, 3600);
  }
}

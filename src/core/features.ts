import { inject, injectable } from 'tsyringe';
import { Database } from './database';
import { CACHE_TOKEN, ICache } from './cache';

let initialized = false;

@injectable()
export class Features {
  constructor(
    private readonly db: Database,
    @inject(CACHE_TOKEN) private readonly cache: ICache,
  ) {
    if (!initialized) {
      this.enableGroup('console:user:0');
      initialized = true;
    }
  }

  async groupEnabled(scope: string) {
    const cacheKey = `group:${scope}:enabled`;
    const cache = await this.cache.get(cacheKey);
    if (cache === 'true') return true;
    if (cache === 'false') return false;
    const entry = await this.db.prisma.groups.findUnique({
      where: { id: scope },
    });
    if (entry) {
      await this.cache.set(cacheKey, Boolean(entry.enabled));
      return entry.enabled;
    } else {
      await this.cache.set(cacheKey, 'false');
      return false;
    }
  }

  async featureEnabled(
    scope: string,
    feature: string,
    defaultValue: boolean = false,
  ) {
    const cacheKey = `feature:${scope}:${feature}`;
    const cache = await this.cache.get(cacheKey);
    if (cache === 'null') return defaultValue;
    if (cache === 'true') return true;
    if (cache === 'false') return false;
    if (!(await this.groupEnabled(scope))) {
      await this.cache.set(cacheKey, 'false');
      return false;
    }
    const featureEntry = await this.db.prisma.featureEnables.findUnique({
      where: { scope_feature: { scope, feature } },
    });
    if (!featureEntry) {
      await this.cache.set(cacheKey, 'null');
      return defaultValue;
    } else {
      await this.cache.set(cacheKey, Boolean(featureEntry.enabled));
      return featureEntry.enabled;
    }
  }

  async enableGroup(scope: string) {
    const cacheKey = `group:${scope}`;
    await this.db.prisma.groups.upsert({
      where: { id: scope },
      create: { id: scope, enabled: true },
      update: { enabled: true },
    });
    await this.cache.set(cacheKey, 'true');
    await Promise.all(
      (await this.cache.listPrefix(`feature:${scope}:`)).map((k) =>
        this.cache.delete(k),
      ),
    );
  }

  async disableGroup(scope: string) {
    const cacheKey = `group:${scope}`;
    await this.db.prisma.groups.upsert({
      where: { id: scope },
      create: { id: scope, enabled: false },
      update: { enabled: false },
    });
    await this.cache.set(cacheKey, 'false');
    await Promise.all(
      (await this.cache.listPrefix(`feature:${scope}:`)).map((k) =>
        this.cache.set(k, 'false'),
      ),
    );
  }

  async enableFeature(scope: string, feature: string) {
    if (!this.groupEnabled(scope)) return false;
    const cacheKey = `feature:${scope}:${feature}`;
    await this.db.prisma.featureEnables.upsert({
      where: { scope_feature: { scope, feature } },
      create: { scope, feature, enabled: true },
      update: { enabled: true },
    });
    await this.cache.set(cacheKey, 'true');
    return true;
  }

  async disableFeature(scope: string, feature: string) {
    const cacheKey = `feature:${scope}:${feature}`;
    await this.db.prisma.featureEnables.upsert({
      where: { scope_feature: { scope, feature } },
      create: { scope, feature, enabled: false },
      update: { enabled: false },
    });
    await this.cache.set(cacheKey, 'false');
  }
}

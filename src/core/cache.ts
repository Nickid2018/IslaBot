import { Disposable, injectable, singleton } from 'tsyringe';

export const CACHE_TOKEN = Symbol('CACHE_TOKEN');

export interface ICache extends Disposable {
  set(key: string, value: any, ttl?: number): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  delete(key: string): Promise<void>;
}

type DefaultMemoryCacheEntry = {
  value: any;
  timeExpired: number;
};

@injectable({ token: CACHE_TOKEN })
@singleton()
class DefaultMemoryCache implements ICache {
  private readonly cacheMap = new Map<string, DefaultMemoryCacheEntry>();
  private readonly intervalKey;

  constructor() {
    this.intervalKey = setInterval(() => {
      [...this.cacheMap.keys()]
        .filter((k) => this.isExpired(k))
        .forEach((k) => this.cacheMap.delete(k));
    }, 1000);
  }

  private isExpired(key: string) {
    return (this.cacheMap.get(key)?.timeExpired ?? 0) <= Date.now();
  }

  async delete(key: string) {
    this.cacheMap.delete(key);
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (this.isExpired(key)) this.cacheMap.delete(key);
    return this.cacheMap.get(key)?.value;
  }

  async set(key: string, value: any, ttl?: number) {
    this.cacheMap.set(key, {
      value,
      timeExpired: ttl ? Date.now() + ttl : Number.MAX_SAFE_INTEGER,
    });
  }

  dispose(): void {
    this.cacheMap.clear();
    clearInterval(this.intervalKey);
  }
}

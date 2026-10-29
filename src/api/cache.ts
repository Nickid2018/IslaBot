import { Disposable, injectable, singleton } from 'tsyringe';

export const CACHE_TOKEN = Symbol('CACHE_TOKEN');

export interface ICache extends Disposable {
  set(key: string, value: any, ttl?: number): void;
  get<T>(key: string): T | undefined;
  delete(key: string): void;
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
    return (
      (this.cacheMap.get(key)?.timeExpired ?? Number.MAX_SAFE_INTEGER) >
      Date.now()
    );
  }

  delete(key: string): void {
    this.cacheMap.delete(key);
  }

  get<T>(key: string): T | undefined {
    if (this.isExpired(key)) this.cacheMap.delete(key);
    return this.cacheMap.get(key)?.value;
  }

  set(key: string, value: any, ttl?: number): void {
    this.cacheMap.set(key, { value, timeExpired: ttl ? Date.now() + ttl : -1 });
  }

  dispose(): void {
    this.cacheMap.clear();
    clearInterval(this.intervalKey);
  }
}

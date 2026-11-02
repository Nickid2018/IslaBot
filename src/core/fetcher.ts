import { injectable } from 'tsyringe';
import { Logger } from './logger';

const FETCH_UA = 'IslaBot/1.0';

export function retries<A extends any[], T>(
  func: (...args: A) => Promise<T | null>,
  times: number,
) {
  return async (...args: A) => {
    for (let i = 0; i < times; i++) {
      const result = await func(...args);
      if (result) return result;
    }
    return null;
  };
}

@injectable()
export class Fetcher {
  constructor(private readonly logger: Logger) {}

  async fetch(url: URL | string | Request, init?: RequestInit) {
    return await fetch(url, {
      ...init,
      headers: { ...init?.headers, 'User-Agent': FETCH_UA },
    });
  }

  fetchJson = async (url: URL | string | Request, init?: RequestInit) => {
    try {
      const resp = await this.fetch(url, init);
      if (!resp.ok) {
        this.logger.warn(
          {
            status: resp.status,
            content:
              resp.status != 404 && resp.status != 403
                ? await resp.text()
                : '<dropped>',
          },
          `failed to fetch ${url}`,
        );
        return null;
      }
      return await resp.json();
    } catch (e) {
      this.logger.warn(e, `failed to fetch ${url}`);
      return null;
    }
  };

  fetchText = async (url: URL | string | Request, init?: RequestInit) => {
    try {
      const resp = await this.fetch(url, init);
      if (!resp.ok) {
        this.logger.warn(
          {
            status: resp.status,
            content:
              resp.status != 404 && resp.status != 403
                ? await resp.text()
                : '<dropped>',
          },
          `failed to fetch ${url}`,
        );
        return null;
      }
      return await resp.text();
    } catch (e) {
      this.logger.warn(e, `failed to fetch ${url}`);
      return null;
    }
  };

  fetchBlob = async (url: URL | string) => {
    try {
      const resp = await this.fetch(url);
      if (!resp.ok) {
        this.logger.warn(
          {
            status: resp.status,
            content:
              resp.status != 404 && resp.status != 403
                ? await resp.text()
                : '<dropped>',
          },
          `failed to fetch image ${url}`,
        );
        return null;
      }
      return Buffer.from(await resp.arrayBuffer());
    } catch (e) {
      this.logger.warn(e, `failed to fetch image ${url}`);
      return null;
    }
  };
}

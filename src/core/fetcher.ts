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

  async _logNotOK(resp: Response) {
    this.logger.warn(
      {
        status: resp.status,
        content:
          resp.status != 404 && resp.status != 403
            ? await resp.text()
            : '<dropped>',
      },
      `failed to fetch ${resp.url}`,
    );
  }

  fetchJson = async (url: URL | string | Request, init?: RequestInit) => {
    try {
      const resp = await this.fetch(url, init);
      if (!resp.ok) return await this._logNotOK(resp);
      return await resp.json();
    } catch (e) {
      return this.logger.warn(e, `failed to fetch ${url}`);
    }
  };

  fetchText = async (url: URL | string | Request, init?: RequestInit) => {
    try {
      const resp = await this.fetch(url, init);
      if (!resp.ok) return this._logNotOK(resp);
      return await resp.text();
    } catch (e) {
      return this.logger.warn(e, `failed to fetch ${url}`);
    }
  };

  fetchTextNoExcept = async (
    url: URL | string | Request,
    init?: RequestInit,
  ) => {
    try {
      const resp = await this.fetch(url, init);
      return await resp.text();
    } catch (e) {
      return this.logger.warn(e, `failed to fetch ${url}`);
    }
  };

  fetchBlob = async (url: URL | string) => {
    try {
      const resp = await this.fetch(url);
      if (!resp.ok) return this._logNotOK(resp);
      return Buffer.from(await resp.arrayBuffer());
    } catch (e) {
      return this.logger.warn(e, `failed to fetch ${url}`);
    }
  };

  getRedirectLocation = async (url: string) => {
    try {
      const resp = await this.fetch(url, { redirect: 'manual' });
      if (!resp.ok) return await this._logNotOK(resp);
      if (!resp.redirected) return this.logger.warn(`'${url}' not redirected`);
      return resp.headers.get('Location');
    } catch (e) {
      return this.logger.warn(e, `failed to fetch ${url}`);
    }
  };
}

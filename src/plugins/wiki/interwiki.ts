import { injectable, singleton } from 'tsyringe';
import { retryFetch, uaFetch, WikiInstance } from './wiki';
import { JSDOM } from 'jsdom';
import { Logger } from '../../core/logger';
import * as url from 'node:url';

export const INTERWIKI_QUERY = encodeURI(
  '?action=query&format=json&meta=siteinfo&siprop=interwikimap',
);

@injectable()
@singleton()
export class InterwikiStorage {
  private readonly storage: Map<
    string,
    Map<string, Promise<WikiInstance | string>>
  > = new Map();
  private readonly wikiInstances = new Map<string, WikiInstance>();

  constructor(private readonly logger: Logger) {}

  async findInterwikis(api: string) {
    if (this.storage.has(api)) return [...this.storage.get(api)!.keys()];
    const resp = await retryFetch(api + INTERWIKI_QUERY, 3);
    const interwikiMap = new Map<string, Promise<WikiInstance | string>>();
    this.storage.set(api, interwikiMap);
    if (!resp.ok) {
      this.logger.warn(
        `failed to find interwikis for '${api}', status=${resp.status}, body=${await resp.text()}`,
      );
      return [];
    }
    const map = (await resp.json())?.query?.interwikimap as any[];
    map.forEach((e) =>
      interwikiMap.set(
        e.prefix,
        (async () => {
          try {
            const page = await uaFetch(e.url);
            const pageContent = await page.text();
            const dom = JSDOM.fragment(pageContent);
            if (!dom) return e.url;
            const meta = dom.querySelector('link[rel=EditURI]');
            if (!meta) return e.url;
            const apiURL = new URL((meta as HTMLLinkElement).href);
            apiURL.search = '';
            const url = apiURL.toString();
            if (!this.wikiInstances.has(url))
              this.wikiInstances.set(url, new WikiInstance(this.logger, url));
            return this.wikiInstances.get(url)!;
          } catch (e) {
            return url;
          }
        })(),
      ),
    );
    return [...interwikiMap.keys()];
  }

  async getInterwiki(api: string, interwiki: string) {
    return this.storage.get(api)?.get(interwiki);
  }

  getWikiInstance(api: string) {
    if (!this.wikiInstances.has(api))
      this.wikiInstances.set(api, new WikiInstance(this.logger, api));
    return this.wikiInstances.get(api)!;
  }
}

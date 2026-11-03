import { injectable, singleton } from 'tsyringe';
import { WikiInstance } from './wiki';
import { JSDOM } from 'jsdom';
import { Logger } from '../../core/logger';
import { Fetcher, retries } from '../../core/fetcher';

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
  private readonly fetchJson;
  private readonly fetchText;

  constructor(
    private readonly logger: Logger,
    private readonly fetcher: Fetcher,
  ) {
    this.fetchJson = retries(fetcher.fetchJson, 3);
    this.fetchText = retries(fetcher.fetchTextNoExcept, 3);
  }

  async findInterwikis(api: string) {
    if (this.storage.has(api)) return [...this.storage.get(api)!.keys()];
    const interwikiMap = new Map<string, Promise<WikiInstance | string>>();
    this.storage.set(api, interwikiMap);
    const json = await this.fetchJson(api + INTERWIKI_QUERY);
    if (!json) {
      this.logger.warn(`failed to find interwikis for '${api}'`);
      return [];
    }
    const map = json.query?.interwikimap as any[];
    map.forEach((e) =>
      interwikiMap.set(
        e.prefix,
        (async () => {
          try {
            const page = await this.fetchText(e.url);
            if (!page) {
              this.logger.warn(`failed to fetch info for '${e.url}'`);
              return e.url;
            }
            const dom = JSDOM.fragment(page);
            if (!dom) return e.url;
            const meta = dom.querySelector('link[rel=EditURI]');
            if (!meta) return e.url;
            const urlStr = (meta as HTMLLinkElement).href;
            const apiURL = new URL(
              urlStr.startsWith('//') ? `https:${urlStr}` : urlStr,
            );
            apiURL.search = '';
            const url = apiURL.toString();
            if (!this.wikiInstances.has(url))
              this.wikiInstances.set(
                url,
                new WikiInstance(this.logger, this.fetcher, url),
              );
            return this.wikiInstances.get(url)!;
          } catch (err) {
            this.logger.error(err);
            return e.url;
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
      this.wikiInstances.set(
        api,
        new WikiInstance(this.logger, this.fetcher, api),
      );
    return this.wikiInstances.get(api)!;
  }
}

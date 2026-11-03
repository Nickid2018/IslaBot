import { Logger } from '../../core/logger';
import { Fetcher, retries } from '../../core/fetcher';

export const META_INFO_QUERY = encodeURI(
  '?action=query&format=json&meta=siteinfo&siprop=extensions|general|namespaces|namespacealiases',
);
export const PAGE_INFO_QUERY = encodeURI(
  '?action=query&format=json&prop=info|imageinfo|pageprops|templates&ppprop=disambiguation&iiprop=url|mime&redirects=1&titles=',
);
export const PAGE_INFO_QUERY_MOEGIRL = encodeURI(
  '?action=query&format=json&prop=info|pageprops|templates&ppprop=disambiguation&iiprop=url|mime&redirects=1&titles=',
);
export const PAGE_PARSE = encodeURI(
  '?action=parse&format=json&prop=wikitext&page=',
);
export const PAGE_PARSE_SECTIONS = encodeURI(
  '?action=parse&format=json&prop=sections&page=',
);
export const TEXT_EXTRACTS = encodeURI(
  '?action=query&format=json&prop=extracts&exchars=200&exsectionformat=plain&explaintext=1&exintro=1&titles=',
);
export const SEARCH = encodeURI(
  '?action=query&format=json&list=search&srenablerewrites=true&srprop=&srwhat=text&',
);

export type PageInfo = {
  type: string;
  content: string;
  url?: URL;
  redirect_to?: string;
  redirect_frag?: string;
  normalized_to?: string;
  multiple?: boolean;
  files?: { url: string; mime: string }[];
  sections?: string[];
  sectionId?: string;
  similarTitles?: string[];
};

export class WikiInstance {
  base: string = '';
  articleURL: string = '';
  scriptURL: string = '';
  mainPageName: string = '';
  namespaces: Map<string, number> = new Map<string, number>();
  extensions: string[] = [];

  private readonly retryFetch;

  readonly ready: Promise<boolean>;

  constructor(
    private readonly logger: Logger,
    private readonly fetcher: Fetcher,
    readonly apiURL: string,
  ) {
    const retryFetch = retries(fetcher.fetchJson, 3);
    this.retryFetch = retryFetch;
    this.ready = (async () => {
      try {
        this.base = 'https://' + new URL(this.apiURL).host;
        const result = await retryFetch(apiURL + META_INFO_QUERY);
        if (!result) {
          logger.warn(`cannot resolve wiki info for ${apiURL}`);
          return false;
        }
        this.articleURL = result.query?.general?.articlepath || '';
        this.scriptURL = result.query?.general?.script || '';
        this.mainPageName = result.query?.general?.mainpage || '';
        Object.entries(result.query?.namespaces || {}).forEach(
          (e: [string, any]) =>
            this.namespaces.set(e[1]['*'].toLowerCase(), e[1].id),
        );
        result.query?.namespacealiases?.forEach?.((e: any) =>
          this.namespaces.set(e['*'].toLowerCase(), e.id),
        );
        this.extensions = result.query?.extensions?.map?.((e: any) => e.name);
      } catch (e) {
        logger.error(e);
      }
      return true;
    })();
  }

  async resolveArticle(title: string, section: string) {
    await this.ready;
    const url = new URL(
      encodeURI(this.articleURL.replace('$1', title)),
      this.base,
    );
    if (section) url.hash = encodeURI(section);
    return url;
  }

  async resolveScript(pageId: number, section: string) {
    await this.ready;
    const url = new URL(this.scriptURL, this.base);
    url.searchParams.set('curid', String(pageId));
    if (section) url.hash = encodeURI(section);
    return url;
  }

  async getPageInfo(query: string, section: string): Promise<PageInfo> {
    if (!(await this.ready))
      return { type: 'error', content: '无法访问此 wiki' };
    if (!query) return await this.getPageInfo(this.mainPageName, section);

    const nSplit = query.indexOf(':');
    const namespace = nSplit > -1 ? query.substring(0, nSplit) : '';
    const title = nSplit > -1 ? query.substring(nSplit + 1) : query;
    if (namespace && !this.namespaces.has(namespace.toLowerCase()))
      return { type: 'page_not_found', content: '没有找到命名空间' };
    if (section) section = section.replaceAll(' ', '_');
    if (title.match(/\d{1.3}(\.\d{1,3}){3}/))
      return { type: 'normal', content: '匿名用户页' };

    const pageQueryUrl =
      this.apiURL +
      (this.apiURL.includes('moegirl')
        ? PAGE_INFO_QUERY_MOEGIRL
        : PAGE_INFO_QUERY) +
      encodeURI(query);
    const pageData = await this.retryFetch(pageQueryUrl);
    if (!pageData) {
      this.logger.warn(`cannot search wiki '${query}'`);
      return { type: 'error', content: '未能查询 wiki' };
    }

    const entries = Object.entries(pageData?.query?.pages || {});
    const pageInfo = entries[0]?.[1] as any;
    if (!pageInfo || 'missing' in pageInfo) {
      const titles = await this.searchTitle([namespace], title, 5);
      return {
        type: 'page_not_found',
        content: '没有找到对应标题的页面',
        similarTitles: titles,
      };
    }
    if ('special' in pageInfo)
      return {
        type: 'special_page',
        content: '特殊页面',
        url: await this.resolveArticle(query, section),
      };

    const pageId = pageInfo.pageid;
    if ('redirects' in pageData.query) {
      const redirect = pageData.query.redirects[0];
      const to = redirect.to;
      const frag = redirect.tofragment || section;
      const redirected = await this.getPageInfo(to, frag);
      return {
        redirect_to: to,
        redirect_frag: frag,
        ...redirected,
        multiple: !!redirected.redirect_to || !!redirected.normalized_to,
      };
    }
    if ('normalized' in pageData.query) {
      const redirect = pageData.query.normalized[0];
      const to = redirect.to;
      const redirected = await this.getPageInfo(to, section);
      return {
        normalized_to: to,
        ...redirected,
        multiple: !!redirected.redirect_to || !!redirected.normalized_to,
      };
    }

    if (pageInfo.pageprops?.disambiguation)
      return {
        type: 'disambiguation',
        content: '消歧义页面',
        url: await this.resolveScript(pageId, section),
      };

    if (Array.isArray(pageInfo.imageinfo)) {
      return {
        type: 'file',
        content: '文件页面',
        url: await this.resolveScript(pageId, section),
        files: pageInfo.imageinfo as { url: string; mime: string }[],
      };
    }

    const useTemplates = pageInfo?.templates?.map((e: any) => e.title) || [];
    const doc = useTemplates.includes('Template:Documentation');
    const module = pageInfo.contentmodel === 'Scribunto';
    if (doc || module) section = '';
    let descriptionTitle = query;

    if (doc) {
      const docData = await this.retryFetch(
        this.apiURL + PAGE_PARSE + encodeURI(query),
      );
      if (!docData) {
        this.logger.warn(`cannot parse wiki '${query}'`);
        return {
          type: 'documentation',
          content: '包含文档的页面（无描述）',
          url: await this.resolveScript(pageId, section),
        };
      }

      const docWikitext: string = docData?.parse?.wikitext?.['*'] || '';
      const matcher = docWikitext.match(
        /\{\{[Dd]ocumentation(?:\|([\s\S]+?))?}}/,
      );
      if (!matcher)
        return {
          type: 'documentation',
          content: '包含文档的页面（无描述）',
          url: await this.resolveScript(pageId, section),
        };
      descriptionTitle = matcher[1] || query + '/doc';
    }

    if (module) {
      descriptionTitle = query + '/doc';
      const docData = await this.retryFetch(
        this.apiURL + PAGE_INFO_QUERY + encodeURI(descriptionTitle),
      );
      if (!docData) {
        this.logger.warn(`cannot search wiki '${query}'`);
        return {
          type: 'documentation',
          content: '模块页面（无描述）',
          url: await this.resolveScript(pageId, section),
        };
      }

      const entries = Object.entries(docData?.query?.pages || {});
      if (entries.length === 0 || (entries[0][1] as any).missing)
        return {
          type: 'documentation',
          content: '模块页面（无描述）',
          url: await this.resolveScript(pageId, section),
        };
    }

    if (this.extensions.includes('TextExtracts') && !section) {
      const descData = await this.retryFetch(
        this.apiURL + TEXT_EXTRACTS + encodeURI(descriptionTitle),
      );
      if (descData) {
        const entries = Object.entries(descData?.query?.pages || {});
        const desc = (entries?.[0]?.[1] as any)?.extract;
        if (desc)
          return {
            type: doc || module ? 'documentation' : 'normal',
            content: desc,
            url: await this.resolveScript(pageId, section),
          };
      } else {
        this.logger.warn(`cannot extract wiki '${query}'`);
      }
    }

    let parseUrl = this.apiURL + PAGE_PARSE + encodeURI(descriptionTitle);
    let sectionId = '';
    if (section) {
      const sectionData = await this.retryFetch(
        this.apiURL + PAGE_PARSE_SECTIONS + encodeURI(descriptionTitle),
      );
      if (!sectionData) {
        this.logger.warn(`cannot query wiki '${query}'`);
        return {
          type: 'section_not_found',
          content: '无法查找章节信息',
          url: await this.resolveScript(pageId, section),
        };
      }

      sectionId = sectionData?.parse?.sections?.find?.(
        (e: any) => e.anchor === section,
      )?.index;
      if (!sectionId)
        return {
          type: 'section_not_found',
          content: '没有找到对应的章节',
          url: await this.resolveScript(pageId, ''),
          sections:
            sectionData?.parse?.sections?.map?.((e: any) =>
              e.anchor.replace('_', ''),
            ) || [],
        };
      parseUrl += '&section=' + sectionId;
    }

    const docData = await this.retryFetch(parseUrl);
    if (!docData) {
      this.logger.warn(`cannot parse wiki '${query}'`);
      return {
        type: 'error',
        content: '获取页面内容失败',
        url: await this.resolveScript(pageId, section),
      };
    }

    let docWikitext: string = docData?.parse?.wikitext?.['*'] || '';
    if (section)
      docWikitext = docWikitext.substring(docWikitext.indexOf('\n')).trim();
    docWikitext = docWikitext.substring(0, docWikitext.indexOf('\n')).trim();
    return {
      type: doc || module ? 'documentation' : 'normal',
      content: docWikitext,
      url: await this.resolveScript(pageId, section),
      sectionId,
    };
  }

  async searchTitle(
    namespaces: string[],
    title: string,
    limit: number,
  ): Promise<string[]> {
    const ns = namespaces
      .map((val) => (val ? this.namespaces.get(val) : 0))
      .filter(v => typeof v === 'number')
      .join('|');
    const query = encodeURI(
      this.apiURL +
        SEARCH +
        'srnamespace=' +
        (ns || '*') +
        '&srsearch=' +
        title +
        '&srlimit=' +
        limit,
    );
    const data = await this.retryFetch(query);
    return data?.query?.search?.map((l: any) => l.title) ?? [];
  }
}

export function shouldRenderPage(pageInfo: PageInfo) {
  if (!pageInfo.url) return false;
  return ['special_page', 'documentation', 'disambiguation', 'normal'].includes(
    pageInfo.type,
  );
}

import { inject, injectable, singleton } from 'tsyringe';
import { Logger } from '../../core/logger';
import { CACHE_TOKEN, ICache } from '../../core/cache';
import { Fetcher, retries } from '../../core/fetcher';
import { JSDOM } from 'jsdom';
import { WebRenderer } from '../webrenderer';
import { Config } from '../../core/config';
import { WikiInstance } from './wiki';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';

const PAGE_PRASE = `?action=parse&format=json&prop=text&preview=true&`;
const INFOBOX_CLASS_LIST = [
  'moe-infobox',
  'notaninfobox',
  'infoboxtable',
  'infoboxSpecial',
  'infotemplatebox',
  'infobox2',
  'tpl-infobox',
  'portable-infobox',
  'toccolours',
  'infobox',
];
const DOCUMENTATION_CLASS_LIST = ['documentation', 'template-documentation'];
const SPECIAL_CLASS_LIST = ['diff'];

@injectable()
@singleton()
export class WikiRenderer {
  private readonly tempDir;

  constructor(
    @inject(CACHE_TOKEN) private readonly cache: ICache,
    private readonly fetcher: Fetcher,
    private readonly logger: Logger,
    private readonly webRenderer: WebRenderer,
    private readonly cfg: Config,
  ) {
    this.tempDir = (async () => {
      try {
        const systemTmpDir = await fs.realpath(os.tmpdir());
        return await fs.mkdtemp(path.join(systemTmpDir, 'my-app-'));
      } catch (e) {
        logger.error(e, 'cannot create temp dir');
      }
    })();
  }

  cleanDocument(jsdom: JSDOM, element: HTMLElement, urlStr: string) {
    const { HTMLElement, document } = jsdom.window;
    while (element !== document.body) {
      if (!element.parentElement) break;
      const collection = element.parentElement.children;
      if (collection)
        [...collection]
          .filter(
            (i) =>
              i !== element && i.tagName !== 'STYLE' && i.tagName !== 'SCRIPT',
          )
          .forEach((i) => i.remove());
      element = element.parentElement;
      if (element.tagName === 'TEMPLATE') {
        const child = [...element.children].find(
          (v) => v instanceof HTMLElement,
        );
        if (!child) continue;
        element.parentElement?.appendChild(child);
        element.remove();
        element = child;
      }
    }

    const elements = [element];
    while (elements.length) {
      const nowElement = elements.shift()!;
      if (nowElement.classList.contains('navbox')) continue;
      nowElement.classList.remove('mw-collapsible');
      nowElement.classList.remove('mw-collapsed');
      nowElement.classList.remove('collapsible');
      nowElement.classList.remove('collapsed');
      elements.push(
        ...[...nowElement.children].filter((v) => v instanceof HTMLElement),
      );
    }

    document.body.classList.add('heimu_toggle_on');
    const inlineStyles = document.createElement('style');
    inlineStyles.innerHTML = `body.heimu_toggle_on .heimu, body.heimu_toggle_on .heimu rt { background-color: rgba(37,37,37,0.13) !important; }`;
    document.head.appendChild(inlineStyles);
    [...document.getElementsByClassName('custom-modal')].forEach((el) =>
      el.remove(),
    );

    const url = new URL(urlStr);
    const baseUrl = `${url.protocol}//${url.host}`;
    const base = document.createElement('base');
    base.href = baseUrl;
    document.head.prepend(base);
  }

  async ifNoCache(cacheKey: string, func: () => Promise<Uint8Array | null>) {
    const cachedFile = await this.cache.get<string>(cacheKey);
    if (cachedFile) {
      try {
        return await fs.readFile(cachedFile);
      } catch (e) {
        this.logger.error(e, 'cannot load cached file, invalidate it');
        await this.cache.delete(cacheKey);
      }
    }
    const data = await func();
    if (!data) return null;
    const buffer = Buffer.from(data);
    const tempDir = await this.tempDir;
    if (!tempDir) return buffer;
    try {
      const tempFile = Math.random().toString(36).substring(2);
      await fs.writeFile(`${tempDir}/${tempFile}`, buffer);
      await this.cache.set(cacheKey, `${tempDir}/${tempFile}`);
    } catch (e) {
      this.logger.error(e, 'cannot write to file');
    }
    return buffer;
  }

  async shot(content: string, id: string, urlStr: string) {
    const document = new JSDOM(content);
    const element = document.window.document.getElementById(id);
    if (!element) {
      this.logger.warn(`no valid #${id} for '${urlStr}'`);
      return null;
    }
    this.cleanDocument(document, element, urlStr);
    return await this.webRenderer.render(
      document.window.document.documentElement.outerHTML,
      AbortSignal.timeout(this.cfg.getInt('wiki.render.timeout', 30000)),
      `#${id}`,
      {
        width: this.cfg.getInt('wiki.render.width', 1920),
        height: this.cfg.getInt('wiki.render.height', 1080),
        deviceScaleFactor: this.cfg.getInt('wiki.render.scale', 2),
      },
    );
  }

  async shotClassList(content: string, classes: string[], urlStr: string) {
    const document = new JSDOM(content);
    const element = classes
      .map((c) => document.window.document.getElementsByClassName(c))
      .filter((l) => l.length > 0)
      .at(0)
      ?.item(0);
    if (!element) {
      this.logger.warn(`no valid .{${classes.join()}} for '${urlStr}'`);
      return null;
    }
    element.id = Math.random().toString(36).substring(2);
    this.cleanDocument(document, element as HTMLElement, urlStr);
    return await this.webRenderer.render(
      document.window.document.documentElement.outerHTML,
      AbortSignal.timeout(this.cfg.getInt('wiki.render.timeout', 30000)),
      `#${element.id}`,
      {
        width: this.cfg.getInt('wiki.render.width', 1920),
        height: this.cfg.getInt('wiki.render.height', 1080),
        deviceScaleFactor: this.cfg.getInt('wiki.render.scale', 2),
      },
    );
  }

  async shotFullPage(url: string) {
    const cacheKey = `wiki:rendered:full:[${url}]`;
    return this.ifNoCache(cacheKey, async () => {
      const content = await retries(this.fetcher.fetchText, 3)(url);
      if (!content) {
        this.logger.warn(`cannot fetch document for '${url}'`);
        return null;
      }
      return await this.shot(content, 'mw-content-text', url);
    });
  }

  async shotSection(wiki: WikiInstance, title: string, sectionId: string) {
    const cacheKey = `wiki:rendered:section:[${wiki.apiURL}]:${title}:${sectionId}`;
    return this.ifNoCache(cacheKey, async () => {
      const parsed = await retries(
        this.fetcher.fetchJson,
        3,
      )(
        wiki.apiURL +
          PAGE_PRASE +
          `page=${title}&section=${sectionId}&sectionpreview=true`,
      );
      if (!parsed?.parse?.text?.['*']) {
        this.logger.warn('cannot parse section preview');
        return null;
      }
      const html = parsed.parse.text['*'] as string;
      return await this.shot(html, 'mw-content-text', wiki.apiURL);
    });
  }

  async shotInfobox(url: string) {
    const cacheKey = `wiki:rendered:infobox:[${url}]`;
    return this.ifNoCache(cacheKey, async () => {
      const content = await retries(this.fetcher.fetchText, 3)(url);
      if (!content) {
        this.logger.warn(`cannot fetch document for '${url}'`);
        return null;
      }
      return await this.shotClassList(content, INFOBOX_CLASS_LIST, url);
    });
  }

  async shotDocumentation(url: string) {
    const cacheKey = `wiki:rendered:documentation:[${url}]`;
    return this.ifNoCache(cacheKey, async () => {
      const content = await retries(this.fetcher.fetchText, 3)(url);
      if (!content) {
        this.logger.warn(`cannot fetch document for '${url}'`);
        return null;
      }
      return await this.shotClassList(content, DOCUMENTATION_CLASS_LIST, url);
    });
  }

  async shotSpecialPage(url: string) {
    const cacheKey = `wiki:rendered:full:[${url}]`;
    return this.ifNoCache(cacheKey, async () => {
      const content = await retries(this.fetcher.fetchText, 3)(url);
      if (!content) {
        this.logger.warn(`cannot fetch document for '${url}'`);
        return null;
      }
      return await this.shotClassList(content, SPECIAL_CLASS_LIST, url);
    });
  }
}

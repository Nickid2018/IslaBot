import { Disposable, injectable, singleton } from 'tsyringe';
import puppeteer, { Browser, Viewport } from 'puppeteer';
import { scrollPageToBottom } from 'puppeteer-autoscroll-down';
import { Logger } from '../../core/logger';

@injectable()
@singleton()
export class WebRenderer implements Disposable {
  private readonly browser: Promise<Browser>;

  constructor(private readonly logger: Logger) {
    this.browser = puppeteer.launch({ headless: true });
  }

  async render(
    html: string,
    signal: AbortSignal,
    selector: string = '',
    viewport: Viewport | null = null,
    script: string = '',
  ) {
    const browser = await this.browser;
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', signal });
    await page.setViewport(viewport);
    await scrollPageToBottom(page, { size: 250, delay: 100 });
    await page.waitForNetworkIdle({ signal, concurrency: 2 });
    if (script) await page.waitForFunction(script, { signal });
    if (selector) {
      const element = await page.waitForSelector(selector, { signal });
      if (!element) {
        this.logger.warn(`cannot find element ${selector}`);
        return null;
      }
      await element.scrollIntoView();
      return await element.screenshot({ captureBeyondViewport: true });
    } else {
      return await page.screenshot({ fullPage: true });
    }
  }

  async dispose() {
    return (await this.browser)?.close();
  }
}

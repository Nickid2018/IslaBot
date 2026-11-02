import { injectable } from 'tsyringe';
import {
  COMMAND_CAUGHT,
  COMMAND_PROVIDER_TOKEN,
  COMMAND_SKIPPED,
  CommandResult,
  feature,
  ICommandProvider,
  permission,
  regex,
} from '../../api/command';
import { Features } from '../../core/features';
import { Logger } from '../../core/logger';
import { InterwikiStorage } from './interwiki';
import { Database } from '../../core/database';
import { image, IProvider, Message, Target, text } from '../../providers';
import { PermissionLevel } from '../../../generated/prisma/enums';
import { Permission } from '../../core/permission';
import { shouldRenderPage } from './wiki';
import { WikiRenderer } from './renderer';

@injectable({ token: COMMAND_PROVIDER_TOKEN })
export class WikiCommands implements ICommandProvider {
  constructor(
    private readonly permission: Permission,
    private readonly features: Features,
    private readonly logger: Logger,
    private readonly storage: InterwikiStorage,
    private readonly db: Database,
    private readonly renderer: WikiRenderer,
  ) {}

  @regex(/\[\[(.+?)]]/)
  @feature('wiki.inline')
  @permission(PermissionLevel.NORMAL)
  async doWikiInline(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ): Promise<CommandResult> {
    if (!match) return COMMAND_SKIPPED;
    return await this.doWiki(provider, scope, match[1]);
  }

  @regex(/^~wiki (.+)$/)
  @feature('wiki.command', true)
  @permission(PermissionLevel.NORMAL)
  async doWikiGlobal(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ): Promise<CommandResult> {
    if (!match) return COMMAND_SKIPPED;
    return await this.doWiki(provider, scope, match[1]);
  }

  @regex(/^~wikiadd ([^ ]+) (.+)$/)
  @feature('wiki', true)
  @permission(PermissionLevel.ADMIN)
  async addWiki(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ): Promise<CommandResult> {
    if (!match) return COMMAND_SKIPPED;
    const prefix = match[1];
    const api = match[2];
    const globalScope = `${provider.id()}:${scope}`;
    await this.db.prisma.scopeInterwiki.upsert({
      where: { scope_prefix: { scope: globalScope, prefix } },
      create: { scope: globalScope, prefix, url: api },
      update: { url: api },
    });
    await provider.send(scope, text(`已添加 wiki '${prefix}'`));
    return COMMAND_CAUGHT;
  }

  @regex(/^~wikiremove (.+)$/)
  @feature('wiki', true)
  @permission(PermissionLevel.ADMIN)
  async removeWiki(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ): Promise<CommandResult> {
    if (!match) return COMMAND_SKIPPED;
    const prefix = match[1];
    const globalScope = `${provider.id()}:${scope}`;
    await this.db.prisma.scopeInterwiki.delete({
      where: { scope_prefix: { scope: globalScope, prefix } },
    });
    await this.db.prisma.startWikis.delete({
      where: { scope: globalScope, prefix },
    });
    await provider.send(scope, text(`已移除 wiki '${prefix}'`));
    return COMMAND_CAUGHT;
  }

  @regex(/^~wikistart (.+)$/)
  @feature('wiki', true)
  @permission(PermissionLevel.ADMIN)
  async setStartWiki(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ): Promise<CommandResult> {
    if (!match) return COMMAND_SKIPPED;
    const prefix = match[1];
    const globalScope = `${provider.id()}:${scope}`;
    await this.db.prisma.startWikis.upsert({
      where: { scope: globalScope },
      create: { scope: globalScope, start: prefix },
      update: { start: prefix },
    });
    await provider.send(scope, text(`已设置起始 wiki 为'${prefix}'`));
    return COMMAND_CAUGHT;
  }

  async doWiki(
    provider: IProvider,
    scope: Target,
    query: string,
  ): Promise<CommandResult> {
    const globalScope = `${provider.id()}:${scope}`;
    const scopeInterwikiMap = await this.db.prisma.scopeInterwiki.findMany({
      where: { scope: globalScope },
    });
    const groupStartWiki = (
      await this.db.prisma.startWikis.findUnique({
        where: { scope: globalScope },
      })
    )?.start;
    const interwikis = scopeInterwikiMap.map((e) => e.prefix);
    const interwikiMap = new Map(
      scopeInterwikiMap.map((e) => [e.prefix, e.url]),
    );

    const sectionSplit = query.indexOf('#');
    const section = sectionSplit > -1 ? query.substring(sectionSplit + 1) : '';
    if (sectionSplit > -1) query = query.substring(0, sectionSplit);

    let splitIndex = query.indexOf(':');
    let nowPrefix = splitIndex > -1 ? query.substring(0, splitIndex) : '';
    let nowQuery = splitIndex > -1 ? query.substring(splitIndex + 1) : query;

    if (!nowPrefix && !groupStartWiki) {
      await provider.send(scope, text(`未设置起始 wiki'`));
      return COMMAND_CAUGHT;
    }

    if (nowPrefix && !interwikis.includes(nowPrefix)) {
      if (!groupStartWiki) {
        await provider.send(scope, text(`未设置起始 wiki'`));
        return COMMAND_CAUGHT;
      }
      nowPrefix = groupStartWiki;
      nowQuery = query;
    }
    if (!nowPrefix) {
      nowPrefix = groupStartWiki || '';
    }

    let nowWiki = interwikiMap.get(nowPrefix);
    if (!nowWiki) {
      await provider.send(scope, text(`未知 wiki`));
      return COMMAND_CAUGHT;
    }

    while (true) {
      query = nowQuery;
      splitIndex = query.indexOf(':');
      if (splitIndex < 0) break;

      nowPrefix = query.substring(0, splitIndex);
      nowQuery = query.substring(splitIndex + 1);
      const availInterwiki = await this.storage.findInterwikis(nowWiki);
      if (!availInterwiki.includes(nowPrefix)) break;

      const next = await this.storage.getInterwiki(nowWiki, nowPrefix);
      if (!next) {
        this.logger.error('impossible route');
        return COMMAND_CAUGHT;
      }
      if (typeof next === 'string') {
        await provider.send(
          scope,
          text(`目标为外部链接 <${next.replace('$1', nowQuery)}>`),
        );
        return COMMAND_CAUGHT;
      }
      nowWiki = next.apiURL;
    }

    const wiki = this.storage.getWikiInstance(nowWiki);
    const pageInfo = await wiki.getPageInfo(query, section);
    this.logger.debug(pageInfo);

    let content = pageInfo.content;
    if (pageInfo.type === 'disambiguation') {
      content = `消歧义页面`;
    }
    if (pageInfo.redirect_to) {
      let redirectInfo = `页面重定向 -> ${pageInfo.redirect_to}`;
      if (pageInfo.redirect_frag) redirectInfo += `#${pageInfo.redirect_frag}`;
      if (pageInfo.multiple) redirectInfo += ` [多重重定向]`;
      content = redirectInfo + '\n' + content;
    } else if (pageInfo.normalized_to) {
      content = `页面标准化 -> ${pageInfo.normalized_to}\n${content}`;
    }
    if (pageInfo.files) {
      content += '\n文件列表：';
      pageInfo.files.forEach((file, i) => {
        content += `\n${i + 1}: ${file.url} (${file.mime})`;
      });
    }
    if (pageInfo.type === 'section_not_found' && pageInfo.sections) {
      content += '\n可查找的章节：';
      pageInfo.sections.forEach((section, i) => {
        content += `\n${i + 1}: ${section}`;
      });
    }
    if (pageInfo.url) content += '\n' + pageInfo.url.toString();
    await provider.send(scope, text(content));

    const featureFlag = `wiki.render.[${wiki.apiURL}]`;
    const pScope = `${provider.id()}:${scope}`;
    if (!(await this.features.featureEnabled(pScope, featureFlag)))
      return COMMAND_CAUGHT;
    if (pageInfo.files) {
      const img = pageInfo.files.filter((i) => i.mime.startsWith('image'));
      if (img.length === 0) return COMMAND_CAUGHT;
      if (img.length === 1) await provider.send(scope, image(img[0].url));
      else
        await provider.sendForward(
          scope,
          img.map((i, n) => image(i.url, n.toString())),
        );
      return COMMAND_CAUGHT;
    }

    if ((!shouldRenderPage(pageInfo) && !query.endsWith('#')) || !pageInfo.url)
      return COMMAND_CAUGHT;

    const finalName = pageInfo.normalized_to || pageInfo.redirect_to || query;
    const finalSection = pageInfo.redirect_frag || section;
    let buffer: Buffer | null = null;
    if (pageInfo.type === 'documentation')
      buffer = await this.renderer.shotDocumentation(pageInfo.url.toString());
    else if (pageInfo.type === 'disambiguation')
      buffer = await this.renderer.shotFullPage(pageInfo.url.toString());
    else if (pageInfo.type === 'special')
      buffer = await this.renderer.shotSpecialPage(pageInfo.url.toString());
    else if (query.endsWith('#'))
      buffer = await this.renderer.shotFullPage(pageInfo.url.toString());
    else if (finalSection)
      buffer = await this.renderer.shotSection(wiki, finalName, finalSection);
    else buffer = await this.renderer.shotInfobox(pageInfo.url.toString());

    if (buffer) await provider.send(scope, image(buffer, '*filtered*'));

    return COMMAND_CAUGHT;
  }

  commands() {
    return [
      this.doWikiInline,
      this.doWikiGlobal,
      this.addWiki,
      this.removeWiki,
      this.setStartWiki,
    ].map((f) => f.bind(this));
  }
}

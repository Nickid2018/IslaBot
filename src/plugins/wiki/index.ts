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
import { IProvider, Message, Target, text } from '../../providers';
import { PermissionLevel } from '../../../generated/prisma/enums';
import { Permission } from '../../core/permission';

export const ISLA_BOT_UA = 'IslaBot Wiki Plugin/1.0';

@injectable({ token: COMMAND_PROVIDER_TOKEN })
export class WikiCommands implements ICommandProvider {
  constructor(
    private readonly permission: Permission,
    private readonly features: Features,
    private readonly logger: Logger,
    private readonly storage: InterwikiStorage,
    private readonly db: Database,
  ) {}

  @regex(/\[\[(.+?)]]/)
  @feature('wiki.inline')
  @permission(PermissionLevel.NORMAL)
  async doWikiInline(
    provider: IProvider,
    target: Target,
    scope: Target,
    msgId: string,
    message: Message,
    match?: RegExpMatchArray,
  ): Promise<CommandResult> {
    if (!match) return COMMAND_SKIPPED;
    return await this.doWiki(provider, target, scope, msgId, message, match[1]);
  }

  @regex(/^~wiki (.+)$/)
  @feature('wiki.command', true)
  @permission(PermissionLevel.NORMAL)
  async doWikiGlobal(
    provider: IProvider,
    target: Target,
    scope: Target,
    msgId: string,
    message: Message,
    match?: RegExpMatchArray,
  ): Promise<CommandResult> {
    if (!match) return COMMAND_SKIPPED;
    return await this.doWiki(provider, target, scope, msgId, message, match[1]);
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
    target: Target,
    scope: Target,
    msgId: string,
    message: Message,
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
    const section =
      sectionSplit > -1 ? query.substring(0, sectionSplit + 1) : '';
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

    const wikiInstance = this.storage.getWikiInstance(nowWiki);
    const pageInfo = await wikiInstance.getPageInfo(query, section);
    this.logger.debug(pageInfo);

    let content = pageInfo.content;
    if (pageInfo.url) content += '\n' + pageInfo.url.toString();
    if (pageInfo.redirect_to) {
      let redirectInfo = `页面重定向 -> ${pageInfo.redirect_to}`;
      if (pageInfo.redirect_frag) redirectInfo += `#${pageInfo.redirect_frag}`;
      if (pageInfo.multiple) redirectInfo += ` [多重重定向]`;
      content = redirectInfo + '\n' + content;
    } else if (pageInfo.normalized_to) {
      content = `页面标准化 -> ${pageInfo.normalized_to}\n${content}`;
    }
    await provider.send(scope, text(content));

    return COMMAND_CAUGHT;
  }

  commands() {
    return [
      this.doWikiInline,
      this.doWikiGlobal,
      this.addWiki,
      this.removeWiki,
      this.setStartWiki
    ].map((f) => f.bind(this));
  }
}

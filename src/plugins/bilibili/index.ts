import { injectable } from 'tsyringe';
import {
  COMMAND_CAUGHT,
  COMMAND_PROVIDER_TOKEN,
  COMMAND_SKIPPED,
  feature,
  ICommandProvider,
  permission,
  regex,
} from '../../api/command';
import { Permission } from '../../core/permission';
import { Features } from '../../core/features';
import { Logger } from '../../core/logger';
import { image, IProvider, Message, Target, text } from '../../providers';
import { Fetcher } from '../../core/fetcher';

const AVID_PATTERN = /[aA][vV]([1-9]\d*)/;
const BVID_PATTERN =
  /[bB][vV][fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF]{10}/;

@injectable({ token: COMMAND_PROVIDER_TOKEN })
export class BilibiliCommands implements ICommandProvider {
  constructor(
    private readonly permission: Permission,
    private readonly features: Features,
    private readonly logger: Logger,
    private readonly fetcher: Fetcher,
  ) {}

  @feature('bilibili', true)
  @permission()
  @regex(AVID_PATTERN)
  async doAvid(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    try {
      const data = await this.fetcher.fetchJson(
        `https://api.bilibili.com/x/web-interface/view?aid=${match[1]}`,
      );
      await this.doInfo(provider, scope, match[0], data);
    } catch (e) {
      this.logger.error(e, 'cannot query bilibili video');
    }
    return COMMAND_CAUGHT;
  }

  @feature('bilibili', true)
  @permission()
  @regex(BVID_PATTERN)
  async doBvid(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    try {
      const data = await this.fetcher.fetchJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${match[0]}`,
      );
      await this.doInfo(provider, scope, match[0], data);
    } catch (e) {
      this.logger.error(e, 'cannot query bilibili video');
    }
    return COMMAND_CAUGHT;
  }

  @feature('bilibili', true)
  @permission()
  @regex(/https:\/\/b23\.tv\/[0-9a-zA-Z]+/)
  async doShortLink(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    try {
      const redirected = await this.fetcher.getRedirectLocation(match[0]);
      if (!redirected) return COMMAND_SKIPPED;

      const avid = redirected.match(AVID_PATTERN);
      if (avid) {
        const data = await this.fetcher.fetchJson(
          `https://api.bilibili.com/x/web-interface/view?aid=${avid[1]}`,
        );
        await this.doInfo(provider, scope, avid[0], data);
        return COMMAND_CAUGHT;
      }

      const bvid = redirected.match(BVID_PATTERN);
      if (bvid) {
        const data = await this.fetcher.fetchJson(
          `https://api.bilibili.com/x/web-interface/view?bvid=${bvid[0]}`,
        );
        await this.doInfo(provider, scope, bvid[0], data);
        return COMMAND_CAUGHT;
      }
    } catch (e) {
      this.logger.error(e, 'cannot query bilibili video');
    }
    return COMMAND_SKIPPED;
  }

  _formatTime(time: number) {
    if (time < 60) return `${time}s`;
    if (time < 3600) return `${Math.floor(time / 60)}m${time % 60}s`;
    return `${Math.floor(time / 3600)}h${Math.floor((time % 3600) / 60)}m${time % 60}s`;
  }

  async doInfo(provider: IProvider, scope: Target, name: string, data: any) {
    if (!data || !('code' in data))
      return await provider.send(scope, text('查询失败'));
    if (data.code !== 0)
      return await provider.send(
        scope,
        text(`查询失败，错误 ${data.code}（${data.message}）`),
      );
    data = data.data;

    const lines: string[] = [data.bvid];
    if (name !== data.bvid) lines.push(`[自动转换自 ${name}]`);
    lines.push(data.title);

    const copyright = data.copyright === 1 ? '[自制]' : '[转载]';
    if (data.staff) {
      const staffStr = data.staff
        .map((s: any) => `${s.name}/${s.title}`)
        .join(', ');
      lines.push(`${copyright} ${staffStr}`);
    } else {
      lines.push(`${copyright} ${data.owner?.name}`);
    }

    const pScope = `${provider.id()}:${scope}`;
    if (
      data.stat &&
      (await this.features.featureEnabled(pScope, 'bilibili.stat', true))
    ) {
      const stat = data.stat;
      lines.push(
        `播放 ${stat.view} | 弹幕 ${stat.danmaku} | 评论 ${stat.reply}`,
      );
      lines.push(
        `点赞 ${stat.like} | 硬币 ${stat.coin} | 收藏 ${stat.favorite} | 分享 ${stat.share}`,
      );
    }

    lines.push(
      `[发布于 ${new Date(data.pubdate * 1000).toLocaleDateString('zh-Hans-CN')}]`,
    );
    const length = this._formatTime(data.duration);
    if (data.videos?.length > 1)
      lines.push(`[总长度 ${length}，共 ${data.videos.length} 个视频]`);
    else lines.push(`[总长度 ${length}]`);

    const split = data.desc?.split('\n') || [];
    let buffered = 0;
    while (buffered < 200 && split.length > 0) {
      const line = split.shift();
      buffered += line.length;
      lines.push(line);
    }
    if (split.length > 1) lines.push('[...过长截断]');

    const total = lines.join('\n');
    if (data.pic) await provider.send(scope, [text(total), image(data.pic)]);
    else await provider.send(scope, text(total));
  }

  commands() {
    return [this.doAvid, this.doBvid, this.doShortLink];
  }
}

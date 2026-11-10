import { injectable, singleton } from 'tsyringe';
import {
  COMMAND_CAUGHT,
  COMMAND_PROVIDER_TOKEN,
  COMMAND_SKIPPED,
  feature,
  ICommandProvider,
  permission,
  regex,
  replied,
} from '../../api/command';
import {
  EVENT_LISTENER_ASYNC,
  IEventListenerAsync,
  listenAsync,
} from '../../api/events';
import { Database } from '../../core/database';
import {
  findFirstText,
  findFirstType,
  IProvider,
  Message,
  Target,
  text,
} from '../../providers';
import { PermissionLevel } from '../../../generated/prisma/enums';
import * as crypto from 'node:crypto';
import { Permission } from '../../core/permission';
import { Features } from '../../core/features';
import { Logger } from '../../core/logger';
import * as util from 'node:util';
// @ts-ignore
import { Client } from 'rpc-websockets';
import { once } from 'node:events';
import { Config } from '../../core/config';

const TEXT_KEY_TRANSFER = `
正在开始设置服务器管理协议密钥，请将密钥以下列 RSA 公钥以 RSA-OAEP 格式，摘要算法 SHA-256 加密后以 Base64 回复本条消息发送
%s
注意：服务端应当开启 TLS 并使用可信证书，否则 bot 将拒绝连接
注意：服务端应当将 %s 添加到 management-server-allowed-origins 中
提示：可使用下列网址对密钥加密：
https://gchq.github.io/CyberChef/#recipe=RSA_Encrypt('','RSA-OAEP','SHA-256')To_Base64('A-Za-z0-9%2B/%3D')
`.trim();

@injectable({ token: COMMAND_PROVIDER_TOKEN })
@injectable({ token: EVENT_LISTENER_ASYNC })
@listenAsync(['feature.disabled'])
@singleton()
export class MinecraftManageCommands
  implements ICommandProvider, IEventListenerAsync
{
  constructor(
    private readonly permission: Permission,
    private readonly features: Features,
    private readonly logger: Logger,
    private readonly db: Database,
    private readonly cfg: Config,
  ) {}

  @feature('mc.server_manage')
  @permission(PermissionLevel.ADMIN)
  @regex(/^~mcserver add ([^ ]+) (.+)$/)
  async doAddServer(
    provider: IProvider,
    target: Target,
    scope: Target,
    _: string,
    message: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    let url: URL;
    try {
      url = new URL(match[2].trim());
      if (url.protocol !== 'wss:')
        throw '服务端必须启用 TLS，且必须使用可信证书';
    } catch (e) {
      if (e instanceof TypeError)
        await provider.send(
          scope,
          text(`服务器 ${match[1]} 不是一个有效的服务端管理协议端点`),
        );
      else await provider.send(scope, text(`无法添加服务器\n${e}`));
      return COMMAND_CAUGHT;
    }
    const pScope = `${provider.id()}:${scope}`;
    const owner = findFirstType(message, 'at')?.target || target;
    const pOwner = `${provider.id()}:${owner}`;
    const serverInfo = await this.db.prisma.minecraftServer.upsert({
      where: { endpoint: match[2].trim() },
      create: { endpoint: match[2].trim(), owner: pOwner },
      update: { owner: pOwner },
      select: { id: true },
    });
    await this.db.prisma.minecraftServerScope.upsert({
      where: { scope_name: { scope: pScope, name: match[1] } },
      create: { scope: pScope, name: match[1], serverId: serverInfo.id },
      update: { serverId: serverInfo.id },
    });
    await provider.send(scope, text(`服务器 ${match[1]} 已添加`));
    this.logger.info(`server added ${match[1]}`);
    return COMMAND_CAUGHT;
  }

  @feature('mc.server_manage')
  @regex(/^~mcserver op (.+)$/)
  async doAddOperator(
    provider: IProvider,
    target: Target,
    scope: Target,
    _: string,
    message: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    const pScope = `${provider.id()}:${scope}`;
    const opMessage = findFirstType(message, 'at');
    if (!opMessage) return COMMAND_SKIPPED;
    const pOp = `${provider.id()}:${opMessage.target}`;
    const pOwner = `${provider.id()}:${target}`;
    const serverInfo = await this.db.prisma.minecraftServerScope.findUnique({
      where: { scope_name: { scope: pScope, name: match[1].trim() } },
      select: { id: true, server: { select: { owner: true, endpoint: true } } },
    });
    if (!serverInfo || serverInfo.server.owner !== pOwner)
      return COMMAND_SKIPPED;
    const success = await this.db.prisma.$transaction(async (tx) => {
      const prevOps = await tx.minecraftServer.findUnique({
        where: { id: serverInfo.id },
        select: { operators: true },
      });
      if (!prevOps) return false;
      const nowOps = new Set([...(prevOps.operators as string[]), pOp]);
      await tx.minecraftServer.update({
        where: { id: serverInfo.id },
        data: { operators: [...nowOps] },
      });
      return true;
    });
    if (success) {
      await provider.send(
        scope,
        text(`已添加对服务器 ${match[1].trim()} 的 OP`),
      );
      this.logger.info(`server ${serverInfo.server.endpoint} op added: ${pOp}`);
    } else
      await provider.send(scope, text(`未能添加 OP，可能是服务器条目被删除`));
    return COMMAND_CAUGHT;
  }

  @feature('mc.server_manage')
  @regex(/^~mcserver deop (.+)$/)
  async doRemoveOperator(
    provider: IProvider,
    target: Target,
    scope: Target,
    _: string,
    message: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    const pScope = `${provider.id()}:${scope}`;
    const pOwner = `${provider.id()}:${target}`;
    const serverInfo = await this.db.prisma.minecraftServerScope.findUnique({
      where: { scope_name: { scope: pScope, name: match[1].trim() } },
      select: {
        id: true,
        server: { select: { owner: true, operators: true, endpoint: true } },
      },
    });
    if (!serverInfo) return COMMAND_SKIPPED;

    const op = findFirstType(message, 'at')?.target || target;
    const pOp = `${provider.id()}:${op}`;

    if (
      serverInfo.server.owner !== pOwner &&
      (!(serverInfo.server.operators as string[]).includes(pOp) ||
        op !== target)
    )
      return COMMAND_SKIPPED;

    await this.db.prisma.$transaction(async (tx) => {
      const prevOps = await tx.minecraftServer.findUnique({
        where: { id: serverInfo.id },
        select: { operators: true },
      });
      if (!prevOps) return;
      const nowOps = new Set([...(prevOps.operators as string[])]);
      nowOps.delete(pOp);
      await tx.minecraftServer.update({
        where: { id: serverInfo.id },
        data: { operators: [...nowOps] },
      });
    });
    await provider.send(scope, text(`已移除对服务器 ${match[1].trim()} 的 OP`));
    this.logger.info(`server ${serverInfo.server.endpoint} op removed: ${pOp}`);
    return COMMAND_CAUGHT;
  }

  @feature('mc.server_manage')
  @regex(/^~mcserver cred (.+)$/)
  async doServerCredRequest(
    provider: IProvider,
    target: Target,
    scope: Target,
    _: string,
    __: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    const pScope = `${provider.id()}:${scope}`;
    const pOwner = `${provider.id()}:${target}`;
    const serverInfo = await this.db.prisma.minecraftServerScope.findUnique({
      where: { scope_name: { scope: pScope, name: match[1].trim() } },
      select: {
        id: true,
        server: {
          select: { id: true, owner: true, operators: true, endpoint: true },
        },
      },
    });
    if (!serverInfo || serverInfo.server.owner !== pOwner)
      return COMMAND_SKIPPED;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await provider.send(
      scope,
      text(
        util.format(
          TEXT_KEY_TRANSFER,
          publicKey,
          this.cfg.get('mc.manage.origin', 'https://mcsm-bot.loliworks.xyz'),
        ),
      ),
      {
        type: 'mc-server-manage-key',
        sid: serverInfo.server.id,
        pv: privateKey,
      },
      ['pv'],
    );
    this.logger.info(`credential request for ${serverInfo.server.endpoint}`);
    return COMMAND_CAUGHT;
  }

  @replied()
  async doServerCredResponse(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    message: Message,
    msgId?: string,
    metadata?: any,
  ) {
    if (!msgId || !metadata || metadata.type !== 'mc-server-manage-key')
      return COMMAND_SKIPPED;
    const dataStr = findFirstText(message);
    if (!dataStr) return COMMAND_SKIPPED;
    const data = Buffer.from(dataStr, 'base64');
    const decrypted = crypto
      .privateDecrypt(
        {
          key: metadata.pv,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        data,
      )
      .toString();
    const endpoint = await this.db.prisma.minecraftServer.update({
      where: { id: metadata.sid },
      data: { credential: decrypted },
      select: { endpoint: true },
    });
    this.logger.info(`credential set for ${endpoint}`);
    await provider.send(scope, text('已成功设置凭据'));
    return COMMAND_CAUGHT;
  }

  async onAsync(_: string, data: any) {
    if (data.feature && data.feature !== 'mc.server_manage') return;
    await this.db.prisma.minecraftServerScope.deleteMany({
      where: { scope: data.group },
    });
  }

  private async _initRPC(
    provider: IProvider,
    target: Target,
    scope: Target,
    name: string,
  ) {
    const pScope = `${provider.id()}:${scope}`;
    const pOp = `${provider.id()}:${target}`;

    const serverInfo = await this.db.prisma.minecraftServerScope.findUnique({
      where: { scope_name: { scope: pScope, name } },
      select: {
        id: true,
        server: {
          select: {
            owner: true,
            operators: true,
            endpoint: true,
            credential: true,
          },
        },
      },
    });
    if (!serverInfo) return COMMAND_SKIPPED;

    const ops = [
      serverInfo.server.owner,
      ...(serverInfo.server.operators as string[]),
    ];
    if (!ops.includes(pOp)) return COMMAND_SKIPPED;

    if (!serverInfo.server.credential) {
      await provider.send(scope, text('未设定服务端管理协议凭据'));
      return COMMAND_CAUGHT;
    }

    const { endpoint, credential } = serverInfo.server;
    let wsRpc;
    try {
      wsRpc = new Client(endpoint, {
        protocols: ['minecraft-v1', credential],
        reconnect: false,
        origin: this.cfg.get(
          'mc.manage.origin',
          'https://mcsm-bot.loliworks.xyz',
        ),
      });
      await once(wsRpc, 'open');
    } catch (e) {
      this.logger.error(
        (e as ErrorEvent).error,
        `cannot send whitelist request to ${endpoint}`,
      );
      await provider.send(
        scope,
        text(
          '无法正确连接服务器，检查服务器是否启动并启用正确的 TLS 且正确设置允许连入来源',
        ),
      );
      return COMMAND_CAUGHT;
    }

    return wsRpc;
  }

  @feature('mc.server_manage')
  @regex(/^~mcserver whitelist add ([^ ]+) (.+)$/)
  async doAddWhitelist(
    provider: IProvider,
    target: Target,
    scope: Target,
    _: string,
    __: Message,
    match?: RegExpMatchArray,
  ): Promise<typeof COMMAND_CAUGHT | typeof COMMAND_SKIPPED> {
    if (!match) return COMMAND_SKIPPED;
    const wsRpc = await this._initRPC(provider, target, scope, match[1]);
    if (typeof wsRpc === 'symbol') return wsRpc as any;

    const name = match[2].trim();
    let resp: { name: string }[];
    try {
      resp = await wsRpc.call('allowlist/add', [[{ name }]]);
      wsRpc.close();
    } catch (e) {
      this.logger.error(e, `whitelist request failed`);
      await provider.send(scope, text('无法设置白名单'));
      return COMMAND_CAUGHT;
    }

    if (resp.map((r) => r.name).includes(name))
      await provider.send(scope, text('白名单添加成功'));
    else await provider.send(scope, text('白名单添加失败，可能是名称错误'));
    return COMMAND_CAUGHT;
  }

  @feature('mc.server_manage')
  @regex(/^~mcserver whitelist remove ([^ ]+) (.+)$/)
  async doRemoveWhitelist(
    provider: IProvider,
    target: Target,
    scope: Target,
    _: string,
    __: Message,
    match?: RegExpMatchArray,
  ): Promise<typeof COMMAND_CAUGHT | typeof COMMAND_SKIPPED> {
    if (!match) return COMMAND_SKIPPED;
    const wsRpc = await this._initRPC(provider, target, scope, match[1]);
    if (typeof wsRpc === 'symbol') return wsRpc as any;

    const name = match[2].trim();
    try {
      await wsRpc.call('allowlist/remove', [[{ name }]]);
      wsRpc.close();
    } catch (e) {
      this.logger.error(e, `whitelist request failed`);
      await provider.send(scope, text('无法设置白名单'));
      return COMMAND_CAUGHT;
    }

    await provider.send(scope, text('白名单已移除'));
    return COMMAND_CAUGHT;
  }

  commands() {
    return [
      this.doAddServer,
      this.doAddOperator,
      this.doRemoveOperator,
      this.doServerCredRequest,
      this.doServerCredResponse,
      this.doAddWhitelist,
      this.doRemoveWhitelist,
    ];
  }
}

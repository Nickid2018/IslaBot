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
import {
  image,
  IProvider,
  Message,
  MessageChain,
  Target,
  text,
} from '../../providers';
import { Permission } from '../../core/permission';
import { Features } from '../../core/features';
import { Logger } from '../../core/logger';
import { PermissionLevel } from '../../../generated/prisma/enums';
import * as udp from 'dgram';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import { Buffer } from 'node:buffer';
import { createSocket, writeVarInt } from '../../util/connection';
import { once } from 'node:events';
import { RemoteInfo } from 'node:dgram';

@injectable({ token: COMMAND_PROVIDER_TOKEN })
export class MinecraftQueryCommands implements ICommandProvider {
  constructor(
    private readonly permission: Permission,
    private readonly features: Features,
    private readonly logger: Logger,
  ) {}

  @feature('mc', true)
  @permission(PermissionLevel.NORMAL)
  @regex(/^~server (.+)$/)
  async doServerQuery(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    const splitIndex = match[1].lastIndexOf(':');
    const boundary = match[1].lastIndexOf(']');
    if (boundary >= 0 && splitIndex > boundary && splitIndex !== boundary + 1) {
      await provider.send(scope, text('无效的地址'));
      return COMMAND_CAUGHT;
    }
    const shouldSplit =
      (boundary === -1 || boundary < splitIndex) && splitIndex >= 0;
    let host = shouldSplit ? match[1].substring(0, splitIndex) : match[1];
    if (boundary >= 0) host = host.substring(1, boundary);
    const portStr = shouldSplit ? match[1].substring(splitIndex + 1) : '';
    const port = portStr ? parseInt(portStr, 10) : -1;
    if (isNaN(port)) {
      await provider.send(scope, text('无效的地址'));
      return COMMAND_CAUGHT;
    }
    const ipv4 = net.isIPv4(host);
    const ipv6 = boundary >= 0 && net.isIPv6(host);
    const result = await this.returnFirstNotNull([
      this.doQueryJE(match[1], host, port, ipv4, ipv6),
      this.doQueryRaknet(match[1], host, port, ipv4, ipv6),
    ]);
    if (result) {
      let message = `${result.type}服务器 ${match[1]}\n延迟：${result.ping}ms`;
      if (result.version)
        message += `\n版本：${result.version.protocol || '未知协议版本'}（${result.version.name || '未知版本'}）`;
      if (result.players) {
        message += `\n玩家数：${result.players.online || 0}/${result.players.max || 0}`;
        if (
          Array.isArray(result.players.sample) &&
          result.players.sample.length > 0
        )
          message += `\n在线列表：${result.players.sample.join('，')}`;
      }
      if (result.motd) {
        if (typeof result.motd === 'string')
          message += `\n${result.motd.replace(/§./g, '')}`;
        else message += `\n${this.expandTextComponent(result.motd)}`;
      }
      const messages: MessageChain = [text(message)];
      if (result.favicon)
        messages.push(image(Buffer.from(result.favicon, 'base64')));
      await provider.send(scope, messages);
    } else {
      await provider.send(scope, text('未能查询到此地址的服务器'));
    }
    return COMMAND_CAUGHT;
  }

  expandTextComponent(component: any) {
    return typeof component === 'string'
      ? component
      : (component.text || '') +
          (component.extra?.map(this.expandTextComponent)?.join('') || '');
  }

  async returnFirstNotNull<T extends readonly unknown[] | []>(
    promises: T,
  ): Promise<Awaited<T[number]> | null> {
    const awaitPool = promises.map(async (p, i) => [i, await p] as const);
    const deleteBitmap = Array.from(awaitPool).map((_, i) => i + 1);
    while (awaitPool.length > 0) {
      const val = await Promise.any(awaitPool);
      if (val[1]) return val[1] as Promise<Awaited<T[number]>>;
      const deleteIndex = deleteBitmap.filter(Boolean).indexOf(val[0] + 1);
      awaitPool.splice(deleteIndex, 1);
      deleteBitmap[val[0]] = 0;
    }
    return null;
  }

  async doQueryJE(
    saddr: string,
    host: string,
    port: number,
    ipv4: boolean,
    ipv6: boolean,
  ) {
    const availableAddr = [{ host, port: port < 0 ? 25565 : port }];
    if (port === -1 && !ipv4 && !ipv6) {
      try {
        const srvRecords = await dns.resolveSrv(`_minecraft._tcp.${host}`);
        availableAddr.splice(
          0,
          0,
          ...srvRecords.map((r) => ({ host: r.name, port: r.port })),
        );
      } catch (e: any) {
        if (e.code !== 'ENODATA')
          this.logger.error({ error: e, host, port }, 'cannot query srv');
      }
    }

    const buffer = [0]; // handshake, protocol version
    writeVarInt(buffer, 777);
    const hostBuffer = Buffer.from(host, 'utf-8');
    writeVarInt(buffer, hostBuffer.byteLength);
    buffer.push(...hostBuffer); // host
    if (port !== -1) {
      buffer.push(port >> 8);
      buffer.push(port & 0xff);
    } else {
      buffer.push(25565 >> 8);
      buffer.push(25565 & 0xff);
    }
    buffer.push(1); // slp
    writeVarInt(buffer, buffer.length, 0); // length
    const queryBuffer = Buffer.from(buffer);
    for (const addr of availableAddr) {
      try {
        const conn = await createSocket({ ...addr });
        conn.cork();
        conn.write(queryBuffer);
        conn.uncork();
        conn.cork();
        conn.write(Buffer.from([1, 0]));
        conn.uncork();
        const len = await conn.readVarInt();
        if (!len) throw 'invalid packet len';
        const id = await conn.readVarInt();
        if (id !== 0) throw 'invalid packet number';
        const strlen = await conn.readVarInt();
        if (!strlen) throw 'invalid packet strlen';
        const strBytes = await conn.read(strlen);
        const payload = strBytes.toString('utf-8');
        conn.cork();
        conn.write(Buffer.from([9, 1]));
        conn.writeBigUInt64BE(BigInt(Date.now()));
        conn.uncork();
        const len2 = await conn.readVarInt();
        if (len2 !== 9) throw 'invalid packet len';
        const id2 = await conn.readVarInt();
        if (id2 !== 1) throw 'invalid packet number';
        const sentTime = await conn.readBigUint64BE();
        conn.end();
        const json = JSON.parse(payload);
        return {
          type: 'Java 版',
          players: json?.players,
          favicon: json?.favicon,
          version: json?.version,
          motd: json?.description,
          ping: BigInt(Date.now()) - sentTime,
        };
      } catch (e) {
        this.logger.error({ error: e, addr, saddr }, 'cannot query server');
      }
    }
  }

  async doQueryRaknet(
    saddr: string,
    host: string,
    port: number,
    ipv4: boolean,
    ipv6: boolean,
  ) {
    if (!ipv4 && !ipv6) {
      try {
        const ip = await dns.lookup(host);
        host = ip.address;
        ipv4 = ip.family === 4;
      } catch (e) {
        this.logger.error({ error: e, saddr }, 'cannot lookup dns');
        return;
      }
    }
    const payload = Buffer.alloc(1 + 8 * 4);
    payload.writeUint8(1);
    payload.writeBigUInt64BE(BigInt(Date.now()), 1);
    payload.writeBigUInt64BE(0x00ffff00fefefefen, 1 + 8);
    payload.writeBigUInt64BE(0xfdfdfdfd12345678n, 1 + 8 * 2);
    payload.writeBigUInt64BE(0n, 1 + 8 * 3);
    port = port === -1 ? (ipv4 ? 19132 : 19133) : port;
    try {
      const socket = udp.createSocket(ipv4 ? 'udp4' : 'udp6');
      const timeout = new Promise((r) => setTimeout(r, 30000));
      await new Promise<void>((r, j) =>
        socket.send(payload, port, host, (e) => {
          if (e) j(e);
          else r();
        }),
      );
      while (true) {
        const evt = await Promise.any([once(socket, 'message'), timeout]);
        if (!evt) throw 'server query timeout';
        const [chunk, rinfo] = evt as [Buffer, RemoteInfo];
        if (rinfo.address !== host || rinfo.port !== port) continue;

        if (chunk.readUint8() !== 0x1c) throw 'invalid packet id';
        const sentTime = chunk.readBigUint64BE(1);
        if (
          chunk.readBigUint64BE(1 + 8 * 2) !== 0x00ffff00fefefefen ||
          chunk.readBigUint64BE(1 + 8 * 3) !== 0xfdfdfdfd12345678n
        )
          throw 'invalid packet magic';
        const payload = chunk.subarray(1 + 8 * 4).toString('utf-8');
        const splits = payload.split(';');
        return {
          type: '基岩版',
          players: {
            online: splits[4],
            max: splits[5],
          },
          version: {
            name: splits[3],
            protocol: splits[2],
          },
          motd: `${splits[1]}\n${splits[7]}`.trim(),
          ping: BigInt(Date.now()) - sentTime,
          favicon: null,
        };
      }
    } catch (e) {
      this.logger.error({ error: e, host, port, saddr }, 'cannot query server');
    }
  }

  commands() {
    return [this.doServerQuery];
  }
}

import {
  AtMessage,
  ForwardPackedMessage,
  getId,
  ImageMessage,
  IProvider,
  isUser,
  Message,
  NormalMessage,
  PROVIDER_TOKEN,
  ReplyMessage,
  Target,
  TextMessage,
} from '..';
import { Config } from '../../core/config';
import { inject, injectable, singleton } from 'tsyringe';
import { NCWebsocket, SendMessageSegment, Structs } from 'node-napcat-ts';
import { Logger } from '../../core/logger';
import { Fetcher } from '../../core/fetcher';
import { CACHE_TOKEN, ICache } from '../../core/cache';

@injectable({ token: PROVIDER_TOKEN })
@singleton()
export class ProviderOnebot implements IProvider {
  private ws: NCWebsocket | undefined;
  private connected: Promise<void> | undefined;

  private lastSendTimer: Promise<number> = Promise.resolve(0);
  private sendSeq: number = 0;
  private lastSendSeq: number = 0;

  constructor(
    private readonly cfg: Config,
    private readonly logger: Logger,
    private readonly fetcher: Fetcher,
    @inject(CACHE_TOKEN) private readonly cache: ICache,
  ) {}

  init(): void {
    const url = this.cfg.get('onebot.url');
    if (url) {
      this.ws = new NCWebsocket({
        baseUrl: url,
        accessToken: this.cfg.get('onebot.secret') || undefined,
        reconnection: { enable: true },
      });
      this.ws.on('socket.open', (err) => {
        this.logger.info(`onebot socket opened`);
      });
      this.ws.on('socket.error', (err) =>
        this.logger.error(
          `onebot socket error: type=${err.error_type}, info=${err}`,
        ),
      );
      this.ws.on('socket.close', (res) =>
        this.logger.warn(
          `onebot socket closed: code=${res.code}, reason=${res.reason}`,
        ),
      );
      this.connected = this.ws.connect();
    }
  }

  ready(): Promise<void> {
    return (
      this.connected ?? Promise.reject<void>('onebot client not connected')
    );
  }

  private async construct(message: Message) {
    const structs: SendMessageSegment[] = [];
    const _construct = async (message: Message) => {
      if (Array.isArray(message))
        return void (await Promise.all(message.map(_construct)));
      switch (message.type) {
        case 'at':
          structs.push(Structs.at(message.target));
          break;
        case 'image':
          if (
            this.cfg.get('onebot.send.image_process') &&
            typeof message.content === 'string'
          ) {
            const blob = await this.fetcher.fetchBlob(message.content);
            if (blob) structs.push(Structs.image(blob, message.name));
          } else {
            structs.push(Structs.image(message.content, message.name));
          }
          break;
        case 'text':
          structs.push(Structs.text(message.content));
          break;
        case 'reply':
          structs.push(Structs.reply(message.target));
          break;
      }
    };
    await _construct(message);
    return structs;
  }

  private async sendWait() {
    await this.ready();

    if (this.sendSeq - this.lastSendSeq >= 10) {
      this.logger.warn(`Send queue limit exceeded, message will be discard`);
      return false;
    }

    const nowSeq = this.sendSeq++;
    while ((await this.lastSendTimer) !== nowSeq);
    this.lastSendTimer = new Promise((r) =>
      setTimeout(
        () => r(nowSeq + 1),
        this.cfg.getInt('onebot.limit.gap', 10000) +
          (2 * Math.random() - 1) *
            this.cfg.getInt('onebot.limit.jitter', 2500),
      ),
    );
    this.lastSendSeq = nowSeq;
    return true;
  }

  filterBuffers(message: Message) {
    if (Array.isArray(message)) return message.forEach(this.filterBuffers);
    if (message.type === 'image' && typeof message.content !== 'string')
      message.content = '[Binary Data]';
  }

  async send(target: Target, message: Message, savedMetadata: any = {}) {
    const _countTexts = (message: Message): number => {
      if (Array.isArray(message))
        return message.map(_countTexts).reduce((a, b) => a + b, 0);
      return message.type === 'text' ? message.content.length : 0;
    };
    if (_countTexts(message) > this.cfg.getInt('onebot.send.max_len', 300))
      return await this.sendForward(target, [message]);

    if (!(await this.sendWait())) return;
    const structs = await this.construct(message);
    const sendPayload = isUser(target)
      ? { user_id: Number(getId(target)), message: structs }
      : { group_id: Number(getId(target)), message: structs };
    const msgId = (
      await this.ws?.send_msg(sendPayload)
    )?.message_id?.toString();
    if (msgId) {
      this.filterBuffers(message);
      this.logger.info(
        { message_id: msgId, ...message, ...savedMetadata },
        'sent single message',
      );
      await this.cache.set(`provider.onebot.sent.${msgId}`, savedMetadata, 300);
    }
    return msgId;
  }

  async sendForward(
    target: Target,
    message: ForwardPackedMessage,
    savedMetadata: any = {},
  ) {
    if (!(await this.sendWait())) return;
    const nodes = await Promise.all(
      message
        .map(this.construct)
        .map(async (segment) =>
          Structs.customNode(
            await segment,
            this.cfg.getInt('onebot.self.id', 1145141919),
            this.cfg.get('onebot.self.nickname', 'Forward Message')!,
          ),
        ),
    );
    const sendPayload = isUser(target)
      ? { user_id: Number(getId(target)), message: nodes }
      : { group_id: Number(getId(target)), message: nodes };
    const msgId = (
      await this.ws?.send_forward_msg(sendPayload)
    )?.message_id?.toString();
    if (msgId) {
      message.forEach(this.filterBuffers);
      this.logger.info(
        { message_id: msgId, content: message, ...savedMetadata },
        'sent forward message',
      );
      await this.cache.set(`provider.onebot.sent.${msgId}`, savedMetadata, 300);
    }
    return msgId;
  }

  listen(
    callback: (
      target: Target,
      scope: Target,
      msgId: string,
      message: Message,
    ) => void,
  ): void {
    this.ws?.subscribe('message', (event) => {
      const target: Target = `user:${event.user_id}`;
      const scope: Target =
        event.message_type === 'group'
          ? `group:${event.group_id}`
          : `user:${event.user_id}`;
      const messages: NormalMessage[] = event.message
        .map((m) => {
          switch (m.type) {
            case 'reply':
              return {
                type: 'reply',
                target: m.data.id,
              } satisfies ReplyMessage;
            case 'text':
              return {
                type: 'text',
                content: m.data.text,
              } satisfies TextMessage;
            case 'image':
              return {
                type: 'image',
                content: m.data.url,
                name: m.data.summary,
              } satisfies ImageMessage;
            case 'at':
              return {
                type: 'at',
                target: `user:${m.data.qq}`,
              } satisfies AtMessage;
          }
          return null;
        })
        .filter((m) => !!m);
      if (messages.length === 0) return;
      this.logger.debug(`received onebot message event ${event}`);
      this.logger.debug(`parsed content = ${messages}`);
      callback(
        target,
        scope,
        event.message_id.toString(),
        messages.length > 1 ? messages : messages[0],
      );
    });
  }

  async getSentMessages() {
    return (await this.cache.listPrefix('provider.onebot.sent.')).map((k) =>
      k.substring(21),
    );
  }

  async getSentMessageMetadata(msgId: string) {
    return await this.cache.get(`provider.onebot.sent.${msgId}`);
  }

  async recallMessage(msgId: string) {
    await this.ready();
    this.logger.info({ message_id: msgId }, `recalling message`);
    await this.ws?.delete_msg({ message_id: Number(msgId) });
  }

  getCapability(capability: string): boolean {
    return false;
  }

  id(): string {
    return 'onebot';
  }
}

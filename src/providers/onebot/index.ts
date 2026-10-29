import {
  AtMessage,
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
import { injectable, singleton } from 'tsyringe';
import { NCWebsocket, SendMessageSegment, Structs } from 'node-napcat-ts';

@injectable({ token: PROVIDER_TOKEN })
@singleton()
export class ProviderOnebot implements IProvider {
  private ws: NCWebsocket | undefined;
  private connected: Promise<void> | undefined;

  private lastSendTimer: Promise<number> = Promise.resolve(0);
  private sendSeq: number = 0;
  private lastSendSeq: number = 0;

  constructor(private readonly cfg: Config) {
  }

  init(): void {
    const url = this.cfg.get('onebot.url');
    if (url) {
      this.ws = new NCWebsocket({
        baseUrl: url,
        accessToken: this.cfg.get('onebot.secret') || undefined,
        reconnection: { enable: true },
      });
      this.connected = this.ws.connect();
    }
  }

  ready(): Promise<void> {
    return this.connected ?? Promise.reject<void>();
  }

  async send(target: Target, message: Message): Promise<string | null> {
    await this.ready();

    if (this.sendSeq - this.lastSendSeq >= 10) {
      console.warn(
        `Send queue limit exceeded, message will be discard, content = ${message}`,
      );
      return null;
    }

    const nowSeq = this.sendSeq++;
    while ((await this.lastSendTimer) === nowSeq);
    this.lastSendTimer = new Promise((r) =>
      setTimeout(
        () => r(nowSeq + 1),
        this.cfg.getInt('onebot.limit.gap', 10000) +
          (2 * Math.random() - 1) *
            this.cfg.getInt('onebot.limit.jitter', 2500),
      ),
    );
    this.lastSendSeq = nowSeq;

    const structs: SendMessageSegment[] = [];
    const _construct = (message: Message) => {
      if (Array.isArray(message)) return message.forEach(_construct);
      switch (message.type) {
        case 'at':
          structs.push(Structs.at(message.target));
          break;
        case 'image':
          structs.push(Structs.image(message.content, message.name));
          break;
        case 'text':
          structs.push(Structs.text(message.content));
          break;
        case 'reply':
          structs.push(Structs.reply(message.target));
          break;
      }
    };
    _construct(message);

    if (isUser(target)) {
      return (
        (
          await this.ws?.send_private_msg({
            user_id: Number(getId(target)),
            message: structs,
          })
        )?.message_id?.toString() || ''
      );
    } else {
      return (
        (
          await this.ws?.send_group_msg({
            group_id: Number(getId(target)),
            message: structs,
          })
        )?.message_id?.toString() || ''
      );
    }
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
              return { type: 'at', target: m.data.qq } satisfies AtMessage;
          }
          return null;
        })
        .filter((m) => !!m);
      if (messages.length === 0) return;
      callback(
        target,
        scope,
        event.message_id.toString(),
        messages.length > 1 ? messages : messages[0],
      );
    });
  }

  getCapability(capability: string): boolean {
    return false;
  }

  id(): string {
    return 'onebot';
  }
}

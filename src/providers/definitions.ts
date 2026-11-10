export const PROVIDER_TOKEN = Symbol('PROVIDER_TOKEN');

export type NormalMessage =
  TextMessage | ImageMessage | AtMessage | ReplyMessage;
export type TextMessage = { type: 'text'; content: string };
export type ImageMessage = {
  type: 'image';
  content: string | Buffer;
  name?: string;
};
export type AtMessage = { type: 'at'; target: string };
export type ReplyMessage = { type: 'reply'; target: string };

export type MessageChain = NormalMessage[];
export type Message = NormalMessage | MessageChain;

export type ForwardPackedMessage = Message[];

export function text(text: string): TextMessage {
  return { type: 'text', content: text };
}

export function image(content: string | Buffer, name?: string): ImageMessage {
  return { type: 'image', content, name: name };
}

export function findFirstText(message: Message) {
  return findFirstType(message, 'text')?.content || '';
}

export function findFirstType<T extends NormalMessage['type']>(
  message: Message,
  type: T,
): (NormalMessage & { type: T }) | undefined {
  if (!Array.isArray(message)) {
    if (message.type !== type) return undefined;
    else return message as any;
  }
  return message.find((m) => m.type === type) as any;
}

export type Target = `${'user' | 'group'}:${string}`;

export function isUser(target: Target) {
  return target.startsWith('user');
}

export function isGroup(target: Target) {
  return target.startsWith('group');
}

export function getId(target: Target) {
  return target.substring(target.indexOf(':') + 1);
}

export interface IProvider {
  id(): string;
  init(): void;
  ready(): Promise<void>;

  send(
    target: Target,
    message: Message,
    savedMetadata?: any,
    reductKeys?: string[],
  ): Promise<string | undefined>;
  sendForward(
    target: Target,
    message: ForwardPackedMessage,
    savedMetadata?: any,
    reductKeys?: string[],
  ): Promise<string | undefined>;
  listen(
    callback: (
      target: Target,
      scope: Target,
      msgId: string,
      message: Message,
    ) => void,
  ): void;

  getSentMessages(): Promise<string[]>;
  getSentMessageMetadata(msgId: string): Promise<any>;
  recallMessage(msgId: string): Promise<void>;

  getCapability(capability: string): boolean;
}

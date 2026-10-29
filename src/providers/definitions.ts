export const PROVIDER_TOKEN = Symbol('PROVIDER_TOKEN');

export type NormalMessage =
  TextMessage | ImageMessage | AtMessage | ReplyMessage;
export type TextMessage = { type: 'text'; content: string };
export type ImageMessage = {
  type: 'image';
  content: string | Buffer;
  name: string;
};
export type AtMessage = { type: 'at'; target: string };
export type ReplyMessage = { type: 'reply'; target: string };

export type MessageChain = NormalMessage[];
export type Message = NormalMessage | MessageChain;

export function text(text: string): TextMessage {
  return { type: 'text', content: text };
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
  send(target: Target, message: Message): Promise<string | null>;
  listen(
    callback: (
      target: Target,
      scope: Target,
      msgId: string,
      message: Message,
    ) => void,
  ): void;
  getCapability(capability: string): boolean;
}

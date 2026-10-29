export const PROVIDER_TOKEN = Symbol('PROVIDER_TOKEN');

export type MessageChain = {

}

export interface IProvider {
  init(): void;
  ready(): Promise<void>;
  send(target: string, message: MessageChain): Promise<void>;
}
import {
  Config,
  CONFIG_TOKEN,
  IProvider,
  MessageChain,
  PROVIDER_TOKEN,
} from '@isla-bot/core';
import { inject, injectable, singleton } from 'tsyringe';
import { NCWebsocket } from 'node-napcat-ts';

@injectable({ token: PROVIDER_TOKEN })
@singleton()
export class ProviderOnebot implements IProvider {
  private readonly url: string | null;
  private readonly secret: string | null;
  private ws: NCWebsocket | undefined;
  private connected: Promise<void> | undefined;

  constructor(@inject(CONFIG_TOKEN) readonly cfg: Config) {
    this.url = this.cfg.get('onebot.url');
    this.secret = this.cfg.get('onebot.secret');
  }

  init(): void {
    if (this.url) {
      this.ws = new NCWebsocket({
        baseUrl: this.url,
        accessToken: this.secret || undefined,
        reconnection: { enable: true },
      });
      this.connected = this.ws.connect();
    }
  }

  ready(): Promise<void> {
    return this.connected ?? Promise.reject<void>();
  }

  send(target: string, message: MessageChain): Promise<void> {
    throw new Error('Method not implemented.');
  }
}

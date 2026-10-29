import { injectable, singleton } from 'tsyringe';
import { IProvider, Message, PROVIDER_TOKEN, Target } from '../definitions';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { STOP_CONTROLLER } from '../../main';

@injectable({ token: PROVIDER_TOKEN })
@singleton()
export class ProviderConsole implements IProvider {
  private callback?: (msgId: string, message: string) => void;
  private lastMsgId = 0;

  constructor() {
    const rl = readline.createInterface({ input, output, terminal: false });
    (async () => {
      while (!STOP_CONTROLLER.signal.aborted) {
        const line = await rl.question('');
        this.callback?.(`${this.lastMsgId++}`, line);
      }
    })();
  }

  init(): void {}

  listen(
    callback: (
      target: Target,
      scope: Target,
      msgId: string,
      message: Message,
    ) => void,
  ): void {
    this.callback = (msgId: string, message: string) => {
      callback('user:0', 'user:0', msgId, { type: 'text', content: message });
    };
  }

  ready(): Promise<void> {
    return Promise.resolve();
  }

  async send(_: Target, message: Message): Promise<string | null> {
    console.log(message);
    return null;
  }

  getCapability(capability: string): boolean {
    return false;
  }

  id(): string {
    return 'console';
  }
}

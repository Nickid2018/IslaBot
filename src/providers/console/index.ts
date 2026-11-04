import { injectable, singleton } from 'tsyringe';
import {
  ForwardPackedMessage,
  IProvider,
  Message,
  PROVIDER_TOKEN,
  Target,
} from '../definitions';
import {
  BoxRenderable,
  CliRenderer,
  createCliRenderer,
  EmbeddedTerminalRenderable,
  InputRenderable,
  InputRenderableEvents,
  KeyEvent,
  TextRenderable,
} from '@opentui/core';
import { Logger } from '../../core/logger';
import * as readline from 'node:readline/promises';
import { STOP_CONTROLLER } from '../../main';
import { Writable } from 'node:stream';

@injectable({ token: PROVIDER_TOKEN })
@singleton()
export class ProviderConsole implements IProvider {
  private callback?: (msgId: string, message: string) => void;
  private lastMsgId = 0;
  private readonly commandHistory: string[] = [];
  private prepareBuffer: string = '';
  private commandCursor: number = 0;

  constructor(private readonly logger: Logger) {}

  init(): void {
    (async () => {
      const renderer = await createCliRenderer({
        exitOnCtrlC: false,
        targetFps: 30,
      });
      this.initTUI(renderer);
    })().catch((e) => {
      this.logger.error(e, 'cannot initialize TUI');
      this.initInput();
    });
  }

  initTUI(renderer: CliRenderer) {
    const rootColumn = new BoxRenderable(renderer, {
      height: '100%',
      width: '100%',
      flexDirection: 'column',
      gap: 1,
    });

    const terminal = new EmbeddedTerminalRenderable(renderer, {
      id: 'log',
      width: '100%',
      flexGrow: 1,
      flexBasis: 0,
      maxScrollback: 655360,
      transparentBackground: true,
    });
    this.logger.setReadPipe(
      new Writable({
        write: (chunk, _, callback) => {
          if (!STOP_CONTROLLER.signal.aborted) terminal.write(chunk);
          callback();
        },
      }),
    );
    terminal.focusable = false;
    rootColumn.add(terminal);

    const inputRow = new BoxRenderable(renderer, {
      height: 1,
      width: '100%',
      flexDirection: 'row',
      gap: 1,
      bottom: 0,
    });
    inputRow.add(new TextRenderable(renderer, { content: '>' }));
    const input = new InputRenderable(renderer, {
      flexGrow: 1,
      flexBasis: 0,
      id: 'command-input',
      placeholder: 'Command Here...',
    });
    input.on(InputRenderableEvents.ENTER, (val: string) => {
      if (!val) return;
      input.value = '';
      this.logger.info({ content: val }, `console input`);
      this.callback?.(`${this.lastMsgId++}`, val);
      this.commandHistory.push(val);
      if (this.commandHistory.length > 100) this.commandHistory.shift();
      this.commandCursor = this.commandHistory.length;
      this.prepareBuffer = '';
    });
    inputRow.add(input);
    rootColumn.add(inputRow);

    const onKeyPress = (key: KeyEvent) => {
      if (key.ctrl && key.name === 'c') STOP_CONTROLLER.abort();
      if (key.name === 'up') {
        if (this.commandCursor === this.commandHistory.length)
          this.prepareBuffer = input.value;
        this.commandCursor = Math.max(0, this.commandCursor - 1);
        input.value = this.commandHistory[this.commandCursor];
      }
      if (key.name === 'down') {
        this.commandCursor = Math.min(
          this.commandHistory.length,
          this.commandCursor + 1,
        );
        if (this.commandCursor === this.commandHistory.length)
          input.value = this.prepareBuffer;
        else input.value = this.commandHistory[this.commandCursor];
      }
    };
    renderer.keyInput.on('keypress', onKeyPress);

    STOP_CONTROLLER.signal.addEventListener('abort', () => {
      rootColumn.remove(terminal); // avoid exceptions
      terminal.destroy();
    });
    renderer.root.add(rootColumn);
    input.focus();
    renderer.start();
  }

  initInput() {
    this.logger.setReadPipe(process.stdout);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    (async () => {
      while (!STOP_CONTROLLER.signal.aborted) {
        const line = await rl.question('');
        if (!line) continue;
        this.logger.info({ content: line }, `console input`);
        this.callback?.(`${this.lastMsgId++}`, line);
      }
    })();
  }

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

  filterBuffers(message: Message) {
    if (Array.isArray(message)) return message.forEach(this.filterBuffers);
    if (message.type === 'image' && typeof message.content !== 'string')
      message.content = '[Binary Data]';
  }

  async send(_: Target, message: Message) {
    this.filterBuffers(message);
    this.logger.info(message, 'console response');
    return undefined;
  }

  async sendForward(_: Target, message: ForwardPackedMessage) {
    message.forEach(this.filterBuffers);
    this.logger.info(message, 'console response');
    return undefined;
  }

  async getSentMessages() {
    return [];
  }

  async getSentMessageMetadata(_: string) {
    return {};
  }

  async recallMessage(_: string) {}

  getCapability(capability: string): boolean {
    return false;
  }

  id(): string {
    return 'console';
  }
}

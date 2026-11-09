import { Disposable, injectable, singleton } from 'tsyringe';
import pino, { LogFn } from 'pino';
// @ts-ignore
import { pipeSync } from 'node-pipe';
import * as fs from 'node:fs';
import { Writable } from 'node:stream';

@injectable()
@singleton()
export class Logger implements Disposable {
  private readonly logger: pino.Logger;
  private readonly readStream: fs.ReadStream;

  constructor() {
    const { readfd: readFd, writefd: writeFd } = pipeSync();
    this.readStream = fs.createReadStream('', { fd: readFd });
    const noopWriteStream = new Writable({
      write: (_, __, callback) => callback(),
    });
    this.readStream.pipe(noopWriteStream);

    this.logger = pino({
      transport: {
        targets: [
          {
            target: 'pino-roll',
            options: {
              file: './logs/app.log',
              frequency: 'daily',
              size: '10m',
              mkdir: true,
              level: process.env.LOG_LEVEL || 'info',
            },
          },
          {
            target: 'pino-pretty',
            options: {
              crlf: true,
              colorize: true,
              destination: writeFd,
              level: process.env.LOG_LEVEL || 'info',
            },
          },
        ],
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
    this.fatal = this.logger.fatal.bind(this.logger);
    this.warn = this.logger.warn.bind(this.logger);
    this.info = this.logger.info.bind(this.logger);
    this.error = this.logger.error.bind(this.logger);
    this.debug = this.logger.debug.bind(this.logger);
    this.trace = this.logger.trace.bind(this.logger);
  }

  setReadPipe(w: Writable) {
    this.readStream.pipe(w);
  }

  fatal: LogFn;
  warn: LogFn;
  info: LogFn;
  error: LogFn;
  debug: LogFn;
  trace: LogFn;

  async dispose() {
    await new Promise((r) => this.logger.flush(r));
  }
}

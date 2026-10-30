import { injectable, singleton } from 'tsyringe';
import pino from 'pino';

@injectable()
@singleton()
export class Logger {
  private readonly logger: pino.Logger = pino({
    transport: {
      target: 'pino-roll',
      options: {
        file: './logs/app.log',
        frequency: 'daily',
        size: '10m',
        mkdir: true,
      },
    },
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  fatal = this.logger.fatal.bind(this.logger);
  warn = this.logger.warn.bind(this.logger);
  info = this.logger.info.bind(this.logger);
  error = this.logger.error.bind(this.logger);
  debug = this.logger.debug.bind(this.logger);
  trace = this.logger.trace.bind(this.logger);
}

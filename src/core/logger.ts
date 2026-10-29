import { injectable, singleton } from 'tsyringe';
import pino from 'pino';

@injectable()
@singleton()
export class Logger {
  private logger: pino.Logger;

  constructor() {
    this.logger = pino({
      transport: {
        target: 'pino-roll',
        options: {
          file: './logs/app.log',
          frequency: 'daily',
          size: '10m',
          mkdir: true,
        },
      },
    });
  }
}
import { injectable, injectAll } from 'tsyringe';
import {
  EVENT_LISTENER,
  EVENT_LISTENER_ASYNC,
  IEventListener,
  IEventListenerAsync,
  listenEvents,
  listenEventsAsync,
} from '../api/events';
import { Logger } from './logger';

@injectable()
export class EventBus {
  constructor(
    @injectAll(EVENT_LISTENER, { isOptional: true })
    private readonly listenersSync: IEventListener[],
    @injectAll(EVENT_LISTENER_ASYNC, { isOptional: true })
    private readonly listenersAsync: IEventListenerAsync[],
    private readonly logger: Logger,
  ) {}

  _wrapError<T extends any[], R>(func: (...args: T) => R, thisArg: any) {
    return (...args: T) => {
      try {
        return func.apply(thisArg, args);
      } catch (e) {
        this.logger.error(e, 'error in event dispatching');
      }
    };
  }

  async send(event: string, data: any) {
    const sync = this.listenersSync.filter((l) => listenEvents(l, event));
    const async = this.listenersAsync.filter((l) =>
      listenEventsAsync(l, event),
    );
    sync.map((l) => this._wrapError(l.on, l)).forEach((l) => l(event, data));
    await Promise.all(
      async
        .map((l) => this._wrapError(l.onAsync, l))
        .map((l) => l(event, data)),
    );
  }

  async sendSync(event: string, data: any) {
    const sync = this.listenersSync.filter((l) => listenEvents(l, event));
    const async = this.listenersAsync.filter((l) =>
      listenEventsAsync(l, event),
    );
    sync.map((l) => this._wrapError(l.on, l)).forEach((l) => l(event, data));
    Promise.all(
      async
        .map((l) => this._wrapError(l.onAsync, l))
        .map((l) => l(event, data)),
    ).catch((e) => this.logger.error(e, 'error in sync event dispatching'));
  }
}

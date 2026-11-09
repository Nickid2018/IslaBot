export { EventBus } from '../core/events';

export const EVENT_LISTENER = Symbol('EVENT_LISTENER');
export const EVENT_LISTENER_ASYNC = Symbol('EVENT_LISTENER_ASYNC');

export interface IEventListener {
  on(event: string, data: any): void;
}

export interface IEventListenerAsync {
  onAsync(event: string, data: any): Promise<void>;
}

const EVENT_LISTENS = Symbol('EVENT_LISTENS');
const EVENT_LISTENS_ASYNC = Symbol('EVENT_LISTENS');

export function listen(events: string[]) {
  return (target: Function) =>
    Reflect.defineMetadata(EVENT_LISTENS, events, target);
}

export function listenEvents(listener: IEventListener, key: string) {
  return (Reflect.getMetadata(EVENT_LISTENS, listener) || []).includes(key);
}

export function listenAsync(events: string[]) {
  return (target: Function) =>
    Reflect.defineMetadata(EVENT_LISTENS_ASYNC, events, target);
}

export function listenEventsAsync(listener: IEventListenerAsync, key: string) {
  return (Reflect.getMetadata(EVENT_LISTENS_ASYNC, listener) || []).includes(
    key,
  );
}

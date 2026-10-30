import 'reflect-metadata';
import './core';
import { container } from 'tsyringe';
import { IProvider, PROVIDER_TOKEN } from './providers';
import { CommandResolver } from './core/command';
import { Logger } from './core/logger';
import { Features } from './core/features';

export const STOP_CONTROLLER = new AbortController();

const manuallyStop = () => {
  console.log('\nreceived manually stop');
  STOP_CONTROLLER.abort();
};
process.on('SIGINT', manuallyStop);
process.on('SIGTERM', manuallyStop);

process.stdin.resume();
(async () => {
  await import('./plugins');
  await import('./providers');

  const logger = container.resolve(Logger);
  const features = container.resolve(Features);
  const providers = container.resolveAll<IProvider>(PROVIDER_TOKEN);
  providers.forEach((p) => p.init());
  providers.map((p) => new CommandResolver(p, features, logger));

  await new Promise((r) => STOP_CONTROLLER.signal.addEventListener('abort', r));
  console.log('IslaCore is closing');

  const timeout = new Promise((r) => setTimeout(() => r(true), 5000));
  const result = await Promise.any([container.dispose(), timeout]);
  if (result) console.warn("bot core doesn't stop in time, force stopped.");

  process.exit(0);
})();

import { IProvider, Message, Target } from '../providers';
import { container } from 'tsyringe';
import {
  COMMAND_CAUGHT,
  COMMAND_PROVIDER_TOKEN,
  ICommandProvider,
} from '../api/command';
import { Logger } from './logger';
import { Features } from './features';

export class CommandResolver {
  constructor(
    private readonly provider: IProvider,
    private readonly features: Features,
    private readonly logger: Logger,
  ) {
    provider.listen(this.listen);
  }

  private listen = async (
    target: Target,
    scope: Target,
    msgId: string,
    message: Message,
  ) => {
    const pScope = `${this.provider.id()}:${scope}`;
    if (!(await this.features.groupEnabled(pScope))) return;
    const commandProviders = container.resolveAll<ICommandProvider>(
      COMMAND_PROVIDER_TOKEN,
    );
    const ctx = {};
    const argv = [this.provider, target, scope, msgId, message] as any;
    for (const p of commandProviders) {
      const commands = p.commands();
      const invoke = Object.create(p);
      (p as any).ctx = ctx;
      for (const command of commands) {
        try {
          const result = await command.apply(invoke, argv);
          if (result === COMMAND_CAUGHT) return;
        } catch (e) {
          this.logger.error(e);
        }
      }
    }
  };
}

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
    if (!this.features.groupEnabled(scope)) return;
    const commandProviders = container.resolveAll<ICommandProvider>(
      COMMAND_PROVIDER_TOKEN,
    );
    const commands = commandProviders.map((c) => c.commands()).flat();
    for (const command of commands) {
      try {
        if (
          (await command(this.provider, target, scope, msgId, message)) ===
          COMMAND_CAUGHT
        )
          return;
      } catch (e) {
        this.logger.error(e);
      }
    }
  };
}

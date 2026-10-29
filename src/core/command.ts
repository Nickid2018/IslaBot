import { IProvider, Message, Target } from '../providers';
import { container } from 'tsyringe';
import {
  COMMAND_CAUGHT,
  COMMAND_PROVIDER_TOKEN,
  ICommandProvider,
} from '../api/command';

export class CommandResolver {
  constructor(private readonly provider: IProvider) {
    provider.listen(this.listen);
  }

  private listen = async (
    target: Target,
    scope: Target,
    msgId: string,
    message: Message,
  ) => {
    const commandProviders = container.resolveAll<ICommandProvider>(
      COMMAND_PROVIDER_TOKEN,
    );
    const commands = commandProviders.map((c) => c.commands()).flat();
    for (const command of commands) {
      if (
        (await command(this.provider, target, scope, msgId, message)) ===
        COMMAND_CAUGHT
      )
        return;
    }
  };
}

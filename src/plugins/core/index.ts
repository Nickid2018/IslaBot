import { injectable } from 'tsyringe';
import {
  COMMAND_CAUGHT,
  COMMAND_PROVIDER_TOKEN,
  CommandResult,
  ICommandProvider,
  permission,
  prefix,
} from '../../api/command';
import { Permission } from '../../core/permission';
import { PermissionLevel } from '../../../generated/prisma/enums';
import { STOP_CONTROLLER } from '../../main';
import { IProvider, Target, text } from '../../providers';

@injectable({ token: COMMAND_PROVIDER_TOKEN })
export class CoreCommands implements ICommandProvider {
  constructor(private readonly permission: Permission) {}

  @prefix('~exit')
  @permission(PermissionLevel.SYSOP)
  async exit(
    provider: IProvider,
    _: Target,
    scope: Target,
  ): Promise<CommandResult> {
    setTimeout(() => STOP_CONTROLLER.abort(), 10000);
    await provider.send(scope, text('bot will exit after 10 seconds'));
    return COMMAND_CAUGHT;
  }

  commands() {
    return [this.exit].map(i => i.bind(this));
  }
}

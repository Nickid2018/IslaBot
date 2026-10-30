import { injectable } from 'tsyringe';
import {
  COMMAND_CAUGHT,
  COMMAND_PROVIDER_TOKEN,
  COMMAND_SKIPPED,
  CommandResult,
  ICommandProvider,
  permission,
  prefix,
  regex,
} from '../../api/command';
import { LEVELS_INDEX, Permission } from '../../core/permission';
import { PermissionLevel } from '../../../generated/prisma/enums';
import { STOP_CONTROLLER } from '../../main';
import {
  AtMessage,
  findFirstText,
  findFirstType,
  IProvider,
  Message,
  Target,
  text,
} from '../../providers';
import { Logger } from '../../core/logger';

@injectable({ token: COMMAND_PROVIDER_TOKEN })
export class CoreCommands implements ICommandProvider {
  constructor(
    private readonly permission: Permission,
    private readonly logger: Logger,
  ) {}

  @prefix('~exit')
  @permission(PermissionLevel.SYSOP)
  async exit(
    provider: IProvider,
    _: Target,
    scope: Target,
  ): Promise<CommandResult> {
    setTimeout(() => STOP_CONTROLLER.abort(), 10000);
    await provider.send(scope, text('bot 将在 10 秒后自动关闭'));
    return COMMAND_CAUGHT;
  }

  @prefix('~permission get')
  @permission(PermissionLevel.ADMIN)
  async permissionGet(
    provider: IProvider,
    target: Target,
    scope: Target,
    _: string,
    message: Message,
  ): Promise<CommandResult> {
    const textFirst = findFirstText(message);
    let uid = textFirst.substring(15).trim();
    if (!uid) {
      const at = findFirstType(message, 'at');
      if (!at) uid = `${provider.id()}:${target}`;
      else uid = `${provider.id()}:${(at as AtMessage).target}`;
    }
    const permissionNow = await this.permission.getPermission(uid);
    await provider.send(scope, text(`${uid} 的权限等级为 ${permissionNow}`));
    return COMMAND_CAUGHT;
  }

  @regex(/^~permission set (BANNED|SEMIBANNED|NORMAL|ADMIN)(.*)$/)
  @permission(PermissionLevel.ADMIN)
  async permissionSet(
    provider: IProvider,
    target: Target,
    scope: Target,
    _: string,
    message: Message,
    match?: RegExpMatchArray,
  ): Promise<CommandResult> {
    if (!match) return COMMAND_SKIPPED;
    const permission = match[1] as PermissionLevel;
    let uid = match[2].trim();
    if (!uid) {
      const at = findFirstType(message, 'at');
      if (!at) uid = `${provider.id()}:${target}`;
      else uid = `${provider.id()}:${(at as AtMessage).target}`;
    }
    const permissionNow = await this.permission.getPermission(
      `${provider.id()}:${target}`,
    );
    if (
      LEVELS_INDEX[permission] >= LEVELS_INDEX[permissionNow] &&
      permissionNow != PermissionLevel.SYSOP
    ) {
      await provider.send(scope, text('权限不足'));
    } else {
      await this.permission.setPermission(uid, permission);
      await provider.send(
        scope,
        text(`已设置 ${uid} 的权限等级为 ${permission}`),
      );
      this.logger.warn(`Permission for '${uid}' set to '${permission}'`);
    }
    return COMMAND_CAUGHT;
  }

  commands() {
    return [this.exit, this.permissionGet, this.permissionSet].map((i) =>
      i.bind(this),
    );
  }
}

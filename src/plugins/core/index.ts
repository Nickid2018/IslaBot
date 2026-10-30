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
import { Features } from '../../core/features';

@injectable({ token: COMMAND_PROVIDER_TOKEN })
export class CoreCommands implements ICommandProvider {
  constructor(
    private readonly permission: Permission,
    private readonly features: Features,
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

  @regex(/^~group enable (.*)$/)
  @permission(PermissionLevel.SYSOP)
  async enableGroup(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    const group = match[1];
    await this.features.enableGroup(group);
    await provider.send(scope, text(`会话 ${group} 已启用`));
    return COMMAND_CAUGHT;
  }

  @regex(/^~group disable (.*)$/)
  @permission(PermissionLevel.SYSOP)
  async disableGroup(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    const group = match[1];
    await this.features.disableGroup(group);
    await provider.send(scope, text(`会话 ${group} 已禁用`));
    return COMMAND_CAUGHT;
  }

  @regex(/^~feature enable (.*)$/)
  @permission(PermissionLevel.ADMIN)
  async enableFeature(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    const group = `${provider.id()}:${scope}`;
    const feature = match[1].trim();
    await this.features.enableFeature(group, feature);
    await provider.send(scope, text(`会话 ${group} 已启用功能 ${feature}`));
    return COMMAND_CAUGHT;
  }

  @regex(/^~feature disable (.*)$/)
  @permission(PermissionLevel.ADMIN)
  async disableFeature(
    provider: IProvider,
    _: Target,
    scope: Target,
    __: string,
    ___: Message,
    match?: RegExpMatchArray,
  ) {
    if (!match) return COMMAND_SKIPPED;
    const group = `${provider.id()}:${scope}`;
    const feature = match[1].trim();
    await this.features.disableFeature(group, feature);
    await provider.send(scope, text(`会话 ${group} 已禁用功能 ${feature}`));
    return COMMAND_CAUGHT;
  }

  commands() {
    return [
      this.exit,
      this.permissionGet,
      this.permissionSet,
      this.enableGroup,
      this.disableGroup,
      this.enableFeature,
      this.disableFeature,
    ].map((i) => i.bind(this));
  }
}

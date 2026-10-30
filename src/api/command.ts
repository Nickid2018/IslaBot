import { IProvider, Message, Target } from '../providers';
import { PermissionLevel } from '../../generated/prisma/enums';
import { Permission } from '../core/permission';
import { Features } from '../core/features';

export const COMMAND_PROVIDER_TOKEN = Symbol('COMMAND_PROVIDER_TOKEN');
export const COMMAND_SKIPPED = Symbol('COMMAND_SKIPPED');
export const COMMAND_CAUGHT = Symbol('COMMAND_CAUGHT');

export type CommandResult = typeof COMMAND_SKIPPED | typeof COMMAND_CAUGHT;

export interface ICommandProvider {
  commands: () => ((
    provider: IProvider,
    target: Target,
    scope: Target,
    msgId: string,
    message: Message,
  ) => Promise<CommandResult>)[];
}

export function predicate(
  pred: () => Promise<boolean> | boolean,
): MethodDecorator {
  return function (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      if (!(await pred())) return COMMAND_SKIPPED;
      return await originalMethod.apply(this, args);
    };
    return descriptor;
  };
}

export function feature(
  flag: string,
  defaultVal: boolean = false,
): MethodDecorator {
  return function (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const provider = args[0] as IProvider;
      const scope = args[2] as string;
      const pScope = `${provider.id()}:${scope}`;
      const convert = this as { features: Features };
      if (!(await convert.features.featureEnabled(pScope, flag, defaultVal)))
        return COMMAND_SKIPPED;
      return await originalMethod.apply(this, args);
    };
    return descriptor;
  };
}

export function prefix(prefix: string, first: boolean = true): MethodDecorator {
  return function (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const message = args[4] as Message;
      const candidates = (Array.isArray(message) ? message : [message])
        .filter((m) => m.type === 'text')
        .map((m) => m.content);
      if (candidates.length === 0) return;
      const allowed = first
        ? candidates[0].startsWith(prefix)
        : candidates.some((m) => m.startsWith(prefix));
      if (!allowed) return COMMAND_SKIPPED;
      return await originalMethod.apply(this, args);
    };
    return descriptor;
  };
}

export function regex(regex: RegExp, first: boolean = true): MethodDecorator {
  return function (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const message = args[4] as Message;
      const candidates = (Array.isArray(message) ? message : [message])
        .filter((m) => m.type === 'text')
        .map((m) => m.content);
      if (candidates.length === 0) return;
      const allowed = first
        ? candidates[0].match(regex)
        : candidates
            .map((m) => m.match(regex))
            .filter((p) => !!p)
            .at(0);
      if (!allowed) return COMMAND_SKIPPED;
      args.push(allowed);
      return await originalMethod.apply(this, args);
    };
    return descriptor;
  };
}

export function permission(permission: PermissionLevel): MethodDecorator {
  return function (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const provider = args[0] as IProvider;
      const target = args[1] as Target;
      const userKey = `${provider.id()}:${target}`;
      const convert = this as { permission: Permission };
      if (!(await convert.permission.hasPermission(userKey, permission)))
        return COMMAND_SKIPPED;
      return await originalMethod.apply(this, args);
    };
    return descriptor;
  };
}

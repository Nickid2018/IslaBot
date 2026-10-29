import 'dotenv/config';
import { injectable, singleton } from 'tsyringe';
import * as process from 'node:process';
import * as YAML from 'yaml';
import * as fs from 'node:fs';

export const CONFIG_TOKEN = Symbol('CONFIG_TOKEN');

@injectable({ token: CONFIG_TOKEN })
@singleton()
export class Config {
  private readonly configMapCached = new Map<string, string>();
  private readonly configMapSource: any;

  constructor() {
    const configPath = process.env.CONFIG_PATH || './config.yaml';
    const fileContent = fs.readFileSync(configPath, { encoding: 'utf-8' });
    this.configMapSource = YAML.parse(fileContent);
  }

  get(cfgPath: string): string | null {
    if (this.configMapCached.has(cfgPath)) {
      const val = this.configMapCached.get(cfgPath);
      return val ? String(val) : null;
    }
    const path = cfgPath.split('.');
    const val = path.reduce((pv, curr) => pv?.[curr], this.configMapSource);
    this.configMapCached.set(cfgPath, val);
    return val ? String(val) : null;
  }
}

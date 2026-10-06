import {
  addProfile,
  configPath,
  listProfiles,
  loadConfig,
  maskKey,
  removeProfile,
  useProfile,
} from '../config.js';
import { CliError } from '../errors.js';
import { out } from '../format.js';
import { PROFILE_RE } from '../utils/constants.js';
import { getClient } from './shared.js';

function validateProfileName(name: string): void {
  if (!PROFILE_RE.test(name)) {
    throw new CliError(
      'Profile name must start with a letter/number and contain only letters, numbers, ".", "_" or "-".',
    );
  }
}

export function profileAddCommand(
  name: string,
  opts: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  },
): void {
  validateProfileName(name);

  if (!opts.apiKey) {
    throw new CliError(
      'Usage: llm profile add <name> --api-key <key> [--base-url <url>] [--model <model>]',
    );
  }

  addProfile(name, {
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? loadConfig().baseUrl,
    model: opts.model,
  });

  console.log(`Profile "${name}" added.`);
}

export function profileUseCommand(name: string): void {
  validateProfileName(name);
  useProfile(name);
  console.log(`Using profile "${name}".`);
}

export function profileListCommand(): void {
  const profiles = listProfiles();

  if (profiles.length === 0) {
    console.log(out.dim(
      'No profiles yet. Create one with: llm profile add personal --api-key <key>',
    ));
    return;
  }

  for (const p of profiles) {
    const marker = p.active ? '*' : ' ';
    console.log(
      `${marker} ${p.name}  ${p.profile.baseUrl}  ${maskKey(p.profile.apiKey)}`,
    );
  }
}

export function profileCurrentCommand(): void {
  const config = loadConfig();

  console.log(`profile  ${config.currentProfile ?? '(legacy)'}`);
  console.log(`baseUrl  ${config.baseUrl}`);
  console.log(`apiKey   ${maskKey(config.apiKey)}`);
  console.log(`model    ${config.model ?? '(server default)'}`);
  console.log(out.dim(`file     ${configPath()}`));
}

export function profileRemoveCommand(name: string): void {
  validateProfileName(name);
  removeProfile(name);
  console.log(`Profile "${name}" removed.`);
}

export async function whoAmICommand(): Promise<void> {
  const config = loadConfig();
  const client = getClient();
  const user = await client.me();

  console.log(`profile  ${config.currentProfile ?? '(legacy)'}`);
  console.log(`user     ${user.email}`);
  console.log(`userId   ${user.id}`);
  console.log(`gateway  ${config.baseUrl}`);
  console.log(`apiKey   ${maskKey(config.apiKey)}`);
}
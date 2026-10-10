import {
  addProfile,
  configPath,
  listProfiles,
  loadConfig,
  maskKey,
  removeProfile,
  useProfile,
  validateProfileName,
} from '../config.js';
import { CliError } from '../errors.js';
import { out } from '../format.js';
import { DEFAULT_BASE_URL } from '../utils/constants.js';
import { readSecretFromStdin, promptSecret } from '../utils/secret.js';
import { getClient } from './shared.js';

/**
 * Finds the API key without forcing it onto the command line, where it would end up
 * in shell history and `ps`. Order: --api-key (works, but warns), --api-key-stdin,
 * then a hidden prompt on a terminal.
 */
export async function resolveApiKeyInput(opts: {
  apiKey?: string;
  apiKeyStdin?: boolean;
}): Promise<string> {
  let key: string | undefined;

  if (opts.apiKey) {
    console.error(
      out.dim(
        'Note: a key passed with --api-key is visible in your shell history and process list. ' +
          'Prefer the prompt, or: printf %s "$KEY" | llm profile add <name> --api-key-stdin',
      ),
    );
    key = opts.apiKey;
  } else if (opts.apiKeyStdin) {
    key = await readSecretFromStdin();
  } else {
    key = await promptSecret('API key (input hidden): ');
  }

  if (!key) {
    throw new CliError(
      'No API key given. Run in a terminal to be prompted, or pipe it in:\n' +
        '  printf %s "$KEY" | llm profile add <name> --api-key-stdin',
    );
  }
  return key;
}

export async function profileAddCommand(
  name: string,
  opts: {
    apiKey?: string;
    apiKeyStdin?: boolean;
    baseUrl?: string;
    model?: string;
  },
): Promise<void> {
  validateProfileName(name);

  const apiKey = await resolveApiKeyInput(opts);

  // A new profile never inherits the URL of whatever is active or set in the
  // environment: that would silently pair this key with the wrong server.
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;

  const result = addProfile(name, { apiKey, baseUrl, model: opts.model });

  console.log(`Profile "${name}" added for ${baseUrl}.`);
  if (result.migrated) {
    console.log(
      out.dim('Your earlier settings were kept as a profile named "default" (still active).'),
    );
  }
  if (result.active === name) {
    console.log(`Active profile: ${name}`);
  } else {
    console.log(out.dim(`Active profile is still "${result.active}". Switch with: llm profile use ${name}`));
  }
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
      'No profiles yet. Create one with: llm profile add personal',
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

  console.log(`profile  ${config.currentProfile ?? '(none)'}`);
  console.log(`baseUrl  ${config.baseUrl}${config.overrides?.includes('baseUrl') ? out.dim('  (from LLM_BASE_URL)') : ''}`);
  console.log(`apiKey   ${maskKey(config.apiKey)}${config.overrides?.includes('apiKey') ? out.dim('  (from LLM_API_KEY)') : ''}`);
  console.log(`model    ${config.model ?? '(server default)'}${config.overrides?.includes('model') ? out.dim('  (from LLM_MODEL)') : ''}`);
  console.log(out.dim(`file     ${configPath()}`));

  if (config.keyWithheldFor) {
    console.log(
      out.dim(
        `note     LLM_BASE_URL differs from the saved gateway, so the saved key is not used. Set LLM_API_KEY too.`,
      ),
    );
  }
  if (config.profileProblem) console.log(out.dim(`note     ${config.profileProblem}`));
}

export function profileRemoveCommand(name: string, opts: { force?: boolean } = {}): void {
  validateProfileName(name);
  const { wasActive, remaining } = removeProfile(name, undefined, { force: opts.force });
  console.log(`Profile "${name}" removed.`);
  if (wasActive && remaining.length > 0) {
    console.log(
      out.dim(`No profile is active now. Choose one with: llm profile use <name>  (${remaining.join(', ')})`),
    );
  }
}

export async function whoAmICommand(): Promise<void> {
  const config = loadConfig();
  const client = getClient();
  const user = await client.me();

  console.log(`profile  ${config.currentProfile ?? '(none)'}`);
  console.log(`user     ${user.email}`);
  console.log(`userId   ${user.id}`);
  console.log(`gateway  ${config.baseUrl}`);
  console.log(`apiKey   ${maskKey(config.apiKey)}`);
}

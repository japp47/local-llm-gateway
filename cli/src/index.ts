#!/usr/bin/env node
import { Command } from 'commander';
import { chatCommand, resumeCommand } from './commands/chat.js';
import { forkCommand, lsCommand, renameCommand, rmCommand, showCommand } from './commands/conversations.js';
import { configPathCommand, configSetCommand, configShowCommand, modelsCommand, statsCommand } from './commands/info.js';
import { CliError, describeError } from './errors.js';
import { errc } from './format.js';
import {
  profileAddCommand,
  profileCurrentCommand,
  profileListCommand,
  profileRemoveCommand,
  profileUseCommand,
  whoAmICommand,
} from './commands/profile.js';

// Wraps an action so any failure prints one friendly line and sets the exit code.
const wrap =
  <A extends unknown[]>(fn: (...args: A) => unknown) =>
  async (...args: A) => {
    try {
      await fn(...args);
    } catch (e) {
      console.error(errc.red(describeError(e)));
      process.exitCode = e instanceof CliError ? e.exitCode : 1;
    }
  };

const program = new Command();
program.name('llm').description('Chat with your local LLM gateway from the terminal').version('0.1.0').showHelpAfterError();

program
  .command('chat')
  .description('start a conversation (interactive), or ask one question when a message is given')
  .argument('[message...]', 'message to send; use "-" to read it from stdin')
  .option('-m, --model <name>', 'model to use')
  .option('-s, --system <prompt>', 'system prompt for the new conversation')
  .option('-t, --title <title>', 'conversation title')
  .option('-q, --quiet', 'hide token/latency details')
  .action(wrap(chatCommand));

program
  .command('resume')
  .description('continue an existing conversation')
  .argument('<id>', 'conversation id, unique prefix, or "latest"')
  .option('-m, --model <name>', 'model for your next messages')
  .option('--tail <n>', 'earlier messages to show first', '6')
  .option('-q, --quiet', 'hide token/latency details')
  .action(wrap(resumeCommand));

program
  .command('conversations')
  .alias('ls')
  .description('list your conversations')
  .option('-n, --limit <n>', 'how many to list', '20')
  .option('--json', 'machine-readable output')
  .action(wrap(lsCommand));

program
  .command('show')
  .description('print a conversation transcript (messages are numbered for forking)')
  .argument('<id>')
  .option('--last <n>', 'only the last n messages')
  .option('--json', 'machine-readable output')
  .action(wrap(showCommand));

program
  .command('fork')
  .description('branch a conversation from a message')
  .argument('<id>')
  .option('--from <n|messageId>', 'message number from `llm show` (default: last assistant reply)')
  .option('-t, --title <title>', 'title for the branch')
  .option('-m, --model <name>', 'default model for the branch')
  .option('--chat', 'jump straight into the branch')
  .option('-q, --quiet', 'hide token/latency details')
  .action(wrap(forkCommand));

program.command('rename').description('rename a conversation').argument('<id>').argument('<title...>').action(wrap(renameCommand));

program
  .command('rm')
  .description('delete a conversation')
  .argument('<id>')
  .option('-y, --yes', 'do not ask for confirmation')
  .action(wrap(rmCommand));

program.command('models').description('list the models the gateway allows').option('--json', 'machine-readable output').action(wrap(modelsCommand));

program
  .command('stats')
  .description('latency, throughput and token usage from your generations')
  .option('--hours <n>', 'time window', '24')
  .option('--recent <n>', 'recent generations to list', '5')
  .option('--json', 'machine-readable output')
  .action(wrap(statsCommand));

const profile = program
  .command('profile')
  .description('manage gateway profiles');

profile
  .command('add')
  .argument('<name>')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'gateway base URL')
  .option('--model <name>', 'default CLI model')
  .action(wrap(profileAddCommand));

profile
  .command('use')
  .argument('<name>')
  .action(wrap(profileUseCommand));

profile
  .command('list')
  .action(wrap(profileListCommand));

profile
  .command('current')
  .action(wrap(profileCurrentCommand));

profile
  .command('remove')
  .argument('<name>')
  .action(wrap(profileRemoveCommand));

program
  .command('whoami')
  .description('show the authenticated gateway user')
  .action(wrap(whoAmICommand));

const config = program.command('config').description('manage CLI settings');
config.command('set').argument('<key>', 'baseUrl | apiKey | model').argument('<value>').action(wrap(configSetCommand));
config.command('show').action(wrap(configShowCommand));
config.command('path').action(wrap(configPathCommand));

await program.parseAsync();
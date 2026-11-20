// What the gateway says about models when it starts. It warns and keeps running: Ollama may
// be started (or a model pulled) a moment later, and requests then work without a restart.
// Port and lock problems are fatal and handled in server.ts / instance-lock.ts.
import type { InstalledModel } from '../providers/ollama-models.js';
import { ProviderError } from '../providers/types.js';
import { gb, normalizeName } from './model-picker.js';
import type { ModelsService } from './models.service.js';

export interface ReportLine {
  level: 'info' | 'warn';
  msg: string;
  data?: Record<string, unknown>;
}

export async function startupReport(
  models: ModelsService,
  source: { installed(): Promise<InstalledModel[]> },
  defaultModel: string | undefined,
): Promise<ReportLine[]> {
  let installed: InstalledModel[];
  try {
    installed = await source.installed();
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    return [{ level: 'warn', msg: `${err.message} ${err.hint ?? ''} The gateway keeps running and will use it once it starts.`.replace(/\s+/g, ' ') }];
  }

  const has = (m: string) => installed.some((i) => normalizeName(i.name) === normalizeName(m));
  if (defaultModel) {
    return has(defaultModel)
      ? [{ level: 'info', msg: `default model ${defaultModel} (from DEFAULT_MODEL)` }]
      : [{ level: 'warn', msg: `The default model ${defaultModel} isn't downloaded yet. Run: ollama pull ${defaultModel}` }];
  }

  const pick = await models.describePick();
  switch (pick.kind) {
    case 'picked':
      return [
        {
          level: 'info',
          msg: `model ${pick.model} picked: needs ~${gb(pick.needBytes)} GB of a ${gb(pick.budgetBytes)} GB budget`,
          data: { why: pick.why },
        },
      ];
    case 'none_installed':
      return [{ level: 'warn', msg: `No chat model is downloaded yet. Run: ollama pull ${pick.suggestion}` }];
    case 'none_fit':
      return [
        {
          level: 'warn',
          msg: `The downloaded models need more memory than this machine can spare (${pick.smallest.model} needs ~${gb(pick.smallest.needBytes)} GB of a ${gb(pick.budgetBytes)} GB budget). Download a smaller one: ollama pull ${pick.suggestion}`,
        },
      ];
  }
}

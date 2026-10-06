import type { ModelsRepo } from '../repositories/models.js';

export interface ModelInfo {
  id: string;
  default: boolean;
}

export class ModelsService {
  constructor(
    private readonly models: ModelsRepo,
    private readonly defaultModel: string,
  ) {}

  list(): ModelInfo[] {
    return this.models.listAllowed().map((id) => ({
      id,
      default: id === this.defaultModel,
    }));
  }

  getDefault(): ModelInfo {
    return { id: this.defaultModel, default: true };
  }
}

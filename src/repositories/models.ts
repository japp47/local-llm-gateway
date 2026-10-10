export class ModelsRepo {
  constructor(private readonly allowedModels: ReadonlySet<string>) {}

  listAllowed(): string[] {
    return [...this.allowedModels];
  }
}

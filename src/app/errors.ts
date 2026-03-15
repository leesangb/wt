export class AppError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = 1) {
    super(message);
    this.name = "AppError";
    this.exitCode = exitCode;
  }
}

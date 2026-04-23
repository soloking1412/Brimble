export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

export function badRequest(message: string): AppError {
  return new AppError(message, 400);
}

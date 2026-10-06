export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly retryAfter?: string,
  ) {
    super(message);
  }
}

export class ConnectionError extends Error {}

export async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '');
  let code = `http_${response.status}`;
  let message = text.slice(0, 200) || response.statusText;
  let requestId = response.headers.get('x-request-id') ?? undefined;
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string; request_id?: string } };
    if (body.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      requestId = body.error.request_id ?? requestId;
    }
  } catch {
    // Non-JSON response bodies use the HTTP status and response text.
  }
  return new ApiError(
    response.status,
    code,
    message,
    requestId,
    response.headers.get('retry-after') ?? undefined,
  );
}

// ---------------------------------------------------------------------------
// Typed Error Hierarchy — ADR-0008
// AkiflowError is abstract; all concrete errors extend it.
// core/ has ZERO external dependency imports (ADR-0006)
// ---------------------------------------------------------------------------

// Base abstract error
export abstract class AkiflowError extends Error {
  abstract readonly code: string;
  abstract readonly userMessage: string;
  abstract readonly hint?: string;

  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// --- Authentication errors ---

export class AuthError extends AkiflowError {
  readonly code: string = "AUTH_GENERIC";
  readonly userMessage: string = "인증이 필요합니다.";
  readonly hint: string = "터미널에서 'af auth'를 실행하세요.";
}

export class AuthExpiredError extends AuthError {
  override readonly code = "AUTH_EXPIRED";
  override readonly userMessage = "인증이 만료되었습니다.";
  override readonly hint = "'af auth refresh' 또는 'af auth'를 실행하세요.";
}

export class AuthSourceMissingError extends AuthError {
  override readonly code = "AUTH_SOURCE_MISSING";
  override readonly userMessage = "인증 정보를 어디서도 찾을 수 없습니다.";
  override readonly hint = "브라우저에서 Akiflow에 로그인 후 'af auth'를 실행하세요.";
}

// --- Network / API errors ---

export class NetworkError extends AkiflowError {
  readonly code: string = "NETWORK_GENERIC";
  readonly userMessage: string = "Akiflow 서버에 연결할 수 없습니다.";
  readonly hint: string = "네트워크 연결을 확인해주세요.";

  constructor(
    message: string,
    public readonly status?: number,
    cause?: Error,
  ) {
    super(message, cause);
  }
}

export class ApiSchemaError extends NetworkError {
  override readonly code = "API_SCHEMA_MISMATCH";
  override readonly userMessage = "Akiflow API 응답 형식이 예상과 다릅니다.";
  override readonly hint = "Akiflow 내부 API가 변경되었을 수 있습니다. 최신 버전으로 업데이트하세요.";
}

// --- Validation errors ---

export class ValidationError extends AkiflowError {
  readonly code = "VALIDATION" as const;
  readonly userMessage = "입력값이 올바르지 않습니다.";
  readonly hint = undefined;

  constructor(
    message: string,
    public readonly field?: string,
    cause?: Error,
  ) {
    super(message, cause);
  }
}

// --- Resource errors ---

export class NotFoundError extends AkiflowError {
  readonly code = "NOT_FOUND" as const;
  readonly userMessage = "요청한 리소스를 찾을 수 없습니다.";
  readonly hint = undefined;

  constructor(
    message: string,
    public readonly resourceType?: string,
    cause?: Error,
  ) {
    super(message, cause);
  }
}

// --- Browser data errors ---

export class BrowserDataError extends AkiflowError {
  readonly code = "BROWSER_DATA" as const;
  readonly userMessage = "브라우저 데이터에서 토큰을 추출하지 못했습니다.";
  readonly hint = undefined;
}

export const TRANSACTION_ID_FIELD = "transaction_id";

export class ApiError extends Error {
  readonly status: number;
  readonly field: string | undefined;

  constructor(status: number, message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
  }
}

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

export class DailyCapError extends ApiError {
  readonly maxAmount: number;

  constructor(message: string, field: string, maxAmount: number) {
    super(400, message, field);
    this.name = "DailyCapError";
    this.maxAmount = maxAmount;
  }
}

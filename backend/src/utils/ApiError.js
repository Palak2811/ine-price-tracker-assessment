/**
 * An error with an HTTP status and a stable machine-readable code.
 *
 * Anything thrown that is NOT an ApiError is treated by the error handler as an
 * unexpected internal fault: it is logged in full but reported to the client as
 * a generic 500, so stack traces and database details never leak.
 */
export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }

  static badRequest(code, message, details) { return new ApiError(400, code, message, details); }
  static unauthorized(message = 'Unauthorized') { return new ApiError(401, 'unauthorized', message); }
  static notFound(message = 'Not found') { return new ApiError(404, 'not_found', message); }
  static conflict(code, message) { return new ApiError(409, code, message); }
}

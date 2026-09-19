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

import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export const requestContext: RequestHandler = (req, res, next) => {
  req.requestId = req.header("x-request-id")?.slice(0, 128) || randomUUID();
  res.setHeader("x-request-id", req.requestId);
  const started = performance.now();
  const requestPath = req.path;
  res.on("finish", () => {
    console.log(JSON.stringify({
      level: "info",
      event: "request",
      request_id: req.requestId,
      method: req.method,
      path: requestPath,
      status: res.statusCode,
      duration_ms: Math.round(performance.now() - started)
    }));
  });
  next();
};

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => void handler(req, res, next).catch(next);
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const constraint = typeof error === "object" && error !== null
    && "code" in error && String(error.code).startsWith("SQLITE_CONSTRAINT");
  const parserStatus = typeof error === "object" && error !== null && "status" in error
    && (error.status === 400 || error.status === 413) ? error.status : undefined;
  const known = error instanceof HttpError;
  const status = known ? error.status : constraint ? 409 : parserStatus ?? 500;
  if (!known && !constraint && !parserStatus) {
    console.error(JSON.stringify({
      level: "error",
      event: "unhandled_error",
      request_id: req.requestId,
      message: error instanceof Error ? error.message : "Unknown error"
    }));
  }
  res.status(status).json({
    error: {
      code: known ? error.code : constraint ? "record_conflict" : parserStatus === 413 ? "payload_too_large" : parserStatus ? "invalid_json" : "internal_error",
      message: known ? error.message : constraint ? "The operation conflicts with existing records"
        : parserStatus === 413 ? "Request body is too large" : parserStatus ? "Request body is not valid JSON" : "An unexpected error occurred",
      request_id: req.requestId,
      ...(known && error.details !== undefined ? { details: error.details } : {})
    }
  });
};

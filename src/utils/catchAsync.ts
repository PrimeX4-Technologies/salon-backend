import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export const catchAsync = (handler: AsyncRequestHandler): RequestHandler =>
  (req, res, next): void => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };

export default catchAsync;

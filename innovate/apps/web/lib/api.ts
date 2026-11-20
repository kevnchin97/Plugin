import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what);

/** Wrap a route handler: zod and HttpError become readable JSON errors. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof z.ZodError)
        return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request", issues: err.issues }, { status: 400 });
      console.error(err);
      return NextResponse.json({ error: "Something went wrong on our side." }, { status: 500 });
    }
  };
}

export async function parseJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Expected a JSON body");
  }
  return schema.parse(body);
}

export const uuidParam = z.uuid({ message: "Invalid id" });

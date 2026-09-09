import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("x-stylex-node-proxy", request.nextUrl.pathname);
  return response;
}

export const config = { matcher: ["/", "/edge", "/index/:path*"] };

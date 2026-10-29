import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, accessToken } from "@/lib/access";

// Hosted demo: every page needs the shared access code. Without DEMO_ACCESS_CODE (local development) it is open.
export async function proxy(request: NextRequest) {
  const code = process.env.DEMO_ACCESS_CODE;
  if (!code || request.cookies.get(ACCESS_COOKIE)?.value === (await accessToken(code))) {
    return NextResponse.next();
  }
  const url = new URL("/access", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!access|_next/static|_next/image|favicon.ico|icon|.*\\.(?:png|svg|ico|woff2?)$).*)"],
};

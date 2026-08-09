import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * The front door. Every route is closed except the ones that open it.
 *
 * This only checks that a session cookie is *present* — it deliberately does
 * not validate it. Next runs proxy separately from render code and may deploy
 * it to a CDN edge, so it can't share the database or the auth module; a
 * cookie that is present but expired, revoked or forged gets past here and is
 * rejected by `requireSession()` in the layout that actually renders.
 *
 * The consequence worth knowing: this file is a redirect for people who
 * aren't logged in, not the security boundary. The boundary is the server
 * component and the media-token callback.
 */
const PUBLIC = ["/login", "/api/auth"];

/**
 * Server-to-server callers, which have no cookie and never will.
 *
 * The box agent presents its own bearer key; MediaMTX presents the viewer's
 * signed token in the request body. Both routes authenticate their caller
 * themselves — leaving them behind the cookie gate would reject MediaMTX on
 * every connection and make the video unplayable for everyone.
 */
const BOX = [
  "/api/stream/desired",
  "/api/stream/report",
  "/api/episodes/record",
  "/api/media/auth",
  "/api/media/clip-auth",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (BOX.some((p) => pathname === p)) return NextResponse.next();

  if (request.cookies.has("truman_session")) return NextResponse.next();

  // An unauthenticated api call should hear about it in json rather than be
  // handed the html of a login page it can't read.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Without a matcher this runs on static assets too, which would redirect the
  // css and fonts the login page needs to render.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|woff2)$).*)"],
};

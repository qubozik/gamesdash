import { NextRequest, NextResponse } from "next/server";

export const config = {
  // Protect everything EXCEPT:
  //  - /api/sync   (the weekly cron; it's guarded by CRON_SECRET instead)
  //  - Next.js internals and static assets
  matcher: ["/((?!api/sync|_next/static|_next/image|favicon.ico).*)"],
};

export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  // If no password is configured, the site stays open (nothing breaks before
  // you set APP_PASSWORD).
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    try {
      const decoded = atob(encoded);
      const provided = decoded.slice(decoded.indexOf(":") + 1);
      if (provided === password) return NextResponse.next();
    } catch {
      // fall through to 401
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Switch Game Tracker", charset="UTF-8"',
    },
  });
}

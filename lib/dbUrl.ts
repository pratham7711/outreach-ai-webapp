/* pg-connection-string already treats sslmode=require as verify-full, and says
   so with a SECURITY WARNING on stderr every cold start. On Vercel that stderr
   line marks every cron invocation "error" in the log view (measured 2026-09-08:
   status 200, level error, message = this warning), which buries the real
   errors and bills a log event per invocation. Naming the mode we already get
   changes nothing about the connection and removes the warning.

   Kept out of lib/db.ts so it can be tested without constructing a client. */
export function explicitSslMode(url: string | undefined): string | undefined {
  return url?.replace(/([?&])sslmode=(require|prefer|verify-ca)(?=&|$)/, "$1sslmode=verify-full");
}

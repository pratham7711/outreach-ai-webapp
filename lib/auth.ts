import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { CredentialsSignin } from "next-auth";
import { loginBlockedForUnverified } from "@/lib/emailVerification";
import { accessFor, isPlatformAdmin } from "@/lib/billing/subscription";
import { authConfig } from "@/lib/auth.config";

/** How stale a JWT's copy of role/isActive may get. See the jwt callback. */
const ROLE_REFRESH_MS = 60_000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
          include: { org: true },
        });
        if (!user || !user.password) return null;
        const valid = await bcrypt.compare(credentials.password as string, user.password);
        if (!valid) return null;

        /* isActive is how a teammate is removed -- the row is kept because it
           owns audit entries, comments and campaign memberships, so the flag is
           the whole revocation. It was written by nobody and read by nobody:
           somebody "removed" from a workspace could sign straight back in.
           After the password, like the two checks below, so an unauthenticated
           stranger learns nothing about which addresses exist. */
        if (user.isActive === false) {
          throw new CredentialsSignin(
            "This account has been deactivated. Ask an owner or admin of your workspace to restore it."
          );
        }

        /* After the password, for the same reason billing is: telling an
           unauthenticated stranger that an address exists but is unconfirmed
           is still telling them the address exists. Thrown rather than null so
           the login screen can say what to do about it -- "invalid credentials"
           would send someone to reset a password that is perfectly correct. */
        if (loginBlockedForUnverified(user)) {
          throw new CredentialsSignin(
            "Confirm your email address first. Check your inbox for the link, or request a new one at /verify-email."
          );
        }

        /* Billing is checked after the password, never before: answering
           "your subscription lapsed" to an unauthenticated stranger tells them
           the address is real and reveals a customer's payment state. Only
           someone who already proved they are this user learns anything. */
        const decision = accessFor(
          {
            subscriptionStatus: user.org.subscriptionStatus,
            paidThrough: user.org.paidThrough,
            trialEndsAt: user.org.trialEndsAt,
          },
          new Date(),
          { isPlatformAdmin: isPlatformAdmin(user.email) }
        );
        if (decision.level === "blocked") {
          /* Thrown rather than returned null so the login screen can say which
             of the two things went wrong. A suspended agency told only "invalid
             credentials" will reset passwords, then call support angry about the
             wrong problem. */
          throw new CredentialsSignin(
            user.org.suspendedReason?.trim() || decision.message
          );
        }

        return { id: user.id, email: user.email, name: user.name, orgId: user.orgId, role: user.role, campaignScope: user.campaignScope };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.id = user.id;
        token.orgId = (user as any).orgId;
        token.role = (user as any).role;
        token.campaignScope = (user as any).campaignScope;
        (token as any).checkedAt = Date.now();
        return token;
      }

      /* Role and orgId were copied in at sign-in and never looked at again, so
         a demotion or a removal did nothing until the person happened to log
         out: a VIEWER demoted from ADMIN kept every admin route for the life of
         a session, and a removed teammate kept all of it.
         Re-read at most once a minute. That is one indexed lookup by primary
         key per user per minute -- cheaper than the request it rides on -- and
         it bounds how long a revoked session survives to under a minute
         instead of the session lifetime. */
      const last = typeof (token as any).checkedAt === "number" ? (token as any).checkedAt : 0;
      if (!token.id || Date.now() - last < ROLE_REFRESH_MS) return token;

      try {
        const fresh = await db.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, isActive: true, campaignScope: true, orgId: true },
        });
        /* Null destroys the session, which is what a deleted or deactivated
           user should get. Only reached when the query actually answered -- a
           database blip lands in the catch below and leaves the token alone,
           because signing the whole workspace out over a dropped connection is
           the worse failure. */
        if (!fresh || fresh.isActive === false) return null;
        token.role = fresh.role;
        token.orgId = fresh.orgId;
        token.campaignScope = fresh.campaignScope;
        (token as any).checkedAt = Date.now();
      } catch {
        /* Keep the token as it stands. */
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (token) {
        session.user.id = token.id as string;
        (session.user as any).orgId = token.orgId;
        (session.user as any).role = token.role;
        (session.user as any).campaignScope = token.campaignScope;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
});

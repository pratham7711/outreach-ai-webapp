import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { CredentialsSignin } from "next-auth";
import { loginBlockedForUnverified } from "@/lib/emailVerification";
import { accessFor, isPlatformAdmin } from "@/lib/billing/subscription";
import { authConfig } from "@/lib/auth.config";

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

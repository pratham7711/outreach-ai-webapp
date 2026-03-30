import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "creator_portal_token";
const TOKEN_EXPIRY_DAYS = 30;

export type CreatorSession = {
  id: string;
  creatorUserId: string;
  email: string;
  name: string;
  handle: string;
};

/** Hash a password with bcrypt */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/** Verify a password against a hash */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Generate a secure random token */
function generateToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

/** Create a new session for a creator user and set the cookie */
export async function createCreatorSession(creatorUserId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS);

  await db.creatorSession.create({
    data: { creatorUserId, token, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

/** Get the current creator session from the cookie, or null */
export async function getCreatorSession(): Promise<CreatorSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await db.creatorSession.findUnique({
    where: { token },
    include: { creatorUser: { select: { id: true, email: true, name: true, handle: true } } },
  });

  if (!session || session.expiresAt < new Date()) {
    // Expired — clean up
    if (session) await db.creatorSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return {
    id: session.id,
    creatorUserId: session.creatorUser.id,
    email: session.creatorUser.email,
    name: session.creatorUser.name,
    handle: session.creatorUser.handle,
  };
}

/** Destroy the current creator session */
export async function destroyCreatorSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await db.creatorSession.deleteMany({ where: { token } }).catch(() => {});
    cookieStore.delete(COOKIE_NAME);
  }
}

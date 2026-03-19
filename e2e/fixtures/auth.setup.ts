import { test as setup } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.join(__dirname, '.auth.json');

setup('authenticate as admin', async () => {
  // Generate a valid NextAuth JWT directly using encode from next-auth/jwt.
  // This bypasses the DB-dependent login flow (Supabase may be paused on free tier).
  const { encode } = await import('next-auth/jwt');

  const secret = process.env.NEXTAUTH_SECRET ?? '4Ngtr3WB/HGm9bJ2K8GkcuWjAIt8sQB6zpt60AL2lFU=';
  const cookieName = 'authjs.session-token';

  const token = await encode({
    token: {
      sub: 'cltest000000000000000001',
      id: 'cltest000000000000000001',
      email: 'admin@demo.com',
      name: 'Admin User',
      orgId: 'cltest000000000000000002',
      role: 'ADMIN',
    },
    secret,
    salt: cookieName,
  });

  const authData = {
    cookies: [
      {
        name: cookieName,
        value: token,
        domain: 'localhost',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };

  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, JSON.stringify(authData, null, 2));
});

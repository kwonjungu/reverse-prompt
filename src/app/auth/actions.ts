'use server';

import { cookies } from 'next/headers';

const ENCODED = 'NDMyMQ==';

export async function verifyPassword(password: string): Promise<boolean> {
  const expected = Buffer.from(ENCODED, 'base64').toString('utf8');
  if (password !== expected) return false;

  const cookieStore = await cookies();
  cookieStore.set('pgauth', 'ok', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return true;
}

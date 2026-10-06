import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { writeClient } from '@/lib/sanity';
import { logSanityInteraction } from '@/lib/sanityLogger';

interface AppUser {
  _id: string;
  name: string;
  email: string;
  password?: string;
  role: string;
  isActive: boolean;
  associatedSite?: { _id: string; name: string };
}

const isBcryptHash = (str?: string) =>
  typeof str === 'string' &&
  (str.startsWith('$2a$') || str.startsWith('$2b$') || str.startsWith('$2y$')) &&
  str.length > 50;

const fetchUserByEmail = async (email: string): Promise<AppUser | null> => {
  const query = `*[_type == "AppUser" && email == $email][0] {
    _id,
    name,
    email,
    password,
    role,
    isActive,
    associatedSite->{_id, name}
  }`;
  return await writeClient.fetch(query, { email });
};

const updateUserPassword = async (userId: string, newPassword: string) => {
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await writeClient.patch(userId).set({ password: hashedPassword }).commit();
  return hashedPassword;
};

const generateAuthToken = (user: AppUser) => {
  const tokenData = JSON.stringify({
    userId: user._id,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 hours
  });

  return Buffer.from(tokenData)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    logger.debug('Login attempt for email:', email);

    if (!email || !password) {
      return NextResponse.json({ message: 'Email and password are required.' }, { status: 400 });
    }

    const user = await fetchUserByEmail(email);
    logger.debug('User fetched from Sanity:', user);

    if (!user) {
      return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    if (!user.isActive) {
      return NextResponse.json(
        { message: 'Account is inactive. Please contact administrator.' },
        { status: 401 }
      );
    }

    let passwordMatch = false;
    let needsPasswordUpdate = false;

    if (!user.password) {
      // New user, set password
      await updateUserPassword(user._id, password);
      passwordMatch = true;
      needsPasswordUpdate = true;
    } else if (isBcryptHash(user.password)) {
      passwordMatch = await bcrypt.compare(password, user.password);
    } else if (password === user.password) {
      // Legacy plaintext password
      await updateUserPassword(user._id, password);
      passwordMatch = true;
      needsPasswordUpdate = true;
    }

    logger.debug('Password match:', passwordMatch, 'Needs update:', needsPasswordUpdate);

    if (!passwordMatch) {
      await logSanityInteraction('login', 'Failed login attempt', 'AppUser', user._id, user.email, false, {
        errorDetails: 'Invalid password',
      });
      return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    await logSanityInteraction(
      'login',
      needsPasswordUpdate ? 'User logged in and password migrated' : 'User logged in successfully',
      'AppUser',
      user._id,
      user.email,
      true,
      { payload: { passwordMigrated: needsPasswordUpdate } }
    );

    const response = NextResponse.json({
      message: 'Login successful.',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        associatedSite: user.associatedSite,
      },
    });

    // Set auth_token cookie
    response.cookies.set('auth_token', generateAuthToken(user), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    // Set user_role cookie
    response.cookies.set('user_role', user.role, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ message: 'Internal server error.' }, { status: 500 });
  }
}
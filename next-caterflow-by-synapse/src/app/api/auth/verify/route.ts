import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { writeClient } from '@/lib/sanity';

export async function GET(request: Request) {
    logger.debug('=== VERIFY API CALL STARTED ===');

    try {
        // Read the cookies directly from the request headers
        const cookies = request.headers.get('cookie');
        logger.debug('Cookies received:', cookies);

        if (!cookies) {
            logger.debug('No cookies found in request');
            return NextResponse.json({ message: 'Unauthorized: No cookies found' }, { status: 401 });
        }

        // Parse cookies more reliably
        const cookieObject: Record<string, string> = {};
        cookies.split(';').forEach(cookie => {
            const [name, ...value] = cookie.trim().split('=');
            cookieObject[name] = decodeURIComponent(value.join('=')); // Decode URL-encoded values
        });

        logger.debug('Parsed and decoded cookies:', cookieObject);

        const token = cookieObject['auth_token'];
        const userRoleFromCookie = cookieObject['user_role'];

        if (!token || !userRoleFromCookie) {
            logger.debug('Missing auth_token or user_role cookie:', {
                hasAuthToken: !!token,
                hasUserRole: !!userRoleFromCookie
            });
            return NextResponse.json({ message: 'Unauthorized: Missing auth_token or user_role cookie' }, { status: 401 });
        }

        logger.debug('Token found:', token.substring(0, 20) + '...');
        logger.debug('User role from cookie:', userRoleFromCookie);

        try {
            // Handle URL-safe base64 encoding
            let tokenWithoutPadding = token.replace(/-/g, '+').replace(/_/g, '/');
            logger.debug('Token after URL-safe replacement:', tokenWithoutPadding.substring(0, 20) + '...');

            // Add padding if necessary
            const pad = tokenWithoutPadding.length % 4;
            if (pad) {
                tokenWithoutPadding += '='.repeat(4 - pad);
                logger.debug('Added padding to token:', tokenWithoutPadding.substring(0, 20) + '...');
            }

            logger.debug('Attempting to decode base64 token');
            const decodedString = Buffer.from(tokenWithoutPadding, 'base64').toString();
            logger.debug('Base64 decoded string:', decodedString);

            logger.debug('Attempting to parse JSON from decoded string');
            const decoded = JSON.parse(decodedString);
            logger.debug('Parsed token data:', decoded);

            // Check if token is expired
            if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
                logger.debug('Token expired:', {
                    tokenExp: decoded.exp,
                    currentTime: Math.floor(Date.now() / 1000)
                });
                return NextResponse.json({ message: 'Token expired' }, { status: 401 });
            }

            logger.debug('Token is valid, fetching user data from Sanity for userId:', decoded.userId);

            // Fetch fresh user data from Sanity
            const userQuery = `*[_type == "AppUser" && _id == $userId][0] {
                _id,
                name,
                email,
                role,
                isActive,
                associatedSite->{_id, name}
            }`;

            const user = await writeClient.fetch(userQuery, { userId: decoded.userId });
            logger.debug('User fetched from Sanity:', user);

            if (!user || !user.isActive) {
                logger.debug('User not found or inactive:', { userExists: !!user, userIsActive: user?.isActive });
                return NextResponse.json({ message: 'User not found or inactive' }, { status: 401 });
            }

            // Validate that the user role from the cookie matches the fetched user role
            if (user.role !== userRoleFromCookie) {
                logger.debug('User role mismatch:', {
                    cookieRole: userRoleFromCookie,
                    dbRole: user.role
                });
                return NextResponse.json({ message: 'Unauthorized: User role mismatch' }, { status: 401 });
            }

            logger.debug('User verification successful, returning user data');
            return NextResponse.json({
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                associatedSite: user.associatedSite
            });

        } catch (error) {
            console.error('Token decoding/verification error:', error);
            return NextResponse.json({ message: 'Invalid token' }, { status: 401 });
        }
    } catch (error) {
        console.error('Token verification error:', error);
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    } finally {
        logger.debug('=== VERIFY API CALL COMPLETED ===');
    }
}
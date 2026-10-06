import { cachedLookup } from '@/lib/lookupCache';
import { withInvalidation } from '@/lib/lookupCache';
import { NextRequest, NextResponse } from 'next/server';
import { writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { logSanityInteraction } from '@/lib/sanityLogger';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserSiteInfo } from '@/lib/siteFiltering';

interface SiteData {
    _id?: string;
    name: string;
    location: string;
    manager?: string;
    contactNumber?: string;
    email?: string;
    patientCount?: number;
}

// GET all sites with site-based filtering
export async function GET() {
    try {
        const userSiteInfo = await getUserSiteInfo();

        let query;
        let params = {};

        if (userSiteInfo.canAccessMultipleSites) {
            // Admin, auditor, procurer can see all sites
            query = groq`*[_type == "Site"] | order(name asc) {
                _id,
                name,
                location,
                manager->{_id, name},
                contactNumber,
                email,
                patientCount,
                "binCount": count(*[_type == "Bin" && site._ref == ^._id])
            }`;
        } else if (userSiteInfo.userSiteId) {
            // Site-specific users can only see their assigned site
            query = groq`*[_type == "Site" && _id == $siteId] | order(name asc) {
                _id,
                name,
                location,
                manager->{_id, name},
                contactNumber,
                email,
                patientCount,
                "binCount": count(*[_type == "Bin" && site._ref == ^._id])
            }`;
            params = { siteId: userSiteInfo.userSiteId };
        } else {
            // Users with no site association get empty results
            return NextResponse.json([]);
        }

        const sites = await cachedLookup(
            'sites',
            [userSiteInfo.canAccessMultipleSites ? 'all' : userSiteInfo.userSiteId],
            () => writeClient.fetch(query, params),
            60,
        );
        return NextResponse.json(sites);
    } catch (error) {
        console.error('Error fetching sites:', error);
        return NextResponse.json(
            { error: 'Failed to fetch sites' },
            { status: 500 }
        );
    }
}

// CREATE a new site
async function _POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only admin can create sites
        if (session.user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Insufficient permissions to create sites' },
                { status: 403 }
            );
        }

        const siteData: SiteData = await req.json();

        // Validate required fields
        if (!siteData.name || !siteData.location) {
            return NextResponse.json(
                { error: 'Name and location are required' },
                { status: 400 }
            );
        }

        // Check if site already exists
        const existingSite = await writeClient.fetch(
            groq`*[_type == "Site" && name == $name][0]`,
            { name: siteData.name }
        );

        if (existingSite) {
            return NextResponse.json(
                { error: 'Site with this name already exists' },
                { status: 409 }
            );
        }

        // Create site document
        const newSite = {
            _type: 'Site',
            name: siteData.name,
            location: siteData.location,
            manager: siteData.manager ? {
                _type: 'reference',
                _ref: siteData.manager
            } : undefined,
            contactNumber: siteData.contactNumber || undefined,
            email: siteData.email || undefined,
            patientCount: siteData.patientCount || undefined
        };

        const result = await writeClient.create(newSite);

        // Log the action
        await logSanityInteraction(
            'site_management',
            'Site created',
            'Site',
            result._id,
            siteData.name,
            true
        );

        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        console.error('Error creating site:', error);
        return NextResponse.json(
            { error: 'Failed to create site' },
            { status: 500 }
        );
    }
}

// UPDATE a site
async function _PATCH(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const siteData: SiteData = await req.json();
        const userSiteInfo = await getUserSiteInfo(req);

        if (!siteData._id) {
            return NextResponse.json(
                { error: 'Site ID is required' },
                { status: 400 }
            );
        }

        // Check if site exists
        const existingSite = await writeClient.fetch(
            groq`*[_type == "Site" && _id == $id][0] {
                _id,
                name
            }`,
            { id: siteData._id }
        );

        if (!existingSite) {
            return NextResponse.json(
                { error: 'Site not found' },
                { status: 404 }
            );
        }

        // Check permissions: only admin or site manager of this site can update
        const canUpdate = session.user.role === 'admin' ||
            (session.user.role === 'siteManager' && siteData._id === userSiteInfo.userSiteId);

        if (!canUpdate) {
            return NextResponse.json(
                { error: 'Insufficient permissions to update this site' },
                { status: 403 }
            );
        }

        // Check if name is already used by another site
        if (siteData.name && siteData.name !== existingSite.name) {
            const siteWithName = await writeClient.fetch(
                groq`*[_type == "Site" && name == $name && _id != $id][0]`,
                { name: siteData.name, id: siteData._id }
            );

            if (siteWithName) {
                return NextResponse.json(
                    { error: 'Site name already in use by another site' },
                    { status: 409 }
                );
            }
        }

        // Prepare update data
        const updateData: any = {
            name: siteData.name,
            location: siteData.location,
            contactNumber: siteData.contactNumber || null,
            email: siteData.email || null,
            patientCount: siteData.patientCount || null
        };

        // Only admin can change manager
        if (siteData.manager && session.user.role === 'admin') {
            updateData.manager = {
                _type: 'reference',
                _ref: siteData.manager
            };
        } else if (siteData.manager === null && session.user.role === 'admin') {
            updateData.manager = null;
        }

        // Update site
        const result = await writeClient
            .patch(siteData._id)
            .set(updateData)
            .commit();

        // Log the action
        await logSanityInteraction(
            'site_management',
            'Site updated',
            'Site',
            siteData._id,
            siteData.name,
            true
        );

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error updating site:', error);
        return NextResponse.json(
            { error: 'Failed to update site' },
            { status: 500 }
        );
    }
}

// DELETE a site
async function _DELETE(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only admin can delete sites
        if (session.user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Insufficient permissions to delete sites' },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json(
                { error: 'Site ID is required' },
                { status: 400 }
            );
        }

        // Check if site exists
        const existingSite = await writeClient.fetch(
            groq`*[_type == "Site" && _id == $id][0]`,
            { id }
        );

        if (!existingSite) {
            return NextResponse.json(
                { error: 'Site not found' },
                { status: 404 }
            );
        }

        // Check if site has any bins
        const binCount = await writeClient.fetch(
            groq`count(*[_type == "Bin" && site._ref == $siteId])`,
            { siteId: id }
        );

        if (binCount > 0) {
            return NextResponse.json(
                { error: 'Cannot delete site that has bins. Please delete or reassign bins first.' },
                { status: 409 }
            );
        }

        // Delete site
        await writeClient.delete(id);

        // Log the action
        await logSanityInteraction(
            'site_management',
            'Site deleted',
            'Site',
            id,
            existingSite.name,
            true
        );

        return NextResponse.json({ message: 'Site deleted successfully' });
    } catch (error) {
        console.error('Error deleting site:', error);
        return NextResponse.json(
            { error: 'Failed to delete site' },
            { status: 500 }
        );
    }
}

export const POST = withInvalidation(_POST, ['sites', 'bins', 'locations', 'dispatch-types']);
export const PATCH = withInvalidation(_PATCH, ['sites', 'bins', 'locations', 'dispatch-types']);
export const DELETE = withInvalidation(_DELETE, ['sites', 'bins', 'locations', 'dispatch-types']);

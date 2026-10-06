import { cachedLookup } from '@/lib/lookupCache';
import { withInvalidation } from '@/lib/lookupCache';
import { NextRequest, NextResponse } from "next/server";
import { writeClient } from "@/lib/sanity";
import { groq } from "next-sanity";
import { logSanityInteraction } from "@/lib/sanityLogger";
import { getUserSiteInfo, buildSiteFilter } from "@/lib/siteFiltering";
import { createSafeDeleteHandler } from "@/lib/deleteWithBackupSafety";

interface BinData {
  _id?: string;
  name: string;
  binType: string;
  locationDescription?: string;
  site: string;
}

// The DELETE handler below calls createSafeDeleteHandler(), which can call
// enforceBackupBeforeDelete() -> a full synchronous archive run when no
// recent backup exists. Extend the timeout so that doesn't hit Vercel's
// default function duration limit. (Applies to all methods in this file,
// which is harmless for GET/PUT.)
export const maxDuration = 300;

// Roles that are permitted to view bins from all sites in the transfer context.
const CROSS_SITE_ROLES = ["admin", "auditor", "procurer", "site-manager"];

// GET all bins
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");
    // allowAll=true → bypass site filter (transfer cross-site visibility)
    const allowAll = searchParams.get("allowAll") === "true";

    // Get user site info for filtering
    const userSiteInfo = await getUserSiteInfo(req);

    // Server-side gate: only permitted roles may bypass the site filter.
    if (allowAll && !CROSS_SITE_ROLES.includes(userSiteInfo.userRole)) {
      return NextResponse.json(
        { error: "Access denied: insufficient role to view all-site bins" },
        { status: 403 },
      );
    }

    // Skip site filter entirely when allowAll is granted
    const baseSiteFilter = allowAll ? "" : buildSiteFilter(userSiteInfo);

    let query;
    let params = {};

    if (siteId && !allowAll) {
      // If specific site ID is requested, check if user has access to it
      if (
        !userSiteInfo.canAccessMultipleSites &&
        siteId !== userSiteInfo.userSiteId
      ) {
        return NextResponse.json(
          { error: "Access denied to requested site" },
          { status: 403 },
        );
      }
      query = groq`*[_type == "Bin" && site._ref == $siteId ${baseSiteFilter}] | order(site->name asc, name asc) {
                _id,
                name,
                binType,
                locationDescription,
                site->{_id, name}
            }`;
      params = { siteId };
    } else {
      query = groq`*[_type == "Bin" ${baseSiteFilter}] | order(site->name asc, name asc) {
                _id,
                name,
                binType,
                locationDescription,
                site->{_id, name}
            }`;
    }

    const bins = await cachedLookup(
      'bins',
      [siteId, allowAll ? 'all' : 'scoped', baseSiteFilter],
      () => writeClient.fetch(query, params),
      60,
    );
    return NextResponse.json(bins);
  } catch (error) {
    console.error("Error fetching bins:", error);
    return NextResponse.json(
      { error: "Failed to fetch bins" },
      { status: 500 },
    );
  }
}

// CREATE a new bin
async function _POST(req: NextRequest) {
  try {
    const binData: BinData = await req.json();
    const userSiteInfo = await getUserSiteInfo(req);

    // Validate required fields
    if (!binData.name || !binData.binType || !binData.site) {
      return NextResponse.json(
        { error: "Name, type, and site are required" },
        { status: 400 },
      );
    }

    // Check if user has permission to create bin for this site
    if (
      !userSiteInfo.canAccessMultipleSites &&
      binData.site !== userSiteInfo.userSiteId
    ) {
      return NextResponse.json(
        { error: "Access denied to create bin for this site" },
        { status: 403 },
      );
    }

    // Check if bin already exists
    const existingBin = await writeClient.fetch(
      groq`*[_type == "Bin" && name == $name && site._ref == $siteId][0]`,
      { name: binData.name, siteId: binData.site },
    );

    if (existingBin) {
      return NextResponse.json(
        { error: "Bin with this name already exists at this site" },
        { status: 409 },
      );
    }

    // Create bin document
    const newBin = {
      _type: "Bin",
      name: binData.name,
      binType: binData.binType,
      locationDescription: binData.locationDescription || undefined,
      site: {
        _type: "reference",
        _ref: binData.site,
      },
    };

    const result = await writeClient.create(newBin);

    // Log the action
    await logSanityInteraction(
      "bin_management",
      "Bin created",
      "Bin",
      result._id,
      binData.name,
      true,
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error creating bin:", error);
    return NextResponse.json(
      { error: "Failed to create bin" },
      { status: 500 },
    );
  }
}

// UPDATE a bin
async function _PATCH(req: NextRequest) {
  try {
    const binData: BinData = await req.json();
    const userSiteInfo = await getUserSiteInfo(req);

    if (!binData._id) {
      return NextResponse.json(
        { error: "Bin ID is required" },
        { status: 400 },
      );
    }

    // Check if bin exists and user has access
    const existingBin = await writeClient.fetch(
      groq`*[_type == "Bin" && _id == $id][0] {
                _id,
                name,
                site->_id
            }`,
      { id: binData._id },
    );

    if (!existingBin) {
      return NextResponse.json({ error: "Bin not found" }, { status: 404 });
    }

    // Check if user has permission to update this bin
    if (
      !userSiteInfo.canAccessMultipleSites &&
      existingBin.site._id !== userSiteInfo.userSiteId
    ) {
      return NextResponse.json(
        { error: "Access denied to update this bin" },
        { status: 403 },
      );
    }

    // Check if name is already used by another bin at the same site
    if (binData.name && binData.name !== existingBin.name) {
      const binWithName = await writeClient.fetch(
        groq`*[_type == "Bin" && name == $name && site._ref == $siteId && _id != $id][0]`,
        { name: binData.name, siteId: binData.site, id: binData._id },
      );

      if (binWithName) {
        return NextResponse.json(
          { error: "Bin name already in use at this site" },
          { status: 409 },
        );
      }
    }

    // Prepare update data
    const updateData: any = {
      name: binData.name,
      binType: binData.binType,
      locationDescription: binData.locationDescription || null,
    };

    // Handle site reference - check permission if changing site
    if (binData.site && binData.site !== existingBin.site._id) {
      if (!userSiteInfo.canAccessMultipleSites) {
        return NextResponse.json(
          { error: "Access denied to move bin to different site" },
          { status: 403 },
        );
      }
      updateData.site = {
        _type: "reference",
        _ref: binData.site,
      };
    }

    // Update bin
    const result = await writeClient
      .patch(binData._id)
      .set(updateData)
      .commit();

    // Log the action
    await logSanityInteraction(
      "bin_management",
      "Bin updated",
      "Bin",
      binData._id,
      binData.name,
      true,
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error updating bin:", error);
    return NextResponse.json(
      { error: "Failed to update bin" },
      { status: 500 },
    );
  }
}

// DELETE a bin
async function _DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const userSiteInfo = await getUserSiteInfo(req);

    if (!id) {
      return NextResponse.json(
        { error: "Bin ID is required" },
        { status: 400 },
      );
    }

    // Check if bin exists and user has access
    const existingBin = await writeClient.fetch(
      groq`*[_type == "Bin" && _id == $id][0] {
                _id,
                name,
                site->_id
            }`,
      { id },
    );

    if (!existingBin) {
      return NextResponse.json({ error: "Bin not found" }, { status: 404 });
    }

    // Check if user has permission to delete this bin
    if (
      !userSiteInfo.canAccessMultipleSites &&
      existingBin.site._id !== userSiteInfo.userSiteId
    ) {
      return NextResponse.json(
        { error: "Access denied to delete this bin" },
        { status: 403 },
      );
    }

    // Perform safe delete (enforces backup checks and may auto-trigger archive)
    const safeDelete = createSafeDeleteHandler(async (ids: string[]) => {
      for (const did of ids) {
        await writeClient.delete(did);
      }
    }, "Bin");

    try {
      const result = await safeDelete([id], "bin deletion");

      // Log the action only when deletion succeeded
      await logSanityInteraction(
        "bin_management",
        "Bin deleted",
        "Bin",
        id,
        existingBin.name,
        true,
      );

      return NextResponse.json(result);
    } catch (err: any) {
      console.error("Delete blocked or failed:", err);
      return NextResponse.json(
        { error: err?.message || "Delete failed" },
        { status: err?.status || 500 },
      );
    }
  } catch (error) {
    console.error("Error deleting bin:", error);
    return NextResponse.json(
      { error: "Failed to delete bin" },
      { status: 500 },
    );
  }
}

export const POST = withInvalidation(_POST, ['bins', 'sites', 'locations']);
export const PATCH = withInvalidation(_PATCH, ['bins', 'sites', 'locations']);
export const DELETE = withInvalidation(_DELETE, ['bins', 'sites', 'locations']);

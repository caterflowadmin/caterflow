// src/app/api/attachments/route.ts
import { mergeById } from "@/lib/financialReport";
import { NextRequest, NextResponse } from "next/server";
import { client } from "@/lib/sanity";
import { groq } from "next-sanity";
import { getArchivedFileAttachments } from "@/lib/archiveQueries";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const relatedTo = searchParams.get("relatedTo");

    if (!relatedTo) {
      return NextResponse.json(
        { error: "relatedTo parameter is required" },
        { status: 400 },
      );
    }

    const query = groq`
            *[_type == "FileAttachment" && relatedTo._ref == $relatedTo && !isArchived] | order(uploadedAt desc) {
                _id,
                fileName,
                fileType,
                file {
                    asset -> {
                        url,
                        originalFilename,
                        size,
                        mimeType
                    }
                },
                uploadedBy -> {
                    _id,
                    name
                },
                uploadedAt,
                description
            }
        `;

    const attachments = await client.fetch(query, { relatedTo });

    let archivedAttachments: any[] = [];
    try {
      const raw = await getArchivedFileAttachments({ relatedToId: relatedTo });
      archivedAttachments = raw.map((attachment: any) => ({
        ...attachment,
        _id: attachment._sanityId || attachment._id?.toString(),
        _isArchived: true,
      }));
    } catch (mongoErr) {
      console.warn(
        "⚠️  Could not fetch archived attachments from MongoDB:",
        mongoErr,
      );
    }

    const merged = mergeById(attachments, archivedAttachments).sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );

    return NextResponse.json(merged);
  } catch (error) {
    console.error("Failed to fetch attachments:", error);
    return NextResponse.json(
      { error: "Failed to fetch attachments" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const relatedTo = searchParams.get("relatedTo");

    if (!id) {
      return NextResponse.json(
        { error: "Attachment ID is required" },
        { status: 400 },
      );
    }

    // Archive the attachment instead of deleting it
    await client.patch(id).set({ isArchived: true }).commit();

    // Remove the attachment reference from the related document
    if (relatedTo) {
      await client
        .patch(relatedTo)
        .unset([`attachments[_ref=="${id}"]`])
        .commit();
    }

    return NextResponse.json({
      success: true,
      message: "Attachment archived successfully",
    });
  } catch (error) {
    console.error("Failed to archive attachment:", error);
    return NextResponse.json(
      { error: "Failed to archive attachment" },
      { status: 500 },
    );
  }
}

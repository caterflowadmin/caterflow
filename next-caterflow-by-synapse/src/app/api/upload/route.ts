import { logger } from '@/lib/logger';
// src/app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { writeClient } from '@/lib/sanity';
import { getServerSession } from 'next-auth';
import { groq } from 'next-sanity';
import { authOptions } from '@/lib/auth';

// Maximum file size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed file types
const ALLOWED_FILE_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user) {
            logger.debug('User not authenticated');
            return NextResponse.json(
                { error: 'User not authenticated' },
                { status: 401 }
            );
        }

        // Get the user's ID from Sanity based on their email
        const userQuery = groq`*[_type == "AppUser" && email == $email][0] {
            _id
        }`;

        const user = await writeClient.fetch(userQuery, {
            email: session.user.email
        });

        if (!user) {
            logger.debug('User not found in database for email:', session.user.email);
            return NextResponse.json(
                { error: 'User not found in database' },
                { status: 404 }
            );
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const relatedToId = formData.get('relatedTo');
        const fileType = formData.get('fileType');
        const description = formData.get('description');

        // Invoice-specific fields
        const invoiceNumber = formData.get('invoiceNumber');
        const invoiceDate = formData.get('invoiceDate');
        const invoiceAmount = formData.get('invoiceAmount');
        const supplier = formData.get('supplier');

        // **Log the received form data**
        logger.debug('--- Server-side Received Data ---');
        logger.debug('Received File:', file ? file.name : 'No file received');
        logger.debug('Received Related To ID:', relatedToId);
        logger.debug('Received File Type:', fileType);
        logger.debug('Received Description:', description);
        logger.debug('Invoice Number:', invoiceNumber);
        logger.debug('Invoice Date:', invoiceDate);
        logger.debug('Invoice Amount:', invoiceAmount);
        logger.debug('Supplier:', supplier);
        logger.debug('---------------------------------');

        if (!file || !relatedToId) {
            logger.debug('Missing file or related document ID');
            return NextResponse.json(
                { error: 'File and related document ID are required' },
                { status: 400 }
            );
        }

        if (file.size > MAX_FILE_SIZE) {
            logger.debug(`File size too large: ${file.size}`);
            return NextResponse.json(
                { error: `File size exceeds the limit of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
                { status: 400 }
            );
        }

        if (!ALLOWED_FILE_TYPES.includes(file.type)) {
            logger.debug(`Unsupported file type: ${file.type}`);
            return NextResponse.json(
                { error: 'Unsupported file type' },
                { status: 400 }
            );
        }

        // Validate invoice-specific fields if fileType is 'invoice'
        if (fileType === 'invoice') {
            if (!invoiceNumber || typeof invoiceNumber !== 'string' || !invoiceNumber.trim()) {
                return NextResponse.json(
                    { error: 'Invoice number is required for invoice tracking' },
                    { status: 400 }
                );
            }
            if (!invoiceDate || typeof invoiceDate !== 'string' || !invoiceDate.trim()) {
                return NextResponse.json(
                    { error: 'Invoice date is required for invoice tracking' },
                    { status: 400 }
                );
            }
        }

        // Upload file to Sanity
        logger.debug('Uploading file to Sanity...');
        const fileAsset = await writeClient.assets.upload('file', file, {
            filename: file.name,
            contentType: file.type,
        });
        logger.debug('Sanity asset upload successful:', fileAsset._id);

        // Build description with invoice metadata
        let finalDescription = description as string || '';

        if (fileType === 'invoice') {
            const invoiceMetadata = {
                isInvoice: true,
                invoiceNumber: invoiceNumber,
                invoiceDate: invoiceDate,
                invoiceAmount: invoiceAmount ? parseFloat(invoiceAmount as string) : 0,
                supplier: supplier,
                // Add the original description if it exists
                userDescription: description || ''
            };

            // Store as JSON string in the description field
            finalDescription = JSON.stringify(invoiceMetadata);
        }

        // Create a new FileAttachment document
        logger.debug('Creating new FileAttachment document...');
        const newAttachment = await writeClient.create({
            _type: 'FileAttachment',
            fileName: file.name,
            fileType: fileType,
            file: {
                _type: 'file',
                asset: {
                    _type: 'reference',
                    _ref: fileAsset._id,
                },
            },
            uploadedBy: {
                _type: 'reference',
                _ref: user._id,
            },
            uploadedAt: new Date().toISOString(),
            description: finalDescription,
            relatedTo: {
                _type: 'reference',
                _ref: relatedToId,
            },
            isArchived: false,
        });
        logger.debug('FileAttachment document created:', newAttachment._id);

        // Link the attachment to the related document
        logger.debug(`Patching document ${relatedToId} to add attachment reference...`);
        await writeClient
            .patch(relatedToId.toString())
            .setIfMissing({ attachments: [] })
            .insert('after', 'attachments[-1]', [
                {
                    _key: newAttachment._id,
                    _ref: newAttachment._id,
                    _type: 'reference',
                },
            ])
            .commit();
        logger.debug('Patch operation successful.');

        return NextResponse.json({
            success: true,
            message: 'File uploaded successfully',
            attachment: newAttachment,
        });
    } catch (error: any) {
        console.error('File upload error:', error);
        return NextResponse.json(
            { error: 'Failed to upload file', details: error.message },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user) {
            return NextResponse.json(
                { error: 'User not authenticated' },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        const relatedTo = searchParams.get('relatedTo');

        if (!id) {
            return NextResponse.json(
                { error: 'Attachment ID is required' },
                { status: 400 }
            );
        }

        // Delete the attachment reference from the related document
        if (relatedTo) {
            await writeClient
                .patch(relatedTo)
                .unset([`attachments[_ref=="${id}"]`])
                .commit();
        }

        // Delete the attachment document
        await writeClient.delete(id);

        return NextResponse.json({
            success: true,
            message: 'Attachment deleted successfully'
        });
    } catch (error: any) {
        console.error('File deletion error:', error);
        return NextResponse.json(
            { error: 'Failed to delete attachment', details: error.message },
            { status: 500 }
        );
    }
}
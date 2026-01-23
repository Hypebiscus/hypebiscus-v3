// src/app/api/conversations/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { globalRateLimiter, getClientIP } from '@/lib/utils/rateLimiter';
import {
  validateConversationUpdate,
  validateWalletAddressParam,
  ValidationError,
} from '@/lib/utils/validation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/conversations/[id] - Get a conversation with messages
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Rate limiting
    const clientIP = getClientIP(request);
    if (!globalRateLimiter.isAllowed(`conversation:get:${clientIP}`)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', message: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Get wallet address from query params for authorization
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('walletAddress');
    const validatedWalletAddress = validateWalletAddressParam(walletAddress);

    // Fetch conversation with messages
    const conversation = await prisma.conversations.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            poolData: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Not found', message: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Check ownership
    if (conversation.walletAddress !== validatedWalletAddress) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You do not have access to this conversation' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      data: {
        id: conversation.id,
        walletAddress: conversation.walletAddress,
        title: conversation.title,
        isTitleGenerated: conversation.isTitleGenerated,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages,
      },
      success: true,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: 'Validation error', message: error.message, field: error.field },
        { status: 400 }
      );
    }

    console.error('Error fetching conversation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/conversations/[id] - Update conversation title
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Rate limiting
    const clientIP = getClientIP(request);
    if (!globalRateLimiter.isAllowed(`conversation:patch:${clientIP}`)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', message: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Get wallet address from query params for authorization
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('walletAddress');
    const validatedWalletAddress = validateWalletAddressParam(walletAddress);

    // Check conversation exists and ownership
    const existingConversation = await prisma.conversations.findUnique({
      where: { id },
      select: { walletAddress: true },
    });

    if (!existingConversation) {
      return NextResponse.json(
        { error: 'Not found', message: 'Conversation not found' },
        { status: 404 }
      );
    }

    if (existingConversation.walletAddress !== validatedWalletAddress) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You do not have access to this conversation' },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const { title } = validateConversationUpdate(body);

    // Update conversation
    const conversation = await prisma.conversations.update({
      where: { id },
      data: {
        title,
        isTitleGenerated: true,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      data: {
        id: conversation.id,
        walletAddress: conversation.walletAddress,
        title: conversation.title,
        isTitleGenerated: conversation.isTitleGenerated,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      success: true,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: 'Validation error', message: error.message, field: error.field },
        { status: 400 }
      );
    }

    console.error('Error updating conversation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/conversations/[id] - Delete a conversation
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Rate limiting
    const clientIP = getClientIP(request);
    if (!globalRateLimiter.isAllowed(`conversation:delete:${clientIP}`)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', message: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Get wallet address from query params for authorization
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('walletAddress');
    const validatedWalletAddress = validateWalletAddressParam(walletAddress);

    // Check conversation exists and ownership
    const existingConversation = await prisma.conversations.findUnique({
      where: { id },
      select: { walletAddress: true },
    });

    if (!existingConversation) {
      return NextResponse.json(
        { error: 'Not found', message: 'Conversation not found' },
        { status: 404 }
      );
    }

    if (existingConversation.walletAddress !== validatedWalletAddress) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You do not have access to this conversation' },
        { status: 403 }
      );
    }

    // Delete conversation (messages will cascade delete)
    await prisma.conversations.delete({
      where: { id },
    });

    return NextResponse.json({
      data: { id },
      success: true,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: 'Validation error', message: error.message, field: error.field },
        { status: 400 }
      );
    }

    console.error('Error deleting conversation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

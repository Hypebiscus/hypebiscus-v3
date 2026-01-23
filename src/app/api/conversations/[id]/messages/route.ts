// src/app/api/conversations/[id]/messages/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { globalRateLimiter, getClientIP } from '@/lib/utils/rateLimiter';
import {
  validateMessageCreate,
  validateWalletAddressParam,
  ValidationError,
} from '@/lib/utils/validation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/conversations/[id]/messages - Add a message to a conversation
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: conversationId } = await params;

    // Rate limiting (more permissive for messages)
    const clientIP = getClientIP(request);
    if (!globalRateLimiter.isAllowed(`messages:post:${clientIP}`)) {
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
    const conversation = await prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { walletAddress: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Not found', message: 'Conversation not found' },
        { status: 404 }
      );
    }

    if (conversation.walletAddress !== validatedWalletAddress) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You do not have access to this conversation' },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const { role, content, poolData, metadata } = validateMessageCreate(body);

    // Create the message
    const message = await prisma.messages.create({
      data: {
        conversationId,
        role,
        content,
        poolData: poolData ? JSON.parse(JSON.stringify(poolData)) : undefined,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
        createdAt: new Date(),
      },
    });

    // Update conversation's updatedAt timestamp
    await prisma.conversations.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json(
      {
        data: {
          id: message.id,
          conversationId: message.conversationId,
          role: message.role,
          content: message.content,
          poolData: message.poolData,
          metadata: message.metadata,
          createdAt: message.createdAt,
        },
        success: true,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: 'Validation error', message: error.message, field: error.field },
        { status: 400 }
      );
    }

    console.error('Error creating message:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/conversations/[id]/messages - List messages in a conversation (paginated)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: conversationId } = await params;

    // Rate limiting
    const clientIP = getClientIP(request);
    if (!globalRateLimiter.isAllowed(`messages:get:${clientIP}`)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', message: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Get wallet address from query params for authorization
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('walletAddress');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const validatedWalletAddress = validateWalletAddressParam(walletAddress);

    // Check conversation exists and ownership
    const conversation = await prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { walletAddress: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Not found', message: 'Conversation not found' },
        { status: 404 }
      );
    }

    if (conversation.walletAddress !== validatedWalletAddress) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You do not have access to this conversation' },
        { status: 403 }
      );
    }

    // Fetch messages
    const messages = await prisma.messages.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        role: true,
        content: true,
        poolData: true,
        metadata: true,
        createdAt: true,
      },
    });

    // Get total count for pagination
    const total = await prisma.messages.count({
      where: { conversationId },
    });

    return NextResponse.json({
      data: messages,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + messages.length < total,
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

    console.error('Error listing messages:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

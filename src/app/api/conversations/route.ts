// src/app/api/conversations/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { globalRateLimiter, getClientIP } from '@/lib/utils/rateLimiter';
import {
  validateConversationCreate,
  validateWalletAddressParam,
  ValidationError,
} from '@/lib/utils/validation';

const MAX_CONVERSATIONS_PER_WALLET = 50;

/**
 * POST /api/conversations - Create a new conversation
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const clientIP = getClientIP(request);
    if (!globalRateLimiter.isAllowed(`conversations:post:${clientIP}`)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', message: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const { walletAddress, title } = validateConversationCreate(body);

    // Check conversation count limit per wallet
    const existingCount = await prisma.conversations.count({
      where: { walletAddress },
    });

    if (existingCount >= MAX_CONVERSATIONS_PER_WALLET) {
      // Delete the oldest conversation to make room
      const oldest = await prisma.conversations.findFirst({
        where: { walletAddress },
        orderBy: { updatedAt: 'asc' },
      });

      if (oldest) {
        await prisma.conversations.delete({
          where: { id: oldest.id },
        });
      }
    }

    // Create new conversation
    const conversation = await prisma.conversations.create({
      data: {
        walletAddress,
        title: title || 'New Chat',
        isTitleGenerated: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(
      {
        data: {
          id: conversation.id,
          walletAddress: conversation.walletAddress,
          title: conversation.title,
          isTitleGenerated: conversation.isTitleGenerated,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
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

    console.error('Error creating conversation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/conversations - List conversations for a wallet
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const clientIP = getClientIP(request);
    if (!globalRateLimiter.isAllowed(`conversations:get:${clientIP}`)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', message: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Get and validate wallet address from query params
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('walletAddress');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const validatedWalletAddress = validateWalletAddressParam(walletAddress);

    // Fetch conversations for the wallet
    const conversations = await prisma.conversations.findMany({
      where: { walletAddress: validatedWalletAddress },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        walletAddress: true,
        title: true,
        isTitleGenerated: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Get total count for pagination
    const total = await prisma.conversations.count({
      where: { walletAddress: validatedWalletAddress },
    });

    return NextResponse.json({
      data: conversations,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + conversations.length < total,
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

    console.error('Error listing conversations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

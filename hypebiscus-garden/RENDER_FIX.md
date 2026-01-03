# Hypebiscus Garden Service - Crash Fix Documentation

## Issue Summary

The hypebiscus-garden service on Render keeps crashing due to **unhandled TelegramError exceptions** when attempting to edit messages that haven't changed.

### Root Cause

**Error:** `TelegramError: 400: Bad Request: message is not modified`

This occurs when `ctx.editMessageText()` is called with identical content and keyboard markup. The error is thrown as an unhandled promise rejection, causing the Node.js process to exit with code 1, which triggers Render's automatic restart loop.

### Impact

- **Service crashes repeatedly** (multiple times per day)
- **User experience degradation** (bot becomes temporarily unavailable)
- **Unnecessary compute usage** (constant restarts)

## Evidence from Logs

```
TelegramError: 400: Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message
  error_code: 400,
  ...
ELIFECYCLE Command failed with exit code 1.
```

**Timestamps:** Dec 29 (13:57-14:00), Dec 31 (09:43-12:30)

## Solution Implemented

### 1. Created Safe Telegram Helper Utility

**File:** `/hypebiscus-garden/src/utils/telegramHelpers.ts`

This utility provides:
- `safeEditMessageText()` - Wraps `ctx.editMessageText()` with error handling
- Catches and ignores "message is not modified" errors (HTTP 400)
- Logs warnings instead of crashing
- Re-throws genuine errors for proper error handling

### 2. Updated Settings Handler

**File:** `/hypebiscus-garden/src/bot/handlers/settings.ts`

**Changes:**
- Imported `safeEditMessageText` utility
- Replaced 3 instances of `ctx.editMessageText()` with safe wrapper
- Removed unnecessary `lastMessageCache` logic
- Simplified error handling code

### 3. Files Modified

1. **Created:** `src/utils/telegramHelpers.ts` (new file)
2. **Modified:** `src/bot/handlers/settings.ts`

## Additional Recommendations

### CRITICAL: Apply Fix to All Files

The same unsafe pattern exists in **62+ locations** across the codebase:

**Files requiring updates:**
- `src/bot/bot-webhook.ts` (8 instances)
- `src/bot/bot.ts` (8 instances)
- `src/bot/handlers/position.ts` (30 instances)
- `src/bot/handlers/wallet.ts` (16 instances)
- `src/bot/handlers/monitoring.ts` (10 instances)

**Action Required:**
1. Import `safeEditMessageText` in each file
2. Replace all `ctx.editMessageText()` calls with `safeEditMessageText(ctx, ...)`
3. Optionally use `safeAnswerCallback()` for callback query responses

### Secondary Issues (Non-Critical)

These issues do NOT cause crashes but should be monitored:

1. **RPC Endpoint Failures**
   - Helius RPC returned 502 Bad Gateway on Dec 31
   - Already handled gracefully with error logs
   - Consider adding RPC failover/retry logic

2. **Position Errors**
   - "No liquidity to remove" errors
   - "Position account not found" errors
   - These are handled gracefully and don't crash the service

## Testing Checklist

Before deploying:

- [x] Created `telegramHelpers.ts` utility
- [x] Updated `settings.ts` handler
- [ ] Update remaining handlers (position, wallet, monitoring, bot)
- [ ] Test locally with button clicks that don't change state
- [ ] Deploy to Render staging (if available)
- [ ] Monitor logs for 24 hours after deployment
- [ ] Verify no more crash loops

## Deployment Instructions

### Option 1: Quick Fix (Settings Only)

This fixes the most common crash source:

```bash
cd /home/wanaqil/Code/node/work/startup/hypebiscus-v2/hypebiscus-garden
git add src/utils/telegramHelpers.ts
git add src/bot/handlers/settings.ts
git commit -m "fix: prevent crashes from Telegram 'message is not modified' errors in settings handler"
git push origin main
```

### Option 2: Complete Fix (Recommended)

Apply the safe wrapper to ALL 62+ instances across all files.

**Automated approach:**
```bash
# Use find-and-replace in your editor to replace:
# FROM: await ctx.editMessageText(
# TO: await safeEditMessageText(ctx,

# Then add the import at the top of each file:
# import { safeEditMessageText } from '../utils/telegramHelpers';
# (adjust path based on file location)
```

## Expected Results

After deploying:

- **Zero crashes** from "message is not modified" errors
- **Stable uptime** on Render (no restart loops)
- **Warning logs** instead of crashes when messages are identical
- **Improved user experience** (no bot downtime)

## Monitoring

After deployment, check Render logs for:

```bash
# Should see warnings instead of crashes:
⚠️ Message not modified (user 123456789), skipping update

# Should NOT see:
ELIFECYCLE Command failed with exit code 1
```

## Long-term Improvements

1. **Add retry logic** for RPC endpoint failures
2. **Implement message caching** to prevent duplicate API calls
3. **Add health check endpoint** for better monitoring
4. **Set up error tracking** (Sentry, LogRocket) for production
5. **Add unit tests** for Telegram helpers

---

**Created:** 2026-01-01
**Status:** Partial fix implemented (settings handler only)
**Priority:** HIGH - Apply to all handlers ASAP

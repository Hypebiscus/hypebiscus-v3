// Simple in-memory rate limiter for API endpoints
interface RateLimitEntry {
  count: number
  resetTime: number
}

class RateLimiter {
  private requests = new Map<string, RateLimitEntry>()
  private windowMs: number
  private maxRequests: number

  constructor(windowMs: number = 60000, maxRequests: number = 10) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
  }

  isAllowed(identifier: string): boolean {
    const now = Date.now()
    const entry = this.requests.get(identifier)

    if (!entry || now > entry.resetTime) {
      // First request or window has reset
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs
      })
      return true
    }

    if (entry.count >= this.maxRequests) {
      return false
    }

    // Increment count
    entry.count++
    return true
  }

  getRemainingTime(identifier: string): number {
    const entry = this.requests.get(identifier)
    if (!entry) return 0
    
    const now = Date.now()
    return Math.max(0, entry.resetTime - now)
  }

  // Clean up expired entries periodically
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetTime) {
        this.requests.delete(key)
      }
    }
  }
}

// Create rate limiter instances
export const chatRateLimiter = new RateLimiter(60000, 10) // 10 requests per minute
export const globalRateLimiter = new RateLimiter(60000, 100) // 100 requests per minute (increased for wallet page PnL fetching)

// Cleanup expired entries every 5 minutes
setInterval(() => {
  chatRateLimiter.cleanup()
  globalRateLimiter.cleanup()
}, 300000)

export function getClientIP(request: Request): string {
  // Try to get real IP from various headers
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')
  const cfConnectingIP = request.headers.get('cf-connecting-ip')
  
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  
  if (realIP) {
    return realIP
  }
  
  if (cfConnectingIP) {
    return cfConnectingIP
  }
  
  // Fallback to a default identifier
  return 'unknown'
}
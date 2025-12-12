import * as jose from 'jose'

export interface JwtPayload {
  sub?: string // subject (user id)
  exp?: number // expiration time
  iat?: number // issued at
  role?: string
  channels?: string[] // allowed channels (optional)
  [key: string]: unknown
}

export interface VerifyResult {
  valid: boolean
  payload?: JwtPayload
  error?: string
  errorCode?: string
}

export interface JwtVerifierOptions {
  secret: string
  algorithm?: string
  issuer?: string
  audience?: string
}

/**
 * JwtVerifier - Verifies JWT tokens for channel authentication
 */
export class JwtVerifier {
  private secret: Uint8Array
  private algorithm: string
  private issuer?: string
  private audience?: string

  constructor(options: JwtVerifierOptions) {
    this.secret = new TextEncoder().encode(options.secret)
    this.algorithm = options.algorithm ?? 'HS256'
    this.issuer = options.issuer
    this.audience = options.audience
  }

  /**
   * Verify a JWT token
   */
  async verify(token: string): Promise<VerifyResult> {
    try {
      const options: jose.JWTVerifyOptions = {}

      if (this.issuer) {
        options.issuer = this.issuer
      }
      if (this.audience) {
        options.audience = this.audience
      }

      const { payload } = await jose.jwtVerify(token, this.secret, options)

      return {
        valid: true,
        payload: payload as JwtPayload,
      }
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        return {
          valid: false,
          error: 'Token expired',
          errorCode: 'AUTH_TOKEN_EXPIRED',
        }
      }
      if (error instanceof jose.errors.JWTClaimValidationFailed) {
        return {
          valid: false,
          error: 'Token validation failed',
          errorCode: 'AUTH_CLAIM_INVALID',
        }
      }
      if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
        return {
          valid: false,
          error: 'Invalid signature',
          errorCode: 'AUTH_INVALID_SIGNATURE',
        }
      }

      return {
        valid: false,
        error: 'Invalid token',
        errorCode: 'AUTH_INVALID_TOKEN',
      }
    }
  }

  /**
   * Check if a user can access a specific channel
   */
  canAccessChannel(payload: JwtPayload, topic: string): boolean {
    // If no channels restriction, allow all
    if (!payload.channels || payload.channels.length === 0) {
      return true
    }

    // Check exact match or wildcard
    for (const pattern of payload.channels) {
      if (pattern === '*') {
        return true
      }
      if (pattern === topic) {
        return true
      }
      // Support prefix wildcard: "room:*" matches "room:123"
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1)
        if (topic.startsWith(prefix)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Generate a test token (for development only)
   */
  async generateTestToken(
    payload: Omit<JwtPayload, 'iat' | 'exp'>,
    expiresIn: string = '1h'
  ): Promise<string> {
    const jwt = new jose.SignJWT(payload as jose.JWTPayload)
      .setProtectedHeader({ alg: this.algorithm })
      .setIssuedAt()
      .setExpirationTime(expiresIn)

    if (this.issuer) {
      jwt.setIssuer(this.issuer)
    }
    if (this.audience) {
      jwt.setAudience(this.audience)
    }

    return jwt.sign(this.secret)
  }
}

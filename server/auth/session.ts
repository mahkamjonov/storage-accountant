// Imzolangan cookie sessiya (serverda holat saqlanmaydi). Provayderdan mustaqil.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  uid: string;
  /** Tugash vaqti, ms */
  exp: number;
}

export class SessionSigner {
  constructor(
    private readonly secret: string,
    readonly maxAgeMs = 1000 * 60 * 60 * 24 * 30,
  ) {}

  private sign(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  issue(uid: string, now = Date.now()): string {
    const payload: SessionPayload = { uid, exp: now + this.maxAgeMs };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${data}.${this.sign(data)}`;
  }

  verify(token: string | undefined, now = Date.now()): SessionPayload | null {
    if (!token) return null;
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = Buffer.from(this.sign(data));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as SessionPayload;
      return typeof payload.uid === 'string' && payload.exp > now ? payload : null;
    } catch {
      return null;
    }
  }
}

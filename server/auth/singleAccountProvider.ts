// MVP: bitta sotuvchi akkaunti, login va parol sozlamalardan (.env) olinadi.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthProvider, User } from './authProvider.ts';

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export class SingleAccountProvider implements AuthProvider {
  private readonly user: User;

  constructor(
    private readonly login: string,
    private readonly password: string,
    displayName = 'Sotuvchi',
  ) {
    this.user = { id: 'owner', login, displayName };
  }

  async authenticate(login: string, password: string): Promise<User | null> {
    const loginOk = safeEqual(login.trim().toLowerCase(), this.login.toLowerCase());
    const passwordOk = safeEqual(password, this.password);
    return loginOk && passwordOk ? this.user : null;
  }

  async getUser(id: string): Promise<User | null> {
    return id === this.user.id ? this.user : null;
  }
}

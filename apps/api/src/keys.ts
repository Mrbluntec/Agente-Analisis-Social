// Almacén de claves de Ollama. La clave se cifra con AES-256-GCM antes de tocar el disco
// y solo se descifra en memoria al llamar a Ollama. En producción la clave maestra vendrá
// de un servicio de claves; en desarrollo vive en un archivo local con permisos 0600.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type KeyScope = 'org' | 'user';

export interface KeyInfo {
  scope: KeyScope;
  last4: string;
  max_concurrency: number;
  validated_at: string | null;
  created_at: string;
}

interface StoredKey extends KeyInfo {
  /** iv (12) + etiqueta (16) + texto cifrado, en base64. */
  ciphertext: string;
}

type KeyFile = Partial<Record<KeyScope, StoredKey>>;

export class KeyStore {
  private readonly file: string;
  private readonly master: Buffer;
  private data: KeyFile = {};

  constructor(dir: string, masterKeyBase64?: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'ollama-keys.json');
    this.master = masterKeyBase64 ? Buffer.from(masterKeyBase64, 'base64') : KeyStore.localMaster(dir);
    if (this.master.length !== 32) throw new Error('La clave maestra debe tener 32 bytes (base64).');
    if (existsSync(this.file)) this.data = JSON.parse(readFileSync(this.file, 'utf8')) as KeyFile;
  }

  private static localMaster(dir: string): Buffer {
    const path = join(dir, 'master.key');
    if (!existsSync(path)) {
      writeFileSync(path, randomBytes(32).toString('base64'), { mode: 0o600 });
      chmodSync(path, 0o600);
    }
    return Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.master, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  private decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.master, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }

  set(scope: KeyScope, apiKey: string, maxConcurrency: number, validated: boolean): KeyInfo {
    const now = new Date().toISOString();
    this.data[scope] = {
      scope,
      ciphertext: this.encrypt(apiKey),
      last4: apiKey.slice(-4),
      max_concurrency: maxConcurrency,
      validated_at: validated ? now : null,
      created_at: now,
    };
    this.save();
    return this.info(scope)!;
  }

  info(scope: KeyScope): KeyInfo | null {
    const stored = this.data[scope];
    if (!stored) return null;
    const { ciphertext: _hidden, ...info } = stored;
    return info;
  }

  /** La clave personal tiene prioridad; si no existe, la de la agencia. */
  active(): KeyInfo | null {
    return this.info('user') ?? this.info('org');
  }

  reveal(scope: KeyScope): string | null {
    const stored = this.data[scope];
    return stored ? this.decrypt(stored.ciphertext) : null;
  }

  revoke(scope: KeyScope): boolean {
    if (!this.data[scope]) return false;
    delete this.data[scope];
    this.save();
    return true;
  }
}

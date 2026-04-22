export class CryptoService {
  private static instance: CryptoService;
  private keyPair: CryptoKeyPair | null = null;
  private privateKeyPEM: string | null = null;
  private static readonly PRIVATE_KEYS_BY_USER_STORAGE = 'sirius_private_keys_by_user';
  private static readonly PENDING_PRIVATE_KEY_STORAGE = 'sirius_pending_private_key_pem';

  static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }

  /** Restore decrypt capability for a concrete user in this browser. */
  loadPrivateKeyFromStorage(userId: string): void {
    const byUser = this.readPrivateKeyMap();
    this.privateKeyPEM = byUser[userId] || null;
  }

  /** During registration we don't know user id yet; keep key until first login. */
  savePendingPrivateKeyToStorage(pem: string): void {
    localStorage.setItem(CryptoService.PENDING_PRIVATE_KEY_STORAGE, pem);
  }

  bindPendingPrivateKeyToUser(userId: string): void {
    const pending = localStorage.getItem(CryptoService.PENDING_PRIVATE_KEY_STORAGE);
    if (!pending) return;
    const byUser = this.readPrivateKeyMap();
    if (!byUser[userId]) {
      byUser[userId] = pending;
      this.writePrivateKeyMap(byUser);
    }
    localStorage.removeItem(CryptoService.PENDING_PRIVATE_KEY_STORAGE);
  }

  savePrivateKeyToStorage(userId: string, pem: string): void {
    const byUser = this.readPrivateKeyMap();
    byUser[userId] = pem;
    this.writePrivateKeyMap(byUser);
    this.privateKeyPEM = pem;
  }

  clearActivePrivateKeyFromMemory(): void {
    this.privateKeyPEM = null;
  }

  /** Exposes the currently loaded private key PEM (if any) for internal flows like encrypted backup upload. */
  getActivePrivateKeyPEM(): string | null {
    return this.privateKeyPEM;
  }

  /**
   * Encrypt a PEM private key for server-side backup.
   * The server stores only ciphertext; the password never leaves the client.
   *
   * Format: JSON string { v, kdf, iter, salt, iv, ct } with base64 fields.
   */
  async encryptPrivateKeyForBackup(privateKeyPem: string, password: string): Promise<string> {
    if (!window.isSecureContext || !window.crypto?.subtle) {
      throw new Error(
        'Secure context required for encryption. Open Sirius via https:// or on localhost.'
      );
    }
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const key = await this.deriveBackupKey(password, salt, 250_000);
    const pt = new TextEncoder().encode(privateKeyPem);
    const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);

    return JSON.stringify({
      v: 1,
      kdf: 'PBKDF2-SHA256',
      iter: 250_000,
      salt: this.arrayBufferToBase64(salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength)),
      iv: this.arrayBufferToBase64(iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength)),
      ct: this.arrayBufferToBase64(ct),
    });
  }

  async decryptPrivateKeyBackup(privateKeyEncrypted: string, password: string): Promise<string> {
    if (!window.isSecureContext || !window.crypto?.subtle) {
      throw new Error(
        'Secure context required for decryption. Open Sirius via https:// or on localhost.'
      );
    }
    let parsed: any;
    try {
      parsed = JSON.parse(privateKeyEncrypted);
    } catch {
      throw new Error('Invalid encrypted key format');
    }
    if (!parsed || parsed.v !== 1 || parsed.kdf !== 'PBKDF2-SHA256') {
      throw new Error('Unsupported encrypted key format');
    }
    const iter = typeof parsed.iter === 'number' ? parsed.iter : 250_000;
    const salt = new Uint8Array(this.base64ToArrayBuffer(String(parsed.salt || '')));
    const iv = new Uint8Array(this.base64ToArrayBuffer(String(parsed.iv || '')));
    const ct = this.base64ToArrayBuffer(String(parsed.ct || ''));

    if (salt.byteLength < 8 || iv.byteLength !== 12) {
      throw new Error('Invalid encrypted key parameters');
    }

    const key = await this.deriveBackupKey(password, salt, iter);
    const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  }

async generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  if (!window.isSecureContext || !window.crypto?.subtle) {
    throw new Error(
      'Secure context required for key generation. Open Sirius via https:// or on localhost.'
    );
  }
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 4096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );

  this.keyPair = keyPair;

  const publicKeyRaw = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateKeyRaw = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  const publicKey = this.arrayBufferToPEM(publicKeyRaw, 'PUBLIC KEY');
  const privateKey = this.arrayBufferToPEM(privateKeyRaw, 'PRIVATE KEY');

  this.privateKeyPEM = privateKey;  // ← ВОТ ЭТУ СТРОКУ ДОБАВЬТЕ (если её нет)

  return { publicKey, privateKey };
}

  async encryptMessage(message: string, recipientPublicKeyPEM: string): Promise<{ encryptedContent: string; iv: string; encryptedKey: string }> {
    // Import recipient's public key
    const recipientPublicKey = await this.importPublicKey(recipientPublicKeyPEM);

    // Generate AES key
    const aesKey = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // Generate IV
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // Encrypt message with AES-GCM
    const encodedMessage = new TextEncoder().encode(message);
    const encryptedContent = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      encodedMessage
    );

    // Export and encrypt AES key with RSA
    const aesKeyRaw = await window.crypto.subtle.exportKey('raw', aesKey);
    const encryptedKey = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      recipientPublicKey,
      aesKeyRaw
    );

    return {
      encryptedContent: this.arrayBufferToBase64(encryptedContent),
      iv: this.arrayBufferToBase64(iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength)),
      encryptedKey: this.arrayBufferToBase64(encryptedKey),
    };
  }

  /** Marker stored in Message.senderKey for symmetric group payloads (not RSA-wrapped). */
  static readonly GROUP_SENDER_KEY = 'GROUP';

  /**
   * Group chats use AES-GCM with a key derived from the conversation id (all members compute the same key).
   * This is weaker than 1:1 RSA; it protects casual storage inspection but is not full E2EE if the id leaks.
   */
  private async importGroupAesKey(conversationId: string): Promise<CryptoKey> {
    const material = new TextEncoder().encode(`sirius-group-v1|${conversationId}`);
    const hash = await window.crypto.subtle.digest('SHA-256', material);
    return window.crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async encryptGroupMessage(message: string, conversationId: string): Promise<{ encryptedContent: string; iv: string; senderKey: string }> {
    const aesKey = await this.importGroupAesKey(conversationId);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(message);
    const encryptedContent = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);
    return {
      encryptedContent: this.arrayBufferToBase64(encryptedContent),
      iv: this.arrayBufferToBase64(iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength)),
      senderKey: CryptoService.GROUP_SENDER_KEY,
    };
  }

  async decryptGroupMessage(encryptedContent: string, iv: string, conversationId: string): Promise<string> {
    const aesKey = await this.importGroupAesKey(conversationId);
    const encryptedContentBuffer = this.base64ToArrayBuffer(encryptedContent);
    const ivBuffer = this.base64ToArrayBuffer(iv);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBuffer },
      aesKey,
      encryptedContentBuffer
    );
    return new TextDecoder().decode(decrypted);
  }

  async decryptMessage(encryptedContent: string, iv: string, encryptedKey: string): Promise<string> {
    if (!this.privateKeyPEM) {
      throw new Error('No private key available');
    }

    const privateKey = await this.importPrivateKey(this.privateKeyPEM);

    // Decrypt AES key
    const encryptedKeyBuffer = this.base64ToArrayBuffer(encryptedKey);
    const aesKeyRaw = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      encryptedKeyBuffer
    );

    // Import AES key
    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      aesKeyRaw,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decrypt message
    const encryptedContentBuffer = this.base64ToArrayBuffer(encryptedContent);
    const ivBuffer = this.base64ToArrayBuffer(iv);

    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBuffer },
      aesKey,
      encryptedContentBuffer
    );

    return new TextDecoder().decode(decrypted);
  }

  private async importPublicKey(pem: string): Promise<CryptoKey> {
    const binaryDer = this.pemToArrayBuffer(pem);
    return await window.crypto.subtle.importKey(
      'spki',
      binaryDer,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
  }

  private async importPrivateKey(pem: string): Promise<CryptoKey> {
    const binaryDer = this.pemToArrayBuffer(pem);
    return await window.crypto.subtle.importKey(
      'pkcs8',
      binaryDer,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
  }

  private pemToArrayBuffer(pem: string): ArrayBuffer {
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    return this.base64ToArrayBuffer(b64);
  }

  private arrayBufferToPEM(buffer: ArrayBuffer, type: string): string {
    const b64 = this.arrayBufferToBase64(buffer);
    const lines = b64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
      return bytes.buffer;
  }

  private readPrivateKeyMap(): Record<string, string> {
    try {
      const raw = localStorage.getItem(CryptoService.PRIVATE_KEYS_BY_USER_STORAGE);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private writePrivateKeyMap(map: Record<string, string>): void {
    localStorage.setItem(CryptoService.PRIVATE_KEYS_BY_USER_STORAGE, JSON.stringify(map));
  }

  private async deriveBackupKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return window.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
}

export const cryptoService = CryptoService.getInstance();
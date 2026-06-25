import SftpClient from 'ssh2-sftp-client';
import * as fs from 'fs';
import * as path from 'path';

// ─── Config (set via env vars or pass directly to SftpHelper constructor) ─────
export interface SftpConfig {
  host:       string;
  port:       number;
  username:   string;
  password?:  string;
  privateKey?: string;   // path to private key file OR key content
  remoteInDir:  string;  // supplier uploads EDI here (GORDR, GDELR, GCANR, GSURN)
  remoteOutDir: string;  // platform writes EDI here (GORDP, GCANP, GRETP)
}

export function sftpConfigFromEnv(): SftpConfig {
  const host = process.env.SFTP_HOST || '';
  if (!host) console.warn('[SFTP] SFTP_HOST not set — SFTP operations will be skipped');
  return {
    host,
    port:        Number(process.env.SFTP_PORT) || 22,
    username:    process.env.SFTP_USERNAME || '',
    password:    process.env.SFTP_PASSWORD,
    privateKey:  process.env.SFTP_PRIVATE_KEY,
    remoteInDir:  (process.env.SFTP_REMOTE_IN_DIR  || '/incoming').trim(),
    remoteOutDir: (process.env.SFTP_REMOTE_OUT_DIR || '/outgoing').trim(),
  };
}

// ─── SFTP Helper class ─────────────────────────────────────────────────────────
export class SftpHelper {
  private sftp = new SftpClient();
  private connected = false;

  constructor(private config: SftpConfig) {}

  get isConfigured(): boolean {
    return !!this.config.host && !!this.config.username;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (!this.isConfigured) {
      console.log('[SFTP] Not configured — skipping connect');
      return;
    }
    const opts: any = {
      host:     this.config.host,
      port:     this.config.port,
      username: this.config.username,
    };
    if (this.config.privateKey) {
      // Accept both file path and raw key content
      const raw = this.config.privateKey;
      opts.privateKey = raw.startsWith('-----') ? raw : fs.readFileSync(raw);
    } else {
      opts.password = this.config.password;
    }
    await this.sftp.connect(opts);
    this.connected = true;
    console.log(`[SFTP] Connected to ${this.config.host}:${this.config.port}`);
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.sftp.end().catch(() => {});
      this.connected = false;
      console.log('[SFTP] Disconnected');
    }
  }

  // Upload a local file to remoteInDir (supplier → platform)
  async uploadEDI(localFilePath: string, remoteFileName?: string): Promise<boolean> {
    if (!this.isConfigured) {
      console.log('[SFTP] uploadEDI skipped — not configured');
      return false;
    }
    try {
      if (!this.connected) await this.connect();
      const fileName = remoteFileName || path.basename(localFilePath);
      const remotePath = `${this.config.remoteInDir}/${fileName}`;
      await this.sftp.put(localFilePath, remotePath);
      console.log(`[SFTP] Uploaded: ${localFilePath} → ${remotePath}`);
      return true;
    } catch (e) {
      console.log(`[SFTP] uploadEDI failed:`, (e as Error).message);
      return false;
    }
  }

  // Upload EDI content (string) without a local temp file
  async uploadEDIContent(content: string, remoteFileName: string): Promise<boolean> {
    if (!this.isConfigured) {
      console.log('[SFTP] uploadEDIContent skipped — not configured');
      return false;
    }
    try {
      if (!this.connected) await this.connect();
      const remotePath = `${this.config.remoteInDir}/${remoteFileName}`;
      const buffer = Buffer.from(content, 'utf-8');
      await this.sftp.put(buffer, remotePath);
      console.log(`[SFTP] Uploaded content → ${remotePath}`);
      return true;
    } catch (e) {
      console.log(`[SFTP] uploadEDIContent failed:`, (e as Error).message);
      return false;
    }
  }

  // Upload EDI content to remoteOutDir (platform→supplier: GORDP, GCANP, GRETP)
  async uploadToOutDir(content: string, remoteFileName: string): Promise<boolean> {
    if (!this.isConfigured) {
      console.log('[SFTP] uploadToOutDir skipped — not configured');
      return false;
    }
    try {
      if (!this.connected) await this.connect();
      const remotePath = `${this.config.remoteOutDir}/${remoteFileName}`;
      const buffer = Buffer.from(content, 'utf-8');
      await this.sftp.put(buffer, remotePath);
      console.log(`[SFTP] Uploaded content → ${remotePath}`);
      return true;
    } catch (e) {
      console.log(`[SFTP] uploadToOutDir failed:`, (e as Error).message);
      return false;
    }
  }

  // List files in a remote directory
  async listFiles(remoteDir: string): Promise<string[]> {
    if (!this.isConfigured) return [];
    try {
      if (!this.connected) await this.connect();
      const files = await this.sftp.list(remoteDir);
      return files.map(f => f.name);
    } catch (e) {
      console.log(`[SFTP] listFiles(${remoteDir}) failed:`, (e as Error).message);
      return [];
    }
  }

  // Download a remote file and return its content as a string
  async downloadFileContent(remotePath: string): Promise<string> {
    if (!this.isConfigured) return '';
    try {
      if (!this.connected) await this.connect();
      const buf = await this.sftp.get(remotePath) as Buffer;
      return buf.toString('utf-8');
    } catch (e) {
      console.log(`[SFTP] downloadFileContent(${remotePath}) failed:`, (e as Error).message);
      return '';
    }
  }

  // Poll remoteOutDir until a file matching pattern appears (or timeout)
  async waitForFile(
    pattern: RegExp | string,
    timeoutMs = 60000,
    pollIntervalMs = 3000,
    remoteDir?: string,
  ): Promise<string | null> {
    if (!this.isConfigured) {
      console.log('[SFTP] waitForFile skipped — not configured');
      return null;
    }
    const dir = remoteDir || this.config.remoteOutDir;
    const deadline = Date.now() + timeoutMs;
    console.log(`[SFTP] Waiting for file matching ${pattern} in ${dir} (timeout ${timeoutMs}ms)...`);

    while (Date.now() < deadline) {
      const files = await this.listFiles(dir);
      const match = files.find(f =>
        pattern instanceof RegExp ? pattern.test(f) : f.includes(pattern)
      );
      if (match) {
        console.log(`[SFTP] Found: ${match}`);
        return match;
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
    console.log(`[SFTP] Timeout waiting for ${pattern} in ${dir}`);
    return null;
  }

  // Delete a remote file (cleanup after test)
  async deleteFile(remotePath: string): Promise<void> {
    if (!this.isConfigured) return;
    try {
      if (!this.connected) await this.connect();
      await this.sftp.delete(remotePath);
      console.log(`[SFTP] Deleted: ${remotePath}`);
    } catch (e) {
      console.log(`[SFTP] deleteFile(${remotePath}) failed:`, (e as Error).message);
    }
  }

  // Convenience: verify connection is working
  async testConnection(): Promise<boolean> {
    if (!this.isConfigured) {
      console.log('[SFTP] testConnection skipped — SFTP_HOST not set');
      return false;
    }
    try {
      await this.connect();
      const inFiles  = await this.listFiles(this.config.remoteInDir);
      const outFiles = await this.listFiles(this.config.remoteOutDir);
      console.log(`[SFTP] Connection OK | in: ${inFiles.length} files | out: ${outFiles.length} files`);
      return true;
    } catch (e) {
      console.log('[SFTP] testConnection failed:', (e as Error).message);
      return false;
    }
  }
}

// ─── Singleton factory (re-uses one instance per process) ─────────────────────
let _instance: SftpHelper | null = null;

export function getSftpHelper(): SftpHelper {
  if (!_instance) _instance = new SftpHelper(sftpConfigFromEnv());
  return _instance;
}

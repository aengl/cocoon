/**
 * Client-presence hub. An optional side-channel with zero coupling to
 * processing or persistence — lives at the transport edge, not in Runtime.
 * Collects each connection's opaque blob, hands back a snapshot, forgets
 * it on disconnect. Interprets nothing; `PresenceData` is pure client
 * convention.
 */
import type { PresenceData, PresenceEntry } from '../src/lib/protocol.ts';

/** Sanity cap per blob — presence is UI state, never bulk data. */
const MAX_BLOB_BYTES = 256 * 1024;

export class PresenceHub {
  private byConn = new Map<string, PresenceEntry>();
  private seq = 0;

  /** A fresh, opaque connection id (the authoritative presence key). */
  newConnId(): string {
    return `c${(++this.seq).toString(36)}-${Date.now().toString(36)}`;
  }

  /** Record/replace a connection's presence (or clear it on `null`).
   *  Oversized/non-serialisable blobs are dropped silently. */
  set(connId: string, client: string, data: PresenceData | null): boolean {
    if (data == null) return this.byConn.delete(connId);
    let json: string;
    try {
      json = JSON.stringify(data);
    } catch {
      return false;
    }
    if (json.length > MAX_BLOB_BYTES) return false;
    this.byConn.set(connId, {
      id: connId,
      client: String(client || connId),
      data,
      ts: Date.now(),
    });
    return true;
  }

  /** Forget a connection (called on socket close). */
  drop(connId: string): boolean {
    return this.byConn.delete(connId);
  }

  /** Every connected client's last-announced presence. */
  snapshot(): PresenceEntry[] {
    return [...this.byConn.values()];
  }
}

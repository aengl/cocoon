/**
 * The client-presence hub — an entirely optional, orthogonal side-channel.
 *
 * Deliberately NOT part of `Runtime`: presence has zero coupling to
 * processing, the pull graph, persistence, or the lossless YAML contract, so
 * it lives at the transport edge (`serve.ts`) where it can't break any of
 * them. The core's whole job here is: collect each connection's opaque blob,
 * hand back a snapshot, forget it on disconnect. It **interprets nothing** —
 * the conventional shape of `data` (see protocol `PresenceData`) is pure
 * client convention. This is the substrate human↔AI collaboration rides
 * (and what the long-deferred brushing & linking would too).
 *
 * Lifetime = the WebSocket connection: connection-keyed, dropped on close. A
 * per-blob size cap keeps a client from announcing something pathological
 * (it's UI state — kilobytes — never bulk data; this is just a sanity rail).
 */
import type { PresenceData, PresenceEntry } from '../src/lib/protocol.ts';

/** Sanity cap per client blob (UI state is tiny; this only stops abuse). */
const MAX_BLOB_BYTES = 256 * 1024;

export class PresenceHub {
  private byConn = new Map<string, PresenceEntry>();
  private seq = 0;

  /** A fresh, opaque connection id (the authoritative presence key). */
  newConnId(): string {
    return `c${(++this.seq).toString(36)}-${Date.now().toString(36)}`;
  }

  /**
   * Record/replace a connection's presence. `null` clears it (the client
   * asked to go silent without disconnecting). Oversized blobs are rejected
   * silently — presence is best-effort by design; a dropped announce just
   * means peers keep the client's previous state until its next one.
   */
  set(connId: string, client: string, data: PresenceData | null): boolean {
    if (data == null) return this.byConn.delete(connId);
    let json: string;
    try {
      json = JSON.stringify(data);
    } catch {
      return false; // non-serialisable — never let it near the relay
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

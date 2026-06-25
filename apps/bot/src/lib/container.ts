/**
 * Sapphire container augmentation.
 *
 * Sapphire exposes a global `container` (and `this.container` on every piece)
 * for dependency sharing. We extend it with the services the bot core owns so
 * commands and listeners can reach them in a type safe way. Phase B modules add
 * their own services by augmenting this same interface from their own files.
 */
import type { ConfigService } from './config.ts'
import type { ApiServer } from '../api/server.ts'

declare module '@sapphire/pieces' {
  interface Container {
    /** Per guild configuration service backed by @nd/db. */
    config: ConfigService
    /** The dashboard HTTP + WebSocket server, available after login. */
    api: ApiServer | null
  }
}

export {}

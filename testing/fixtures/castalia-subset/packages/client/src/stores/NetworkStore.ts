/**
 * ABOUTME: MobX store for Colyseus multiplayer connection state.
 * Manages room join/leave, player tracking, and connection health.
 */

import type { PlayerState } from '@castalia-subset/types';
import type { RootStore } from './RootStore';

export class NetworkStore {
  rootStore: RootStore;
  connected: boolean = false;
  roomId: string | null = null;
  players: Map<string, PlayerState> = new Map();
  latencyMs: number = 0;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get isConnected(): boolean {
    return this.connected && this.roomId !== null;
  }

  joinRoom(roomId: string): void {
    this.roomId = roomId;
    this.connected = true;
  }

  leaveRoom(): void {
    this.roomId = null;
    this.connected = false;
    this.players.clear();
  }

  updatePlayerPosition(playerId: string, x: number, y: number): void {
    const player = this.players.get(playerId);
    if (player) {
      player.x = x;
      player.y = y;
    }
  }
}

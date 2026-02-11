/**
 * ABOUTME: Colyseus schema for multiplayer world state.
 * Tracks player positions, zones, and room tick.
 */

import type { WorldState, PlayerState, Zone } from '@castalia-subset/types';

export class WorldStateSchema {
  players: Map<string, PlayerState> = new Map();
  zones: Zone[] = [];
  tick = 0;

  addPlayer(player: PlayerState): void {
    this.players.set(player.id, player);
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  movePlayer(id: string, x: number, y: number): void {
    const player = this.players.get(id);
    if (player) {
      player.x = x;
      player.y = y;
    }
  }

  toJSON(): WorldState {
    return {
      players: this.players,
      zones: this.zones,
      tick: this.tick,
    };
  }
}

/**
 * ABOUTME: Shared types for the Castalia subset fixture.
 * Covers multiplayer state, calendar events, theming, and avatar types.
 */

// ─── Multiplayer / Colyseus ─────────────────────────────────────────────────

export interface WorldState {
  players: Map<string, PlayerState>;
  zones: Zone[];
  tick: number;
}

export interface PlayerState {
  id: string;
  displayName: string;
  x: number;
  y: number;
  avatarUrl: string;
  currentZone: string | null;
  isSpeaking: boolean;
}

export interface Zone {
  id: string;
  name: string;
  type: 'agora' | 'garden' | 'auditorium' | 'teahouse';
  bounds: { x: number; y: number; width: number; height: number };
  maxOccupants: number;
  color: string;
}

// ─── Calendar ───────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  startTime: string; // ISO-8601
  endTime: string;
  zoneId: string | null;
  attendees: Attendee[];
  recurrence: string | null; // RRULE
  color: string;
  createdBy: string;
}

export interface Attendee {
  userId: string;
  displayName: string;
  rsvp: 'yes' | 'no' | 'maybe' | 'pending';
}

// ─── Theming ────────────────────────────────────────────────────────────────

export interface ThemeDefinition {
  id: string;
  name: string;
  civilization: string;
  colors: {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    text: string;
    accent: string;
    zoneAgora: string;
    zoneGarden: string;
    zoneAuditorium: string;
    zoneTeahouse: string;
  };
}

// ─── Avatar ─────────────────────────────────────────────────────────────────

export interface AvatarConfig {
  spriteSheet: string;
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, { start: number; end: number; frameRate: number }>;
}

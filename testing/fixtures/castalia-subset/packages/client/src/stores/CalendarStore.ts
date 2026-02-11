/**
 * ABOUTME: MobX store for calendar events and scheduling.
 * Manages CRUD, filtering by zone, recurring events, and attendee RSVPs.
 */

import type { CalendarEvent, Attendee } from '@castalia-subset/types';
import type { RootStore } from './RootStore';

export class CalendarStore {
  rootStore: RootStore;
  events: CalendarEvent[] = [];
  selectedDate: string = new Date().toISOString().split('T')[0];
  filterZoneId: string | null = null;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
  }

  get filteredEvents(): CalendarEvent[] {
    let filtered = this.events;
    if (this.filterZoneId) {
      filtered = filtered.filter((e) => e.zoneId === this.filterZoneId);
    }
    return filtered;
  }

  addEvent(event: CalendarEvent): void {
    this.events.push(event);
  }

  removeEvent(id: string): void {
    this.events = this.events.filter((e) => e.id !== id);
  }

  updateAttendeeRsvp(eventId: string, userId: string, rsvp: Attendee['rsvp']): void {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) return;
    const attendee = event.attendees.find((a) => a.userId === userId);
    if (attendee) attendee.rsvp = rsvp;
  }
}

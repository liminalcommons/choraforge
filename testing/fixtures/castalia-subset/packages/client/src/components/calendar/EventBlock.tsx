/**
 * ABOUTME: Calendar event block rendered within the weekly grid.
 * Uses zone-based coloring from the theme and shows time + title.
 */

import React from 'react';
import type { CalendarEvent } from '@castalia-subset/types';

interface EventBlockProps {
  event: CalendarEvent;
  onClick?: (event: CalendarEvent) => void;
}

export function EventBlock({ event, onClick }: EventBlockProps) {
  const startHour = new Date(event.startTime).getHours();
  const endHour = new Date(event.endTime).getHours();
  const durationHours = endHour - startHour;

  return (
    <div
      className="event-block"
      style={{
        backgroundColor: event.color || 'var(--color-primary)',
        height: `${durationHours * 60}px`,
        top: `${startHour * 60}px`,
      }}
      onClick={() => onClick?.(event)}
      role="button"
      tabIndex={0}
    >
      <span className="event-title">{event.title}</span>
      <span className="event-time">
        {new Date(event.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
      {event.attendees.length > 0 && (
        <span className="event-attendees">{event.attendees.length} attendees</span>
      )}
    </div>
  );
}

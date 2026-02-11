/**
 * ABOUTME: Express + Colyseus server entry point.
 * Provides REST API for calendar events and multiplayer room management.
 */

import express from 'express';

const app = express();
app.use(express.json());

// Calendar event CRUD endpoints
const events: any[] = [];

app.get('/api/events', (_req, res) => {
  res.json(events);
});

app.post('/api/events', (req, res) => {
  const event = { id: String(events.length + 1), ...req.body };
  events.push(event);
  res.status(201).json(event);
});

app.patch('/api/events/:id', (req, res) => {
  const idx = events.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  events[idx] = { ...events[idx], ...req.body };
  res.json(events[idx]);
});

app.delete('/api/events/:id', (req, res) => {
  const idx = events.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  events.splice(idx, 1);
  res.status(204).send();
});

// Zone management
app.get('/api/zones', (_req, res) => {
  res.json([
    { id: 'agora', name: 'Agora', type: 'agora', maxOccupants: 50 },
    { id: 'garden', name: 'West Garden', type: 'garden', maxOccupants: 20 },
    { id: 'auditorium', name: 'Auditorium', type: 'auditorium', maxOccupants: 100 },
    { id: 'teahouse', name: 'Tea House South', type: 'teahouse', maxOccupants: 15 },
  ]);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server on :${PORT}`));

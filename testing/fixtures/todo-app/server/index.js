// Express API server for Todo app — fixture for ChoraForge integration testing
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const db = initDb();

// CRUD routes
app.get('/api/todos', (_req, res) => {
  const todos = db.prepare('SELECT * FROM todos ORDER BY created_at DESC').all();
  res.json(todos);
});

app.post('/api/todos', (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const result = db.prepare('INSERT INTO todos (title) VALUES (?)').run(title);
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', (req, res) => {
  const { completed } = req.body;
  db.prepare('UPDATE todos SET completed = ? WHERE id = ?').run(completed ? 1 : 0, req.params.id);
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  res.json(todo);
});

app.delete('/api/todos/:id', (req, res) => {
  const result = db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Todo not found' });
  res.status(204).end();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Todo API running on port ${PORT}`));

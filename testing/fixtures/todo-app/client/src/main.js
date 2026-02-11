// Client-side Todo app — vanilla JS for simplicity
const API_BASE = 'http://localhost:3001/api';

async function fetchTodos() {
  const res = await fetch(`${API_BASE}/todos`);
  return res.json();
}

async function addTodo(title) {
  const res = await fetch(`${API_BASE}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return res.json();
}

async function toggleTodo(id, completed) {
  const res = await fetch(`${API_BASE}/todos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  });
  return res.json();
}

async function deleteTodo(id) {
  await fetch(`${API_BASE}/todos/${id}`, { method: 'DELETE' });
}

function renderTodos(todos) {
  const list = document.getElementById('todo-list');
  list.innerHTML = '';
  for (const todo of todos) {
    const li = document.createElement('li');
    li.className = todo.completed ? 'completed' : '';
    li.innerHTML = `
      <span>${todo.title}</span>
      <button class="toggle" data-id="${todo.id}">${todo.completed ? 'Undo' : 'Done'}</button>
      <button class="delete" data-id="${todo.id}">Delete</button>
    `;
    list.appendChild(li);
  }
}

document.getElementById('todo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('todo-input');
  if (input.value.trim()) {
    await addTodo(input.value.trim());
    input.value = '';
    renderTodos(await fetchTodos());
  }
});

document.getElementById('todo-list').addEventListener('click', async (e) => {
  const id = e.target.dataset?.id;
  if (!id) return;
  if (e.target.classList.contains('toggle')) {
    const isCompleted = e.target.textContent === 'Undo';
    await toggleTodo(id, !isCompleted);
  } else if (e.target.classList.contains('delete')) {
    await deleteTodo(id);
  }
  renderTodos(await fetchTodos());
});

// Initial load
fetchTodos().then(renderTodos);

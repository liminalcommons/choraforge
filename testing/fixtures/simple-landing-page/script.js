// Simple landing page script — performance marker for load time tracking
document.addEventListener('DOMContentLoaded', () => {
  if (window.performance) {
    const loadTime = performance.now();
    document.documentElement.dataset.loadTime = String(Math.round(loadTime));
  }
});

// Central place for the backend base URL.
// Change this one line when you deploy (e.g. https://api.dailyflow.com).
window.API_BASE = 'http://127.0.0.1:1337';

// HTMX 2 blocks cross-origin requests by default (selfRequestsOnly).
// Since our frontend and backend are on different origins, we must opt in.
htmx.config.selfRequestsOnly = false;

// ...but only actually allow our own backend — reject anything else.
document.addEventListener('htmx:validateUrl', (e) => {
  const allowed = new URL(window.API_BASE).origin;
  if (e.detail.sameHost || new URL(e.detail.url, location.href).origin === allowed) {
    return; // permitted
  }
  e.preventDefault(); // block every other host
});

// Point relative HTMX requests ("/api/...") at the backend base URL,
// so in the HTML you can keep writing hx-get="/api/tasks".
document.addEventListener('htmx:configRequest', (e) => {
  const path = e.detail.path;
  if (path.startsWith('/')) {
    e.detail.path = window.API_BASE + path;
  }
});

// A 204 No Content response normally tells HTMX to skip the swap.
// For DELETE requests we still want the swap so the element is removed.
document.addEventListener('htmx:beforeSwap', (e) => {
  if (e.detail.xhr.status === 204) {
    e.detail.shouldSwap = true;
    e.detail.isError = false;
  }
});

// Let Alpine process directives (@click, x-data, etc.) on content
// that HTMX swaps into the page.
document.addEventListener('htmx:afterSettle', (e) => {
  if (window.Alpine) Alpine.initTree(e.detail.target);
});

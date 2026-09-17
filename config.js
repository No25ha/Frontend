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

  // Attach the logged-in user's JWT to every request, so the backend's
  // per-role/per-project access checks have someone to check against.
  const token = localStorage.getItem('dailyflow_token');
  if (token) {
    e.detail.headers['Authorization'] = 'Bearer ' + token;
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

// ---------- Error toast ----------
// A failed request used to fail silently (stuck "Loading…" or a blank
// panel). Surface it instead, through the toast in the page's x-data.
// Dispatched on `window` (not `document`): the toast listener in index.html
// is registered with Alpine's `.window` modifier (`@show-toast.window`),
// and a plain CustomEvent doesn't bubble by default — dispatching it on
// `document` would never actually reach a `window`-level listener.
function showToast(message) {
  window.dispatchEvent(new CustomEvent('show-toast', { detail: message }));
}

// Pull a human-readable message out of Strapi's standard JSON error shape
// ({"data":null,"error":{"message":"..."}}) — but not the generic
// "Forbidden"/"Unauthorized" the framework sends when a route's own
// permission check rejects the request before it reaches our controller
// (that case is handled separately below, since it can also mean the
// session itself is no longer valid).
function extractErrorMessage(xhr) {
  try {
    const body = JSON.parse(xhr.responseText);
    const msg = body && body.error && body.error.message;
    if (msg && msg !== 'Forbidden' && msg !== 'Unauthorized') return msg;
  } catch (err) {
    /* response wasn't JSON — nothing to extract */
  }
  return null;
}

document.addEventListener('htmx:responseError', (e) => {
  const xhr = e.detail.xhr;
  // A task with this title already exists in the same project — the
  // backend rejects the create (status 400) and flags it with a plain
  // marker in the response body instead of a response header (headers are
  // hidden from JS on cross-origin requests unless the server explicitly
  // exposes them via CORS, which is easy to misconfigure; the body is
  // always readable once a response comes back, so this sidesteps that).
  if (xhr && typeof xhr.responseText === 'string' && xhr.responseText.includes('dailyflow:duplicate-task-title')) {
    showToast('⚠️ A task with this title already exists in this project. Choose a different title.');
    return;
  }

  // A 401/403 here can mean two different things: the caller's role just
  // isn't allowed to do this one specific thing (show that message and
  // stay logged in), or the token itself is missing/expired/invalid (log
  // out back to the login screen). Both look identical from the outside —
  // Strapi returns 403 either way — so we disambiguate by asking
  // /users/me: if the token still checks out, it was a real per-action
  // rejection; if not, the session is gone.
  if (xhr && (xhr.status === 401 || xhr.status === 403)) {
    const token = localStorage.getItem('dailyflow_token');
    if (!token) {
      showToast('Please log in.');
      return;
    }
    fetch(window.API_BASE + '/api/users/me', { headers: { Authorization: 'Bearer ' + token } })
      .then((res) => {
        if (!res.ok) {
          localStorage.removeItem('dailyflow_token');
          window.dispatchEvent(new CustomEvent('session-expired'));
          return;
        }
        showToast(extractErrorMessage(xhr) || `Request failed (${xhr.status}). Please try again.`);
      })
      .catch(() => showToast(`Request failed (${xhr.status}). Please try again.`));
    return;
  }

  showToast(extractErrorMessage(xhr) || `Request failed (${xhr.status}). Please try again.`);
});
document.addEventListener('htmx:sendError', () => {
  showToast('Could not reach the server. Check your connection.');
});

// ---------- Group tasks by planned date ----------
// Only meaningful when the list is sorted by planned date (otherwise the
// cards aren't in date order and headings would be misleading), which the
// toolbar reflects on #tasks via the data-sort attribute.
function groupTasksByPlannedDate(container) {
  const cards = Array.from(container.querySelectorAll(':scope > .task-card'));
  container.querySelectorAll(':scope > .task-group-heading').forEach((el) => el.remove());
  if (!cards.length) return;

  const startOfDay = (value) => {
    const clone = new Date(value);
    clone.setHours(0, 0, 0, 0);
    return clone.getTime();
  };
  const today = startOfDay(new Date());
  const weekAhead = today + 7 * 86400000;

  const bucketFor = (raw) => {
    if (!raw) return 'No date';
    const time = startOfDay(raw);
    if (Number.isNaN(time)) return 'No date';
    if (time < today) return 'Overdue';
    if (time === today) return 'Today';
    if (time <= weekAhead) return 'This week';
    return 'Later';
  };

  let lastBucket = null;
  for (const card of cards) {
    const bucket = bucketFor(card.dataset.plannedDate);
    if (bucket !== lastBucket) {
      const heading = document.createElement('div');
      heading.className = 'task-group-heading';
      heading.textContent = bucket;
      container.insertBefore(heading, card);
      lastBucket = bucket;
    }
  }
}

document.addEventListener('htmx:afterSwap', (e) => {
  const target = e.detail.target;
  if (target && target.id === 'tasks' && target.dataset.sort === 'planned') {
    groupTasksByPlannedDate(target);
  }
});

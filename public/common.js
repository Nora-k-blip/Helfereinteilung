/* Gemeinsame Hilfsfunktionen für alle Seiten. */
(function () {
  'use strict';

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'text') node.textContent = v;
        else if (k === 'class') node.className = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k in node && typeof v !== 'string') node[k] = v;
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  const $ = (sel, root) => (root || document).querySelector(sel);
  const clear = (node) => {
    node.replaceChildren();
    return node;
  };

  function time(min) {
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }
  function range(start, end) {
    return time(start) + '–' + time(end);
  }
  function duration(start, end) {
    const m = end - start;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return (h ? h + ' h' : '') + (h && r ? ' ' : '') + (r ? r + ' min' : '');
  }
  function date(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  async function api(method, url, body, headers) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, headers || {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    if ((res.headers.get('content-type') || '').includes('json')) data = await res.json();
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Fehler ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Persönlicher Zugang des Helfers (wird im Browser gespeichert)
  const TOKEN_KEY = 'helfer-token';
  const token = {
    get() {
      try {
        return localStorage.getItem(TOKEN_KEY) || '';
      } catch {
        return '';
      }
    },
    set(v) {
      try {
        localStorage.setItem(TOKEN_KEY, v);
      } catch {}
    },
    clear() {
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {}
    }
  };
  function personalLink(t) {
    return location.origin + '/meine-schichten?t=' + encodeURIComponent(t);
  }

  async function copy(textValue, button) {
    try {
      await navigator.clipboard.writeText(textValue);
      if (button) {
        const old = button.textContent;
        button.textContent = 'Kopiert ✓';
        setTimeout(() => (button.textContent = old), 1500);
      }
    } catch {
      prompt('Link kopieren:', textValue);
    }
  }

  function toast(message, kind) {
    let box = $('#toast');
    if (!box) {
      box = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.className = 'show ' + (kind || '');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (box.className = ''), 3500);
  }

  window.H = { el, $, clear, time, range, duration, date, api, token, personalLink, copy, toast };
})();

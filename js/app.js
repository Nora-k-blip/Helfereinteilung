/* Oberfläche der Helfereinteilung. Logik liegt in scheduler.js. */
(function () {
  'use strict';

  var S = window.Scheduler;
  var STORAGE_KEY = 'helfereinteilung-v1';

  // ---------- Zustand ----------
  function freshState() {
    var c = JSON.parse(JSON.stringify(window.DEFAULT_CONFIG));
    return {
      event: c.event,
      defaults: c.defaults,
      positions: c.positions,
      helpers: [],
      assignments: {}
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* Speicher nicht verfügbar oder kaputt */ }
    return freshState();
  }

  function normalize(data) {
    var base = freshState();
    return {
      event: data.event || base.event,
      defaults: data.defaults || base.defaults,
      positions: Array.isArray(data.positions) ? data.positions : base.positions,
      helpers: Array.isArray(data.helpers) ? data.helpers : [],
      assignments: data.assignments || {}
    };
  }

  var state = load();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignorieren */ }
  }

  /** Schichten berechnen; fehlerhafte Positionen werden übersprungen und gemeldet. */
  function computeShifts() {
    var shifts = [];
    var errors = [];
    state.positions.forEach(function (p) {
      try { shifts = shifts.concat(S.generateShifts(p, state.defaults)); }
      catch (e) { errors.push(e.message); }
    });
    return { shifts: shifts, errors: errors };
  }

  function helperById(id) {
    for (var i = 0; i < state.helpers.length; i++) if (state.helpers[i].id === id) return state.helpers[i];
    return null;
  }

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---------- DOM-Helfer ----------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }
  function $(id) { return document.getElementById(id); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function range(sh) { return S.formatTime(sh.start) + '–' + S.formatTime(sh.end); }

  // ---------- Reiter ----------
  document.querySelectorAll('nav button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
      render();
    });
  });

  // ---------- Veranstaltung ----------
  $('event-name').addEventListener('input', function (e) { state.event.name = e.target.value; save(); renderOverview(); });
  $('event-date').addEventListener('change', function (e) { state.event.date = e.target.value; save(); renderOverview(); });

  // ---------- Einteilung ----------
  function renderSchedule() {
    var res = computeShifts();
    var shifts = res.shifts;
    var conflicts = S.findConflicts(shifts, state.helpers, state.assignments);
    var conflictShiftIds = {};
    conflicts.forEach(function (c) {
      if (c.type !== 'max') c.shiftIds.forEach(function (id) { conflictShiftIds[id] = true; });
    });

    var st = S.stats(shifts, state.assignments);
    var statsEl = $('stats');
    statsEl.textContent = st.filled + ' von ' + st.total + ' Plätzen besetzt' +
      (st.open ? ' – ' + st.open + ' offen' : ' ✓');
    statsEl.className = 'stats ' + (st.open ? 'incomplete' : 'complete');

    var cBox = clear($('conflicts'));
    var messages = res.errors.concat(conflicts.map(function (c) { return c.message; }));
    if (messages.length) {
      cBox.appendChild(el('div', { class: 'conflicts' }, [
        el('strong', { text: 'Bitte prüfen:' }),
        el('ul', null, messages.map(function (m) { return el('li', { text: m }); }))
      ]));
    }

    var container = clear($('schedule'));
    if (!state.helpers.length) {
      container.appendChild(el('p', { class: 'muted', text: 'Noch keine Helfer eingetragen – bitte zuerst im Reiter „Helfer“ hinzufügen.' }));
    }

    var sortedHelpers = state.helpers.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });

    state.positions.forEach(function (p) {
      var pShifts = shifts.filter(function (s) { return s.positionId === p.id; });
      if (!pShifts.length) return;
      var block = el('div', { class: 'position-block' }, [
        el('h3', { text: p.name + ' (' + S.formatTime(S.parseTime(p.start)) + '–' + S.formatTime(S.parseTime(p.end)) + ')' })
      ]);
      var grid = el('div', { class: 'shifts' });
      pShifts.forEach(function (sh) {
        var slots = S.slotsOf(state.assignments, sh);
        var full = slots.every(Boolean);
        var card = el('div', { class: 'shift' + (full ? ' full' : '') + (conflictShiftIds[sh.id] ? ' has-conflict' : '') }, [
          el('div', { class: 'shift-time' }, [
            el('span', { text: range(sh) }),
            el('span', { class: 'muted', text: slots.filter(Boolean).length + '/' + sh.slots })
          ])
        ]);
        slots.forEach(function (current, idx) {
          var select = el('select', {
            class: current ? '' : 'empty',
            'aria-label': p.name + ' ' + range(sh) + ' Platz ' + (idx + 1),
            onchange: function (e) {
              var list = S.slotsOf(state.assignments, sh);
              list[idx] = e.target.value || null;
              state.assignments[sh.id] = list;
              save(); render();
            }
          }, [el('option', { value: '', text: '– frei –' })]);
          sortedHelpers.forEach(function (h) {
            var busy = shifts.some(function (o) {
              return o.id !== sh.id && S.overlaps(o, sh) && S.slotsOf(state.assignments, o).indexOf(h.id) !== -1;
            });
            var hint = !S.isAvailable(h, sh) ? ' (nicht verfügbar)' : busy ? ' (schon eingeteilt)' : '';
            select.appendChild(el('option', { value: h.id, text: h.name + hint, selected: h.id === current }));
          });
          if (current && !helperById(current)) {
            select.appendChild(el('option', { value: current, text: '(gelöschter Helfer)', selected: true }));
          }
          card.appendChild(select);
        });
        grid.appendChild(card);
      });
      block.appendChild(grid);
      container.appendChild(block);
    });
  }

  $('btn-auto').addEventListener('click', function () {
    var shifts = computeShifts().shifts;
    state.assignments = S.autoAssign(shifts, state.helpers, state.assignments);
    save(); render();
    var st = S.stats(shifts, state.assignments);
    if (st.open) alert(st.open + ' Plätze konnten nicht besetzt werden – es fehlen verfügbare Helfer.');
  });

  $('btn-clear').addEventListener('click', function () {
    if (!confirm('Wirklich alle Einteilungen löschen? Die Helferliste bleibt erhalten.')) return;
    state.assignments = {};
    save(); render();
  });

  // ---------- Helfer ----------
  function renderHelperPositionChoices() {
    var box = clear($('helper-positions'));
    state.positions.forEach(function (p) {
      box.appendChild(el('label', null, [el('input', { type: 'checkbox', name: 'pos', value: p.id }), ' ' + p.name]));
    });
  }

  $('helper-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var name = f.name.value.trim();
    if (!name) return;
    var positions = Array.prototype.slice.call(f.querySelectorAll('input[name=pos]:checked')).map(function (c) { return c.value; });
    state.helpers.push({
      id: uid('h'),
      name: name,
      contact: f.contact.value.trim(),
      availableFrom: f.availableFrom.value,
      availableTo: f.availableTo.value,
      maxShifts: f.maxShifts.value ? Number(f.maxShifts.value) : null,
      positions: positions
    });
    f.reset();
    f.name.focus();
    save(); render();
  });

  function renderHelpers() {
    var shifts = computeShifts().shifts;
    var table = clear($('helper-table'));
    $('helper-count').textContent = '(' + state.helpers.length + ')';
    if (!state.helpers.length) {
      table.appendChild(el('tr', null, [el('td', { class: 'muted', text: 'Noch keine Helfer.' })]));
      return;
    }
    table.appendChild(el('tr', null, ['Name', 'Kontakt', 'Ab', 'Bis', 'Max.', 'Positionen', 'Schichten', ''].map(function (t) {
      return el('th', { text: t });
    })));
    state.helpers.forEach(function (h) {
      function field(key, type) {
        return el('input', {
          type: type || 'text', value: h[key] == null ? '' : String(h[key]),
          onchange: function (e) {
            var v = e.target.value;
            h[key] = key === 'maxShifts' ? (v ? Number(v) : null) : v;
            if (key === 'name' && !v.trim()) h.name = '(ohne Namen)';
            save(); render();
          }
        });
      }
      var mine = S.shiftsOfHelper(h.id, shifts, state.assignments);
      var posNames = (h.positions || []).map(function (id) {
        var p = state.positions.filter(function (x) { return x.id === id; })[0];
        return p ? p.name : null;
      }).filter(Boolean);
      table.appendChild(el('tr', null, [
        el('td', null, [field('name')]),
        el('td', null, [field('contact')]),
        el('td', null, [field('availableFrom', 'time')]),
        el('td', null, [field('availableTo', 'time')]),
        el('td', { class: 'num' }, [field('maxShifts', 'number')]),
        el('td', { text: posNames.length ? posNames.join(', ') : 'alle' }),
        el('td', { text: mine.length ? mine.map(function (s) { return s.positionName + ' ' + range(s); }).join(', ') : '–' }),
        el('td', null, [el('button', {
          class: 'icon danger', title: 'Löschen', text: '✕',
          onclick: function () {
            if (!confirm(h.name + ' löschen? Die Person wird auch aus allen Schichten entfernt.')) return;
            state.helpers = state.helpers.filter(function (x) { return x.id !== h.id; });
            Object.keys(state.assignments).forEach(function (k) {
              state.assignments[k] = state.assignments[k].map(function (id) { return id === h.id ? null : id; });
            });
            save(); render();
          }
        })])
      ]));
    });
  }

  // ---------- Positionen ----------
  function renderPositions() {
    $('def-length').value = state.defaults.shiftLengthHours;
    $('def-people').value = state.defaults.peoplePerShift;

    var table = clear($('position-table'));
    table.appendChild(el('tr', null, ['Name', 'Beginn', 'Ende', 'Schichtlänge (h)', 'Personen', 'Schichten', ''].map(function (t) {
      return el('th', { text: t });
    })));
    state.positions.forEach(function (p, idx) {
      function field(key, type, placeholder) {
        return el('input', {
          type: type, value: p[key] == null ? '' : String(p[key]), placeholder: placeholder,
          step: key === 'shiftLengthHours' ? '0.25' : null, min: type === 'number' ? '0' : null,
          onchange: function (e) {
            var v = e.target.value;
            if (type === 'number') p[key] = v ? Number(v) : null;
            else p[key] = v;
            save(); render();
          }
        });
      }
      var preview;
      try {
        preview = S.generateShifts(p, state.defaults).map(range).join(', ');
      } catch (e) { preview = '⚠ ' + e.message; }
      table.appendChild(el('tr', null, [
        el('td', null, [field('name', 'text')]),
        el('td', null, [field('start', 'time')]),
        el('td', null, [field('end', 'time')]),
        el('td', { class: 'num' }, [field('shiftLengthHours', 'number', String(state.defaults.shiftLengthHours))]),
        el('td', { class: 'num' }, [field('peoplePerShift', 'number', String(state.defaults.peoplePerShift))]),
        el('td', { class: 'muted', text: preview }),
        el('td', null, [
          el('button', { class: 'icon', title: 'Nach oben', text: '↑', disabled: idx === 0, onclick: function () { move(idx, -1); } }),
          ' ',
          el('button', { class: 'icon danger', title: 'Löschen', text: '✕', onclick: function () {
            if (!confirm('Position „' + p.name + '“ löschen?')) return;
            state.positions.splice(idx, 1);
            save(); render();
          } })
        ])
      ]));
    });
    // Tabelle auf kleinen Bildschirmen scrollbar machen
    if (!table.parentNode.classList.contains('table-wrap')) {
      var wrap = el('div', { class: 'table-wrap' });
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
  }

  function move(idx, dir) {
    var p = state.positions.splice(idx, 1)[0];
    state.positions.splice(idx + dir, 0, p);
    save(); render();
  }

  $('btn-add-position').addEventListener('click', function () {
    var name = prompt('Name der neuen Position:');
    if (!name || !name.trim()) return;
    var id = S.slugify(name), n = 2, base = id;
    while (state.positions.some(function (p) { return p.id === id; })) id = base + '-' + n++;
    state.positions.push({ id: id, name: name.trim(), start: '09:00', end: '17:00' });
    save(); render();
  });

  $('def-length').addEventListener('change', function (e) {
    var v = Number(e.target.value);
    if (v > 0) { state.defaults.shiftLengthHours = v; save(); }
    render();
  });
  $('def-people').addEventListener('change', function (e) {
    var v = Math.floor(Number(e.target.value));
    if (v >= 1) { state.defaults.peoplePerShift = v; save(); }
    render();
  });

  // ---------- Daten ----------
  function download(filename, content, type) {
    var blob = new Blob([content], { type: type });
    var a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function fileBase() {
    return S.slugify((state.event.name || 'helfereinteilung') + (state.event.date ? '-' + state.event.date : ''));
  }

  $('btn-export').addEventListener('click', function () {
    download(fileBase() + '.json', JSON.stringify(state, null, 2), 'application/json');
  });

  $('file-import').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        state = normalize(JSON.parse(reader.result));
        save(); render();
        alert('Daten geladen.');
      } catch (err) {
        alert('Datei konnte nicht gelesen werden: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  $('btn-reset').addEventListener('click', function () {
    if (!confirm('Alle Helfer, Einteilungen und Positionen löschen und Standard laden?')) return;
    state = freshState();
    save(); render();
  });

  // ---------- Übersicht ----------
  function renderOverview() {
    var shifts = computeShifts().shifts;
    $('print-title').textContent = 'Helfereinteilung ' + (state.event.name || '') +
      (state.event.date ? ' – ' + new Date(state.event.date + 'T00:00').toLocaleDateString('de-DE') : '');

    var pBox = clear($('overview-positions'));
    state.positions.forEach(function (p) {
      var pShifts = shifts.filter(function (s) { return s.positionId === p.id; });
      if (!pShifts.length) return;
      var table = el('table', { class: 'overview-table' }, [
        el('tr', null, [el('th', { text: 'Zeit' }), el('th', { text: 'Helfer' })])
      ]);
      pShifts.forEach(function (sh) {
        var names = S.slotsOf(state.assignments, sh).map(function (id) {
          var h = id && helperById(id);
          return h ? h.name : null;
        });
        var open = names.filter(function (n) { return !n; }).length;
        var filled = names.filter(Boolean);
        table.appendChild(el('tr', null, [
          el('td', { text: range(sh) }),
          el('td', { class: filled.length ? '' : 'open' }, [
            filled.join(', '),
            open ? el('span', { class: 'muted', text: (filled.length ? ' + ' : '') + open + ' offen' }) : null
          ])
        ]));
      });
      pBox.appendChild(el('div', { class: 'card position-overview' }, [el('h2', { text: p.name }), table]));
    });

    var hBox = clear($('overview-helpers'));
    var table = el('table', { class: 'overview-table' }, [
      el('tr', null, [el('th', { text: 'Name' }), el('th', { text: 'Kontakt' }), el('th', { text: 'Schichten' })])
    ]);
    state.helpers.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (h) {
      var mine = S.shiftsOfHelper(h.id, shifts, state.assignments).sort(function (a, b) { return a.start - b.start; });
      table.appendChild(el('tr', null, [
        el('td', { text: h.name }),
        el('td', { text: h.contact || '' }),
        el('td', { class: mine.length ? '' : 'open', text: mine.length
          ? mine.map(function (s) { return range(s) + ' ' + s.positionName; }).join(' · ')
          : 'nicht eingeteilt' })
      ]));
    });
    hBox.appendChild(el('div', { class: 'card' }, [state.helpers.length ? table : el('p', { class: 'muted', text: 'Keine Helfer.' })]));
  }

  $('btn-print').addEventListener('click', function () { window.print(); });

  $('btn-csv').addEventListener('click', function () {
    var shifts = computeShifts().shifts;
    var maxSlots = shifts.reduce(function (m, s) { return Math.max(m, s.slots); }, 0);
    var header = ['Position', 'Beginn', 'Ende'];
    for (var i = 1; i <= maxSlots; i++) header.push('Helfer ' + i);
    var rows = [header];
    shifts.forEach(function (sh) {
      var row = [sh.positionName, S.formatTime(sh.start), S.formatTime(sh.end)];
      S.slotsOf(state.assignments, sh).forEach(function (id) {
        var h = id && helperById(id);
        row.push(h ? h.name : '');
      });
      rows.push(row);
    });
    // Semikolon + BOM, damit deutsches Excel die Datei direkt richtig öffnet
    var csv = '﻿' + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    download(fileBase() + '.csv', csv, 'text/csv;charset=utf-8');
  });

  // ---------- Gesamt ----------
  function render() {
    $('event-name').value = state.event.name || '';
    $('event-date').value = state.event.date || '';
    document.title = 'Helfereinteilung – ' + (state.event.name || '');
    renderSchedule();
    renderHelperPositionChoices();
    renderHelpers();
    renderPositions();
    renderOverview();
  }

  render();
})();

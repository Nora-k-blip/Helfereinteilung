(function () {
  'use strict';
  const { el, $, clear, time, range, date, api, personalLink, copy, toast } = window.H;

  let data = null;
  let activeTab = 'overview';

  // ---------- Anmeldung ----------
  async function init() {
    const { admin } = await api('GET', '/api/admin/session');
    if (!admin) return showLogin();
    $('#login').hidden = true;
    $('#tabs').hidden = false;
    $('#logout').hidden = false;
    await reload();
  }

  function showLogin() {
    $('#login').hidden = false;
    $('#tabs').hidden = true;
    $('#logout').hidden = true;
    document.querySelectorAll('.tab').forEach((t) => (t.hidden = true));
    $('#login').password.focus();
  }

  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    try {
      await api('POST', '/api/admin/login', { password: e.target.password.value });
      document.querySelectorAll('.tab').forEach((t) => (t.hidden = false));
      init();
    } catch (ex) {
      $('#login-error').textContent = ex.message;
    }
  });

  $('#logout').addEventListener('click', async () => {
    await api('POST', '/api/admin/logout', {});
    location.reload();
  });

  /** Führt eine Admin-Aktion aus, zeigt Fehler an und lädt danach neu. Gibt true bei Erfolg zurück. */
  async function act(promise, success) {
    try {
      await promise;
      if (success) toast(success);
      await reload();
      return true;
    } catch (e) {
      if (e.status === 401) showLogin();
      else toast(e.message, 'error');
      return false;
    }
  }

  async function reload() {
    try {
      data = await api('GET', '/api/admin/data');
    } catch (e) {
      if (e.status === 401) return showLogin();
      toast(e.message, 'error');
      return;
    }
    render();
  }

  // ---------- Reiter ----------
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      activeTab = b.dataset.tab;
      document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + activeTab));
    })
  );

  function render() {
    const s = data.settings;
    $('#event').textContent = [s.event_name, date(s.event_date)].filter(Boolean).join(' · ');
    $('#print-title').textContent = 'Helfereinteilung ' + [s.event_name, date(s.event_date)].filter(Boolean).join(' – ');
    renderOverview();
    renderVolunteers();
    renderPositions();
    renderSettings();
  }

  // ---------- Übersicht ----------
  function renderOverview() {
    let total = 0;
    let filled = 0;
    for (const p of data.positions)
      for (const sh of p.shifts) {
        total += sh.capacity;
        filled += sh.signups.length;
      }
    const statBox = clear($('#stats'));
    [
      ['Plätze gesamt', total],
      ['Besetzt', filled],
      ['Offen', total - filled],
      ['Helfer', data.volunteers.length]
    ].forEach(([label, n]) => statBox.appendChild(el('div', { class: 'stat' }, [el('b', { text: n }), el('span', { class: 'muted', text: label })])));
    if (!data.settings.signup_open) {
      statBox.appendChild(el('div', { class: 'stat notice warn' }, [el('b', { text: 'Zu' }), el('span', { text: 'Anmeldung geschlossen' })]));
    }

    const onlyOpen = $('#only-open').checked;
    const showContact = $('#show-contact').checked;
    const box = clear($('#overview'));
    for (const p of data.positions) {
      const shifts = p.shifts.filter((sh) => !onlyOpen || sh.signups.length < sh.capacity);
      if (!shifts.length) continue;
      const pFilled = p.shifts.reduce((n, sh) => n + sh.signups.length, 0);
      const pTotal = p.shifts.reduce((n, sh) => n + sh.capacity, 0);
      const table = el('table', null, [
        el('tr', null, [el('th', { text: 'Zeit', style: 'width:120px' }), el('th', { text: 'Helfer' }), el('th', { class: 'num no-print', text: '' })])
      ]);
      for (const sh of shifts) {
        const people = el('ul', { class: 'people' });
        for (const sg of sh.signups) {
          people.appendChild(
            el('li', null, [
              el('strong', { text: sg.name }),
              showContact ? el('span', { class: 'contact', text: [sg.phone, sg.email].filter(Boolean).join(' · ') }) : null,
              sg.note ? el('span', { class: 'contact', text: '„' + sg.note + '“' }) : null,
              el('button', {
                class: 'link small no-print',
                text: 'entfernen',
                onclick: () => {
                  if (confirm(`${sg.name} aus ${p.name} ${range(sh.start_min, sh.end_min)} entfernen?`)) act(api('DELETE', '/api/admin/signups/' + sg.id), 'Entfernt.');
                }
              })
            ])
          );
        }
        const open = sh.capacity - sh.signups.length;
        for (let i = 0; i < open; i++) people.appendChild(el('li', { class: 'open-slot', text: 'offen' }));
        table.appendChild(
          el('tr', null, [
            el('td', null, [el('strong', { text: range(sh.start_min, sh.end_min) }), el('div', { class: 'muted small', text: `${sh.signups.length}/${sh.capacity}` })]),
            el('td', null, [people]),
            el('td', { class: 'no-print' }, [open > 0 ? el('button', { class: 'icon', text: '+ Person', onclick: () => openAdd(p, sh) }) : null])
          ])
        );
      }
      box.appendChild(
        el('section', { class: 'card' }, [
          el('div', { class: 'row', style: 'margin-bottom:6px' }, [
            el('h2', { text: p.name, style: 'margin:0' }),
            p.visible ? null : el('span', { class: 'badge full', text: 'ausgeblendet' }),
            el('span', { class: 'spacer' }),
            el('span', { class: 'badge ' + (pFilled < pTotal ? 'open' : ''), text: `${pFilled}/${pTotal} besetzt` })
          ]),
          el('div', { class: 'table-wrap' }, [table])
        ])
      );
    }
    if (!box.children.length) box.appendChild(el('p', { class: 'muted', text: onlyOpen ? 'Alle Schichten sind besetzt. 🎉' : 'Noch keine Positionen angelegt.' }));
  }
  $('#only-open').addEventListener('change', renderOverview);
  $('#show-contact').addEventListener('change', renderOverview);
  $('#print').addEventListener('click', () => window.print());

  // Person manuell eintragen
  const addDlg = $('#add-dialog');
  const addForm = $('#add-form');
  let addTarget = null;
  function openAdd(p, sh) {
    addTarget = sh;
    addForm.reset();
    $('#add-error').textContent = '';
    $('#add-shift').textContent = `${p.name} · ${range(sh.start_min, sh.end_min)}`;
    const sel = clear($('#add-existing'));
    sel.appendChild(el('option', { value: '', text: '– neue Person –' }));
    for (const v of data.volunteers) {
      const busy = v.shifts.find((x) => x.start_min < sh.end_min && sh.start_min < x.end_min);
      sel.appendChild(el('option', { value: String(v.id), text: v.name + (busy ? ` (schon ${busy.position_name})` : ''), disabled: !!busy }));
    }
    $('#add-new').hidden = false;
    addDlg.showModal();
  }
  $('#add-existing').addEventListener('change', (e) => ($('#add-new').hidden = !!e.target.value));
  $('#add-cancel').addEventListener('click', () => addDlg.close());
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = addForm;
    const body = { shiftId: addTarget.id, note: f.note.value };
    if (f.volunteerId.value) body.volunteerId = Number(f.volunteerId.value);
    else Object.assign(body, { name: f.name.value, email: f.email.value, phone: f.phone.value });
    try {
      await api('POST', '/api/admin/signups', body);
      addDlg.close();
      toast('Eingetragen.');
      reload();
    } catch (ex) {
      $('#add-error').textContent = ex.message;
    }
  });

  // ---------- Helfer ----------
  function renderVolunteers() {
    const q = $('#vol-search').value.trim().toLowerCase();
    const list = data.volunteers.filter((v) => !q || [v.name, v.email, v.phone].join(' ').toLowerCase().includes(q));
    $('#vol-count').textContent = `${data.volunteers.length} Helfer`;
    const table = clear($('#vol-table'));
    table.appendChild(el('tr', null, ['Name', 'E-Mail', 'Telefon', 'Schichten', ''].map((t) => el('th', { text: t }))));
    if (!list.length) table.appendChild(el('tr', null, [el('td', { colspan: '5', class: 'muted', text: q ? 'Keine Treffer.' : 'Noch niemand angemeldet.' })]));
    for (const v of list) {
      const input = (key, type) =>
        el('input', {
          type: type || 'text',
          value: v[key] || '',
          onchange: (e) => act(api('PUT', '/api/admin/volunteers/' + v.id, { [key]: e.target.value }), 'Gespeichert.')
        });
      table.appendChild(
        el('tr', null, [
          el('td', null, [input('name')]),
          el('td', null, [input('email', 'email')]),
          el('td', null, [input('phone', 'tel')]),
          el('td', { class: 'small' }, v.shifts.length ? v.shifts.map((s) => el('div', { text: `${range(s.start_min, s.end_min)} ${s.position_name}` })) : [el('span', { class: 'muted', text: '–' })]),
          el('td', null, [
            el('div', { class: 'row' }, [
              el('button', { class: 'icon small', title: 'Persönlichen Link kopieren, um ihn der Person zu schicken', text: 'Link', onclick: (e) => copy(personalLink(v.token), e.target) }),
              el('button', {
                class: 'icon danger',
                title: 'Löschen',
                text: '✕',
                onclick: () => {
                  if (confirm(`${v.name} und alle Schichten dieser Person löschen?`)) act(api('DELETE', '/api/admin/volunteers/' + v.id), 'Gelöscht.');
                }
              })
            ])
          ])
        ])
      );
    }
  }
  $('#vol-search').addEventListener('input', renderVolunteers);

  // ---------- Positionen ----------
  $('#new-position').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const ok = await act(
        api('POST', '/api/admin/positions', {
          name: f.name.value,
          start: f.start.value,
          end: f.end.value,
          shiftCount: Number(f.shiftCount.value),
          peoplePerShift: Number(f.peoplePerShift.value)
        }),
        'Position angelegt.'
      );
    if (ok) f.name.value = '';
  });

  function renderPositions() {
    const box = clear($('#position-list'));
    data.positions.forEach((p, idx) => {
      const f = el('form', { class: 'form-grid' }, [
        el('label', null, ['Name', el('input', { name: 'name', value: p.name, maxlength: '80', required: true })]),
        el('label', null, ['Beginn', el('input', { name: 'start', type: 'time', value: time(p.start_min), required: true })]),
        el('label', null, ['Ende', el('input', { name: 'end', type: 'time', value: time(p.end_min), required: true })]),
        el('label', null, ['Anzahl Schichten', el('input', { name: 'shiftCount', type: 'number', min: '1', max: '24', value: String(p.shift_count) })]),
        el('label', null, ['Helfer pro Schicht', el('input', { name: 'peoplePerShift', type: 'number', min: '1', max: '100', value: String(p.people_per_shift) })])
      ]);
      const desc = el('textarea', { name: 'description', maxlength: '500', rows: '2', placeholder: 'z. B. Aufgaben, Treffpunkt, was mitzubringen ist' });
      desc.value = p.description || '';
      const visible = el('input', { type: 'checkbox', checked: !!p.visible });

      async function save(force) {
        const body = {
          name: f.name.value,
          start: f.start.value,
          end: f.end.value,
          shiftCount: Number(f.shiftCount.value),
          peoplePerShift: Number(f.peoplePerShift.value),
          description: desc.value,
          visible: visible.checked,
          force: !!force
        };
        try {
          await api('PUT', '/api/admin/positions/' + p.id, body);
          toast('Gespeichert.');
          reload();
        } catch (e) {
          if (e.data && e.data.needsForce && confirm(e.message + '\n\nTrotzdem neu aufteilen?')) return save(true);
          toast(e.message, 'error');
        }
      }

      const shiftTable = el('table', { class: 'shift-edit' }, [
        el('tr', null, ['Beginn', 'Ende', 'Plätze', 'Belegt', ''].map((t) => el('th', { text: t })))
      ]);
      for (const sh of p.shifts) {
        const start = el('input', { type: 'time', value: time(sh.start_min) });
        const end = el('input', { type: 'time', value: time(sh.end_min) });
        const cap = el('input', { type: 'number', min: '1', max: '100', value: String(sh.capacity) });
        const upd = () =>
          act(api('PUT', '/api/admin/shifts/' + sh.id, { start: start.value, end: end.value, capacity: Number(cap.value) }), 'Schicht gespeichert.');
        [start, end, cap].forEach((i) => i.addEventListener('change', upd));
        shiftTable.appendChild(
          el('tr', null, [
            el('td', null, [start]),
            el('td', null, [end]),
            el('td', null, [cap]),
            el('td', { text: String(sh.signups.length) }),
            el('td', null, [
              el('button', {
                class: 'icon danger',
                title: 'Schicht löschen',
                text: '✕',
                onclick: () => {
                  const msg = sh.signups.length
                    ? `In dieser Schicht sind ${sh.signups.length} Person(en) eingetragen. Schicht samt Anmeldungen löschen?`
                    : 'Schicht löschen?';
                  if (confirm(msg)) act(api('DELETE', '/api/admin/shifts/' + sh.id), 'Schicht gelöscht.');
                }
              })
            ])
          ])
        );
      }

      const move = (dir) => {
        const ids = data.positions.map((x) => x.id);
        const [m] = ids.splice(idx, 1);
        ids.splice(idx + dir, 0, m);
        act(api('POST', '/api/admin/positions/reorder', { ids }));
      };

      box.appendChild(
        el('section', { class: 'card pos-edit' + (p.visible ? '' : ' hidden-pos') }, [
          el('div', { class: 'row', style: 'margin-bottom:10px' }, [
            el('h2', { text: p.name, style: 'margin:0' }),
            p.visible ? null : el('span', { class: 'badge full', text: 'ausgeblendet' }),
            el('span', { class: 'spacer' }),
            el('button', { class: 'icon', title: 'Nach oben', text: '↑', disabled: idx === 0, onclick: () => move(-1) }),
            el('button', { class: 'icon', title: 'Nach unten', text: '↓', disabled: idx === data.positions.length - 1, onclick: () => move(1) })
          ]),
          f,
          el('div', { class: 'form-stack' }, [
            el('label', null, ['Beschreibung (für Helfer sichtbar)', desc]),
            el('label', { class: 'check' }, [visible, 'Auf der Anmeldeseite anzeigen'])
          ]),
          el('div', { class: 'row', style: 'margin-bottom:14px' }, [
            el('button', { class: 'primary', text: 'Position speichern', onclick: () => save(false) }),
            el('span', { class: 'spacer' }),
            el('button', {
              class: 'danger',
              text: 'Position löschen',
              onclick: () => {
                const n = p.shifts.reduce((a, sh) => a + sh.signups.length, 0);
                if (confirm(`Position „${p.name}“${n ? ` mit ${n} Anmeldung(en)` : ''} wirklich löschen?`)) act(api('DELETE', '/api/admin/positions/' + p.id), 'Position gelöscht.');
              }
            })
          ]),
          el('details', null, [
            el('summary', { text: `Schichten einzeln bearbeiten (${p.shifts.map((sh) => range(sh.start_min, sh.end_min)).join(', ')})` }),
            el('div', { class: 'table-wrap', style: 'margin-top:8px' }, [shiftTable]),
            el('button', {
              class: 'icon',
              style: 'margin-top:8px',
              text: '+ Schicht hinzufügen',
              onclick: () => {
                const last = p.shifts[p.shifts.length - 1];
                const s = last ? last.end_min : p.start_min;
                const e = Math.min(s + 120, 24 * 60);
                if (e <= s) return toast('Bitte die Zeiten der letzten Schicht anpassen.', 'error');
                act(api('POST', `/api/admin/positions/${p.id}/shifts`, { start: time(s), end: time(e) }), 'Schicht hinzugefügt.');
              }
            })
          ])
        ])
      );
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        save(false);
      });
    });
  }

  // ---------- Einstellungen ----------
  function renderSettings() {
    const f = $('#settings');
    const s = data.settings;
    // Nicht überschreiben, während jemand tippt
    if (!f.contains(document.activeElement)) {
      f.event_name.value = s.event_name || '';
      f.event_date.value = s.event_date || '';
      f.intro_text.value = s.intro_text || '';
      f.contact_info.value = s.contact_info || '';
      f.signup_open.checked = s.signup_open;
      f.show_names.checked = s.show_names;
    }
    $('#public-link').value = location.origin + '/';
  }
  $('#copy-public').addEventListener('click', (e) => copy($('#public-link').value, e.target));
  $('#settings').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    act(
      api('PUT', '/api/admin/settings', {
        event_name: f.event_name.value,
        event_date: f.event_date.value,
        intro_text: f.intro_text.value,
        contact_info: f.contact_info.value,
        signup_open: f.signup_open.checked,
        show_names: f.show_names.checked
      }),
      'Einstellungen gespeichert.'
    );
  });

  init().catch((e) => toast(e.message, 'error'));
})();

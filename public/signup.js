(function () {
  'use strict';
  const { el, $, clear, range, duration, date, api, token, personalLink, copy } = window.H;

  let data = null;
  let currentShift = null;
  let useKnown = false;

  const dlg = $('#signup-dialog');
  const form = $('#signup-form');
  const doneDlg = $('#done-dialog');

  function headers() {
    const t = token.get();
    return t ? { 'X-Volunteer-Token': t } : {};
  }

  async function load() {
    try {
      data = await api('GET', '/api/event', null, headers());
    } catch (e) {
      clear($('#positions')).appendChild(el('p', { class: 'error', text: 'Die Schichten konnten nicht geladen werden: ' + e.message }));
      return;
    }
    if (!data.me && token.get()) token.clear(); // Link ungültig geworden (z. B. vom Admin gelöscht)
    render();
  }

  function render() {
    const s = data.settings;
    document.title = 'Helfer-Anmeldung – ' + (s.event_name || '');
    $('#event-name').textContent = s.event_name || 'Helfer-Anmeldung';
    $('#event-date').textContent = date(s.event_date);
    $('#intro').hidden = !s.intro_text && !s.contact_info;
    $('#intro-text').textContent = s.intro_text || '';
    $('#contact-info').textContent = s.contact_info || '';
    $('#closed').hidden = s.signup_open;

    const banner = clear($('#me-banner'));
    if (data.me) {
      const mine = data.positions.reduce((n, p) => n + p.shifts.filter((x) => x.mine).length, 0);
      banner.appendChild(
        el('div', { class: 'card notice row' }, [
          el('span', null, ['Hallo ', el('strong', { text: data.me.name }), mine ? ` – du bist für ${mine} Schicht${mine > 1 ? 'en' : ''} eingetragen.` : '.']),
          el('span', { class: 'spacer' }),
          el('a', { class: 'button', href: personalLink(token.get()), text: 'Meine Schichten' })
        ])
      );
    }

    const onlyFree = $('#only-free').checked;
    const box = clear($('#positions'));
    let shown = 0;
    for (const p of data.positions) {
      const shifts = p.shifts.filter((sh) => !onlyFree || sh.taken < sh.capacity || sh.mine);
      if (!shifts.length) continue;
      shown++;
      const free = p.shifts.reduce((n, sh) => n + Math.max(0, sh.capacity - sh.taken), 0);
      box.appendChild(
        el('section', { class: 'card position' }, [
          el('div', { class: 'position-head' }, [
            el('div', { class: 'row' }, [
              el('h2', { text: p.name, style: 'margin:0' }),
              el('span', { class: 'spacer' }),
              el('span', { class: 'badge ' + (free ? 'open' : 'full'), text: free ? free + ' frei' : 'voll besetzt' })
            ]),
            p.description ? el('p', { class: 'muted pre', style: 'margin:6px 0 0', text: p.description }) : null
          ]),
          ...shifts.map((sh) => shiftRow(p, sh))
        ])
      );
    }
    if (!shown) box.appendChild(el('p', { class: 'muted', text: onlyFree ? 'Alle Schichten sind besetzt – vielen Dank!' : 'Noch keine Schichten angelegt.' }));
  }

  function shiftRow(p, sh) {
    const free = sh.capacity - sh.taken;
    const full = free <= 0;
    let action;
    if (sh.mine) action = el('span', { class: 'badge', text: '✓ Du bist eingetragen' });
    else if (full) action = el('button', { disabled: true, text: 'Voll' });
    else if (!data.settings.signup_open) action = el('button', { disabled: true, text: 'Geschlossen' });
    else action = el('button', { class: 'primary', text: 'Eintragen', onclick: () => openDialog(p, sh) });

    return el('div', { class: 'shift-row' + (full ? ' full' : '') + (sh.mine ? ' mine' : '') }, [
      el('div', { class: 'shift-time' }, [range(sh.start, sh.end), el('div', { class: 'muted small', text: duration(sh.start, sh.end) })]),
      el('div', { class: 'shift-info' }, [
        el('div', { text: full ? `Alle ${sh.capacity} Plätze belegt` : `${free} von ${sh.capacity} Plätzen frei` }),
        el('div', { class: 'bar' }, [el('span', { style: `width:${Math.min(100, (sh.taken / sh.capacity) * 100)}%` })]),
        sh.names && sh.names.length ? el('div', { class: 'muted small', text: 'Dabei: ' + sh.names.join(', ') }) : null
      ]),
      action
    ]);
  }

  function setKnownMode(on) {
    useKnown = on;
    $('#dlg-known').hidden = !on;
    $('#dlg-new').hidden = on;
    if (on) $('#dlg-known-name').textContent = data.me.name;
  }

  function openDialog(p, sh) {
    currentShift = { position: p, shift: sh };
    form.reset();
    $('#dlg-error').textContent = '';
    $('#dlg-shift').textContent = `${p.name} · ${range(sh.start, sh.end)} Uhr` + (data.settings.event_date ? ' · ' + date(data.settings.event_date) : '');
    setKnownMode(!!data.me);
    dlg.showModal();
    (useKnown ? form.note : form.name).focus();
  }

  $('#dlg-someone-else').addEventListener('click', () => {
    setKnownMode(false);
    form.name.focus();
  });
  $('#dlg-cancel').addEventListener('click', () => dlg.close());
  $('#only-free').addEventListener('change', render);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#dlg-error');
    err.textContent = '';
    const body = { shiftId: currentShift.shift.id, note: form.note.value, website: form.website.value };
    if (useKnown) {
      body.token = token.get();
    } else {
      body.name = form.name.value;
      body.email = form.email.value;
      body.phone = form.phone.value;
      if (!body.name.trim()) return (err.textContent = 'Bitte gib deinen Namen an.');
      if (!body.email.trim() && !body.phone.trim()) return (err.textContent = 'Bitte E-Mail oder Telefonnummer angeben.');
    }
    const btn = $('#dlg-submit');
    btn.disabled = true;
    try {
      const res = await api('POST', '/api/signup', body);
      // Neues Gerät oder erste Anmeldung: persönlichen Zugang merken.
      // Trägt jemand eine andere Person ein, bleibt der eigene Zugang erhalten.
      if (!token.get() || !data.me) token.set(res.token);
      dlg.close();
      showDone(res);
      await load();
    } catch (ex) {
      err.textContent = ex.message;
      if (ex.status === 409 || ex.status === 403) load();
    } finally {
      btn.disabled = false;
    }
  });

  function showDone(res) {
    const { position, shift } = currentShift;
    const own = res.token === token.get();
    $('#done-text').textContent =
      `${res.name} ist für ${position.name} von ${range(shift.start, shift.end)} Uhr eingetragen.` +
      (own ? '' : ' (Du hast eine andere Person eingetragen – gib ihr bitte den Link unten weiter.)');
    const link = personalLink(res.token);
    $('#done-link').value = link;
    $('#done-me').href = link;
    $('#done-me').hidden = !own;
    doneDlg.showModal();
  }
  $('#done-copy').addEventListener('click', (e) => copy($('#done-link').value, e.target));

  load();
  // Aktualisieren, wenn man zur Seite zurückkehrt, damit die freien Plätze stimmen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !dlg.open && !doneDlg.open) load();
  });
})();

(function () {
  'use strict';
  const { el, $, clear, range, duration, date, api, token, personalLink, copy, toast } = window.H;

  // Der Link enthält den persönlichen Zugang: ?t=...
  const fromUrl = new URLSearchParams(location.search).get('t');
  const myToken = fromUrl || token.get();
  if (fromUrl) token.set(fromUrl);
  const headers = () => ({ 'X-Volunteer-Token': myToken });

  async function load() {
    const box = $('#content');
    if (!myToken) {
      clear(box).appendChild(
        el('div', { class: 'card' }, [
          el('p', { text: 'Auf diesem Gerät ist keine Anmeldung gespeichert. Öffne bitte deinen persönlichen Link, den du nach dem Eintragen bekommen hast.' }),
          el('a', { class: 'button primary', href: '/', text: 'Zur Schichtübersicht' })
        ])
      );
      return;
    }
    let data;
    try {
      data = await api('GET', '/api/me', null, headers());
    } catch (e) {
      if (e.status === 401 && token.get() === myToken) token.clear();
      clear(box).appendChild(
        el('div', { class: 'card notice warn' }, [
          el('p', { text: e.message }),
          el('a', { class: 'button', href: '/', text: 'Zur Schichtübersicht' })
        ])
      );
      return;
    }
    render(data);
  }

  function render(data) {
    const s = data.settings;
    $('#event').textContent = [s.event_name, date(s.event_date)].filter(Boolean).join(' · ');
    const box = clear($('#content'));

    // Schichten
    const list = el('section', { class: 'card' }, [el('h2', { text: `Hallo ${data.volunteer.name}!` })]);
    if (!data.signups.length) {
      list.appendChild(el('p', { class: 'muted', text: 'Du bist aktuell für keine Schicht eingetragen.' }));
    } else {
      list.appendChild(el('p', { text: `Du bist für ${data.signups.length} Schicht${data.signups.length > 1 ? 'en' : ''} eingetragen:` }));
      for (const sg of data.signups) {
        list.appendChild(
          el('div', { class: 'my-shift' }, [
            el('div', { class: 'shift-time' }, [range(sg.start_min, sg.end_min), el('div', { class: 'muted small', text: duration(sg.start_min, sg.end_min) })]),
            el('div', { class: 'shift-info' }, [el('strong', { text: sg.position_name }), sg.note ? el('div', { class: 'muted small', text: sg.note }) : null]),
            el('button', {
              class: 'danger',
              text: 'Absagen',
              onclick: async () => {
                if (!confirm(`Schicht ${sg.position_name} ${range(sg.start_min, sg.end_min)} wirklich absagen?`)) return;
                try {
                  await api('DELETE', '/api/me/signups/' + sg.id, null, headers());
                  toast('Schicht abgesagt.');
                  load();
                } catch (e) {
                  toast(e.message, 'error');
                }
              }
            })
          ])
        );
      }
    }
    list.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [el('a', { class: 'button primary', href: '/', text: 'Weitere Schicht eintragen' })]));
    box.appendChild(list);

    // Persönlicher Link
    const link = personalLink(myToken);
    const linkInput = el('input', { readonly: true, value: link });
    box.appendChild(
      el('section', { class: 'card' }, [
        el('h2', { text: 'Dein persönlicher Link' }),
        el('p', { class: 'muted', text: 'Speichere diesen Link als Lesezeichen, um deine Schichten auch von einem anderen Gerät zu verwalten. Gib ihn nicht weiter.' }),
        el('div', { class: 'linkbox' }, [linkInput, el('button', { text: 'Kopieren', onclick: (e) => copy(link, e.target) })])
      ])
    );

    // Kontaktdaten
    const f = el('form', { class: 'card', novalidate: true }, [
      el('h2', { text: 'Meine Kontaktdaten' }),
      el('div', { class: 'form-grid' }, [
        el('label', null, ['Name', el('input', { name: 'name', value: data.volunteer.name, maxlength: '80', autocomplete: 'name' })]),
        el('label', null, ['E-Mail', el('input', { name: 'email', type: 'email', value: data.volunteer.email, maxlength: '200', autocomplete: 'email' })]),
        el('label', null, ['Telefon', el('input', { name: 'phone', type: 'tel', value: data.volunteer.phone, maxlength: '40', autocomplete: 'tel' })])
      ]),
      el('button', { type: 'submit', text: 'Speichern' })
    ]);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/me', { name: f.name.value, email: f.email.value, phone: f.phone.value }, headers());
        toast('Gespeichert.');
        load();
      } catch (ex) {
        toast(ex.message, 'error');
      }
    });
    box.appendChild(f);
    if (s.contact_info) box.appendChild(el('p', { class: 'muted pre small', text: s.contact_info }));
  }

  load();
})();

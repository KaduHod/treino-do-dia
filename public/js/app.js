/* Comportamentos que o HTMX não cobre: atalhos de data, modal e feedback de erros. */
(function () {
  const DATE_INPUT_ID = 'day-date';
  const TOAST_ID = 'toast';
  const THEME_KEY = 'treino-theme';
  const THEMES = ['terroso', 'meia-noite', 'oceano', 'ameixa', 'carmim'];
  const SAVED_FEEDBACK_MS = 2500;

  let savedTimers = [];

  function dayInput() {
    return document.getElementById(DATE_INPUT_ID);
  }

  function themeSelect() {
    return document.getElementById('theme-select');
  }

  function applyTheme(name, persist = true) {
    const theme = THEMES.includes(name) ? name : THEMES[0];
    document.documentElement.dataset.theme = theme;

    const select = themeSelect();
    if (select && select.value !== theme) select.value = theme;

    if (!persist) return;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* localStorage indisponível: tema vale só para esta página */
    }
  }

  function syncThemeSelect() {
    applyTheme(document.documentElement.dataset.theme, false);
  }

  function openDialog(dialog) {
    if (!dialog || dialog.tagName !== 'DIALOG') return;
    if (!dialog.innerHTML.trim()) return;
    if (!dialog.open) dialog.showModal();
  }

  function closeDialogFrom(element) {
    const dialog = element?.closest?.('dialog');
    if (dialog) dialog.close();
  }

  function toast(message) {
    const el = document.getElementById(TOAST_ID);
    if (!el || !message) return;

    const text = String(message).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    el.textContent = text.length > 220 ? `${text.slice(0, 217)}...` : text;
    el.classList.remove('hidden');

    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 4000);
  }

  function formatISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function todayISO() {
    return formatISO(new Date());
  }

  function shiftISO(value, days) {
    const base = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : todayISO();
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + Number(days));
    return formatISO(date);
  }

  function loadDate(value) {
    const input = dayInput();
    if (!input || !value) return;
    input.value = value;
    if (window.htmx) window.htmx.trigger(input, 'change');
  }

  function syncDateInput() {
    const input = dayInput();
    const panel = document.getElementById('day-panel');
    if (!input || !panel) return;

    const panelDate = panel.dataset.date;
    if (panelDate && input.value !== panelDate) input.value = panelDate;
  }

  function clearSavedFeedback() {
    savedTimers.forEach(clearTimeout);
    savedTimers = [];

    document.querySelectorAll('[data-saved]').forEach((el) => {
      savedTimers.push(
        setTimeout(() => {
          el.remove();
        }, SAVED_FEEDBACK_MS),
      );
    });
  }

  document.addEventListener('click', (event) => {
    const shiftButton = event.target.closest('[data-date-shift]');
    if (shiftButton) {
      loadDate(shiftISO(dayInput()?.value, shiftButton.dataset.dateShift));
      return;
    }

    if (event.target.closest('[data-date-today]')) {
      loadDate(todayISO());
      return;
    }

    if (event.target.closest('[data-modal-close]')) {
      closeDialogFrom(event.target);
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'theme-select') applyTheme(event.target.value);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  });

  document.addEventListener('click', (event) => {
    // Clique no backdrop do <dialog> fecha o modal.
    if (event.target.tagName === 'DIALOG' && event.target.open) event.target.close();
  });

  document.addEventListener('htmx:afterSwap', (event) => {
    const target = event.target;

    openDialog(target);

    if (target.id === 'content' || target.id === 'day-panel') {
      syncDateInput();
    }

    clearSavedFeedback();
  });

  document.addEventListener('htmx:responseError', (event) => {
    const xhr = event.detail?.xhr;
    const status = xhr?.status ? ` (HTTP ${xhr.status})` : '';
    toast(xhr?.responseText || `Não foi possível concluir a ação${status}.`);
  });

  document.addEventListener('htmx:sendError', () => {
    toast('Falha de conexão com o servidor. Verifique se o app está rodando.');
  });

  document.addEventListener('htmx:timeout', () => {
    toast('O servidor demorou demais para responder.');
  });

  syncDateInput();
  syncThemeSelect();
})();

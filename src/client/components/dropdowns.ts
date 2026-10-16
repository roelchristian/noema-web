/** Keep native selects as the form/data source while presenting a consistent menu. */
export function enhanceDropdowns(host: HTMLElement) {
  const controls = new Map<HTMLSelectElement, { sync: () => void; destroy: () => void }>();
  let serial = 0;

  function enhance(select: HTMLSelectElement) {
    if (controls.has(select) || select.multiple || select.size > 1) return;
    const wrapper = document.createElement('span');
    wrapper.className = 'select-control';
    select.before(wrapper);
    wrapper.append(select);
    select.classList.add('select-native');
    const originalTabIndex = select.tabIndex;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const value = document.createElement('span');
    value.className = 'select-value';
    const chevron = document.createElement('span');
    chevron.className = 'select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(value, chevron);
    const menu = document.createElement('div');
    menu.className = 'select-menu';
    menu.id = `select-menu-${++serial}`;
    menu.popover = 'auto';
    menu.setAttribute('role', 'listbox');
    trigger.setAttribute('aria-controls', menu.id);
    wrapper.append(trigger, menu);
    let active = -1;
    let search = '';
    let lastKey = 0;
    const isOpen = () => menu.matches(':popover-open');
    const options = () => Array.from(select.options);
    const available = (option: HTMLOptionElement) => !option.disabled && !option.hidden && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
    function sync() {
      value.textContent = select.selectedOptions[0]?.textContent || 'Choose an option…';
      trigger.disabled = select.disabled;
      trigger.setAttribute('aria-required', String(select.required));
      const label = select.getAttribute('aria-label') || Array.from(select.labels || []).map(label => Array.from(label.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()).join(' ') || select.name || 'Choose an option';
      trigger.setAttribute('aria-label', label);
      menu.setAttribute('aria-label', label);
      wrapper.hidden = select.hidden;
    }
    function highlight(index: number) {
      active = index;
      Array.from(menu.children).forEach((row, i) => row.classList.toggle('is-active', i === active));
      const row = menu.children[active];
      if (row) {
        trigger.setAttribute('aria-activedescendant', row.id);
        row.scrollIntoView({ block: 'nearest' });
      } else trigger.removeAttribute('aria-activedescendant');
    }
    function close() {
      if (isOpen()) menu.hidePopover();
    }
    function choose(index: number) {
      if (!options()[index] || !available(options()[index])) return;
      select.selectedIndex = index;
      sync();
      close();
      trigger.focus();
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function open() {
      if (trigger.disabled) return;
      sync();
      menu.replaceChildren(...options().map((option, index) => {
        const row = document.createElement('div');
        row.className = 'select-option';
        row.id = `${menu.id}-${index}`;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(option.selected));
        row.setAttribute('aria-disabled', String(!available(option)));
        row.hidden = option.hidden;
        const text = document.createElement('span');
        text.textContent = option.textContent;
        const check = document.createElement('span');
        check.className = 'select-check';
        check.textContent = option.selected ? '✓' : '';
        check.setAttribute('aria-hidden', 'true');
        row.append(text, check);
        row.addEventListener('pointermove', () => { if (available(option)) highlight(index); });
        row.addEventListener('click', event => { event.preventDefault(); choose(index); });
        return row;
      }));
      menu.showPopover();
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < Math.min(menu.scrollHeight, 240) && above > below;
      menu.style.width = `${Math.min(Math.max(rect.width, 200), window.innerWidth - 24)}px`;
      menu.style.maxHeight = `${Math.max(0, Math.min(300, upwards ? above : below))}px`;
      menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 12))}px`;
      menu.style.top = `${upwards ? rect.top - menu.offsetHeight - 5 : rect.bottom + 5}px`;
      trigger.setAttribute('aria-expanded', 'true');
      highlight(select.selectedIndex);
    }
    trigger.addEventListener('click', event => {
      event.preventDefault();
      trigger.focus();
      if (isOpen()) close(); else open();
    });
    trigger.addEventListener('keydown', event => {
      const list = options();
      if (event.key === 'Escape') {
        if (isOpen()) { event.preventDefault(); event.stopPropagation(); close(); }
        return;
      }
      if (event.key === 'Tab') { close(); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        if (!isOpen()) { open(); return; }
        const enabled = list.map((option, index) => available(option) ? index : -1).filter(index => index >= 0);
        const position = enabled.indexOf(active);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (position + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
        highlight(enabled[next] ?? -1);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (isOpen()) choose(active); else open();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (!isOpen()) open();
        search = Date.now() - lastKey > 600 ? event.key : search + event.key;
        lastKey = Date.now();
        const match = list.findIndex(option => available(option) && option.text.toLowerCase().startsWith(search.toLowerCase()));
        if (match >= 0) highlight(match);
      }
    });
    menu.addEventListener('toggle', () => {
      trigger.setAttribute('aria-expanded', String(isOpen()));
      if (!isOpen()) trigger.removeAttribute('aria-activedescendant');
    });
    const reset = () => queueMicrotask(sync);
    const invalid = (event: Event) => { event.preventDefault(); trigger.focus(); open(); };
    select.addEventListener('change', sync);
    select.addEventListener('invalid', invalid);
    select.form?.addEventListener('reset', reset);
    window.addEventListener('resize', close);
    const onScroll = (event: Event) => { if (!menu.contains(event.target as Node)) close(); };
    document.addEventListener('scroll', onScroll, true);
    controls.set(select, { sync, destroy() {
      close();
      select.removeEventListener('change', sync);
      select.removeEventListener('invalid', invalid);
      select.form?.removeEventListener('reset', reset);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', onScroll, true);
      select.classList.remove('select-native');
      select.tabIndex = originalTabIndex;
      select.removeAttribute('aria-hidden');
      wrapper.before(select);
      wrapper.remove();
    } });
    sync();
  }
  const scan = () => {
    for (const [select, control] of controls) {
      if (!host.contains(select)) { control.destroy(); controls.delete(select); }
    }
    host.querySelectorAll('select').forEach(enhance);
  };
  scan();
  const observer = new MutationObserver(records => {
    scan();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const select = target?.closest('select');
      if (select) controls.get(select)?.sync();
    }
  });
  observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'selected', 'required', 'label'] });
  return () => { observer.disconnect(); controls.forEach(control => control.destroy()); controls.clear(); };
}

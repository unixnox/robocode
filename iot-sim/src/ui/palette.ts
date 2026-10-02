import { CATEGORIES, COMPONENTS } from '../components/registry';

export function buildPalette(el: HTMLElement, onAdd: (type: string) => void) {
  el.innerHTML = '';
  for (const cat of CATEGORIES) {
    const h = document.createElement('h3');
    h.textContent = cat.title;
    el.appendChild(h);
    for (const def of COMPONENTS.filter((c) => c.category === cat.id)) {
      const item = document.createElement('div');
      item.className = 'item';
      item.draggable = true;
      item.title = def.desc;
      item.dataset.type = def.type;
      item.innerHTML = `<span class="ico"></span><span><span class="name"></span><small></small></span>`;
      item.querySelector('.ico')!.textContent = def.icon;
      item.querySelector('.name')!.textContent = def.title;
      item.querySelector('small')!.textContent = def.pins.map((p) => p.label).join(' · ');
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer!.setData('text/x-component', def.type);
        e.dataTransfer!.effectAllowed = 'copy';
      });
      item.addEventListener('click', () => onAdd(def.type));
      el.appendChild(item);
    }
  }
}

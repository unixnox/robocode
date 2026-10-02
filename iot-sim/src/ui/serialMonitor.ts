const MAX_CHARS = 60_000;

export class SerialMonitor {
  private pending = '';
  private raf = 0;

  constructor(private out: HTMLElement, private autoscroll: HTMLInputElement) {}

  write(text: string) {
    this.pending += text.replace(/\r\n/g, '\n').replace(/\r/g, '');
    if (!this.raf) this.raf = requestAnimationFrame(() => this.flush());
  }

  private flush() {
    this.raf = 0;
    if (!this.pending) return;
    const last = this.out.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) last.textContent += this.pending;
    else this.out.appendChild(document.createTextNode(this.pending));
    this.pending = '';
    this.trim();
    if (this.autoscroll.checked) this.out.scrollTop = this.out.scrollHeight;
  }

  /** System message (not from the firmware). */
  system(text: string, cls: 'sys' | 'err' | 'info' = 'sys') {
    this.flush();
    const atLineStart = !this.out.textContent || this.out.textContent.endsWith('\n');
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = `${atLineStart ? '' : '\n'}${text}\n`;
    this.out.appendChild(span);
    this.trim();
    if (this.autoscroll.checked) this.out.scrollTop = this.out.scrollHeight;
  }

  private trim() {
    while ((this.out.textContent?.length ?? 0) > MAX_CHARS && this.out.firstChild) this.out.removeChild(this.out.firstChild);
  }

  clear() {
    this.pending = '';
    this.out.textContent = '';
  }

  get text() { return this.out.textContent ?? ''; }
}

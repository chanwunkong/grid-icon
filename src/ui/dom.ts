/** Create an element with attributes and children. */
export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};

/** Ask for one file; resolves with nothing if the picker is dismissed. */
export function pickFile(accept: string, onFile: (file: File) => void) {
  const input = h('input', { type: 'file', accept }) as HTMLInputElement;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  };
  input.click();
}

/** A setting kept in this browser; storage may be unavailable (private mode), then the default is used. */
export const stored = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* the choice lasts until the reload */
    }
  },
};

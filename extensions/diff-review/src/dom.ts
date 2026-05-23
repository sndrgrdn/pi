export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = String(value);
    else if (key === "textContent") node.textContent = String(value);
    else if (key === "html") node.innerHTML = String(value);
    else if (key === "value" && "value" in node) (node as HTMLInputElement).value = String(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (typeof value === "boolean") node.setAttribute(key, String(value));
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

export function icon(path: string): HTMLElement {
  return el("span", { html: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">${path}</svg>` });
}

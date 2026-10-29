import header from '../partials/header.html?raw';
import footer from '../partials/footer.html?raw';

const ACTIVE = 'style="color:var(--text);font-weight:600;"';

// Inserts the shared header and footer and marks the current page in the nav.
export function withHeader(raw: string, pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  let h = header;
  if (path === '/about-us' || path === '/contact') {
    h = h.replace(`<a href="${path}">`, `<a href="${path}" aria-current="page" ${ACTIVE}>`);
  } else if (path !== '/') {
    const link = `<a href="${path}">`;
    if (h.includes(link)) {
      h = h.replace(link, `<a href="${path}" aria-current="page">`)
           .replace('class="nav-dd-btn"', 'class="nav-dd-btn is-current"');
    }
  }
  return raw.replace('<!--@header-->', h).replace('<!--@footer-->', footer);
}

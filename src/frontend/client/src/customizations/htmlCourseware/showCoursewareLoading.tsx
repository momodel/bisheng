import { renderToStaticMarkup } from 'react-dom/server';
import { Outlined } from 'bisheng-icons';

export function showCoursewareLoading(tab: Window, message: string) {
  const doc = tab.document;
  const sourceStyle = getComputedStyle(document.body);
  doc.title = message;
  doc.documentElement.lang = document.documentElement.lang;
  doc.body.style.margin = '0';
  doc.body.style.fontFamily = sourceStyle.fontFamily;
  doc.body.style.fontSize = sourceStyle.fontSize;
  doc.body.style.color = sourceStyle.color;
  doc.body.style.backgroundColor = sourceStyle.backgroundColor;

  // The reserved about:blank tab has no application stylesheet.
  const style = doc.createElement('style');
  style.textContent = `
    @keyframes courseware-loading-spin { to { transform: rotate(360deg); } }
    .courseware-loading-icon { animation: courseware-loading-spin 1s linear infinite; }
    @media (prefers-reduced-motion: reduce) {
      .courseware-loading-icon { animation: none; }
    }
  `;
  doc.head.appendChild(style);
  doc.body.innerHTML = renderToStaticMarkup(
    <main role="status" aria-live="polite" aria-busy="true"
      style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
      <Outlined.Loading size={24} className="courseware-loading-icon" aria-hidden="true" />
      <span>{message}</span>
    </main>,
  );
}

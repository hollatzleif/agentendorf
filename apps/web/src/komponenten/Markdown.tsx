import { useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rohUrl } from '../api';
import { bibliothekUrl, linkKlick } from '../router';
import { alleDateien, ordnerVon, relativAufloesen, useBaum, wikilinkAufloesen } from '../vaultHilfen';

export function frontmatterTrennen(inhalt: string): { kopf: string | null; rumpf: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(inhalt);
  return m ? { kopf: m[1]!, rumpf: inhalt.slice(m[0].length) } : { kopf: null, rumpf: inhalt };
}

/** Markdown-Ansicht mit Obsidian-Wikilinks ([[Notiz]], [[Notiz|Text]], ![[Bild.png]]) und Vault-relativen Links. */
export function Markdown({ inhalt, pfad }: { inhalt: string; pfad: string }) {
  const baum = useBaum();
  const dateien = useMemo(() => alleDateien(baum.data), [baum.data]);
  const ordner = ordnerVon(pfad);
  const { kopf, rumpf } = frontmatterTrennen(inhalt);

  const vorbereitet = useMemo(
    () =>
      rumpf
        .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_m, name: string) => {
          const ziel = wikilinkAufloesen(name, dateien);
          return ziel ? `![${name}](dorfroh:${encodeURIComponent(ziel)})` : `*fehlt: ${name}*`;
        })
        .replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, name: string, _anker: string, text?: string) => {
          const ziel = wikilinkAufloesen(name, dateien);
          return ziel ? `[${text ?? name}](dorf:${encodeURIComponent(ziel)})` : `[${text ?? name}](dorffehlt:${encodeURIComponent(name)})`;
        }),
    [rumpf, dateien],
  );

  return (
    <div className="markdown">
      {kopf && (
        <details className="frontmatter">
          <summary>Eigenschaften</summary>
          <pre>{kopf}</pre>
        </details>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (/^(dorf|dorfroh|dorffehlt):/.test(url) ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href = '', children }) => {
            if (href.startsWith('dorffehlt:')) return <span className="link-fehlt" title="Notiz gibt es nicht">{children}</span>;
            if (href.startsWith('dorf:'))
              return (
                <a href={bibliothekUrl(decodeURIComponent(href.slice(5)))} onClick={linkKlick}>
                  {children}
                </a>
              );
            if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//'))
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            if (href.startsWith('#')) return <a href={href}>{children}</a>;
            return (
              <a href={bibliothekUrl(relativAufloesen(ordner, href.split('#')[0]!))} onClick={linkKlick}>
                {children}
              </a>
            );
          },
          img: ({ src = '', alt }) => {
            const s = String(src);
            let url = s;
            if (s.startsWith('dorfroh:')) url = rohUrl(decodeURIComponent(s.slice(8)));
            else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) url = rohUrl(relativAufloesen(ordner, s));
            return <img src={url} alt={alt ?? ''} loading="lazy" />;
          },
        }}
      >
        {vorbereitet}
      </ReactMarkdown>
    </div>
  );
}

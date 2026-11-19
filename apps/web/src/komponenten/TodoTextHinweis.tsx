import { todoAusText } from '@dorf/shared';

/** E127: zeigt live, was aus „Wäsche jeden Montag 30 min“ erkannt wird – bevor man Enter drückt */
export function TodoTextHinweis({ text, heute }: { text: string; heute: string }) {
  const e = todoAusText(text, heute);
  if (!text.trim() || (!e.wiederholen && !e.dauer && !e.wartet)) return null;
  const tag = e.faellig ? new Date(`${e.faellig}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }) : '';
  return (
    <p className="todo-text-hinweis leise" aria-live="polite">
      → „{e.titel}“{e.wiederholen && ` · 🔁 ${e.wiederholen}${tag ? ` ab ${tag}` : ''}`}
      {e.wartet && ` · ⏳ wartet auf ${e.wartet}`}
      {e.dauer && ` · ⏱ ${e.dauer >= 60 ? `${Math.floor(e.dauer / 60)} h${e.dauer % 60 ? ` ${e.dauer % 60} min` : ''}` : `${e.dauer} min`}`}
    </p>
  );
}

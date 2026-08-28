import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import {
  HELP,
  STATE_LABEL,
  searchHelp,
  type HelpEntry,
  type HelpState,
} from '../app/help';

/**
 * Help.
 *
 * Questions a person actually arrives with, answered in the order they hit
 * them. Search filters the whole set and opens what it finds, because
 * somebody searching already knows what they want.
 */

function StateTag({ state }: { state: HelpState }) {
  // The word carries the meaning. Colour only reinforces it.
  return <span className={`help-state st-${state}`}>{STATE_LABEL[state]}</span>;
}

function Entry({
  entry,
  open,
  onToggle,
  section,
}: {
  entry: HelpEntry;
  open: boolean;
  onToggle: () => void;
  section?: string;
}) {
  return (
    <li className={open ? 'help-entry open' : 'help-entry'}>
      <button type="button" onClick={onToggle} aria-expanded={open}>
        <ChevronDown size={15} className="help-caret" aria-hidden="true" />
        <span className="help-question">
          {entry.question}
          {section && <em>{section}</em>}
        </span>
        {entry.state && <StateTag state={entry.state} />}
      </button>

      {open && (
        <div className="help-answer">
          <p>{entry.answer}</p>

          {entry.points && (
            <ul>
              {entry.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          )}

          {entry.to && (
            <Link className="ghost-button" to={entry.to}>
              Open it
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

export default function Help() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set(['what']));

  const results = useMemo(() => searchHelp(query), [query]);
  const searching = query.trim().length > 0;

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="page help-page">
      <div className="help-search">
        <Search size={16} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the help. Try slack, roles, or schedule."
          aria-label="Search the help"
        />
        {searching && (
          <button type="button" className="icon-button" aria-label="Clear the search" onClick={() => setQuery('')}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {searching ? (
        <section className="help-section">
          <h2>
            {results.length} {results.length === 1 ? 'answer' : 'answers'}
          </h2>
          {results.length === 0 ? (
            <p className="help-blurb">
              Nothing matches that. Try a single word, such as slack, task, role, or schedule.
            </p>
          ) : (
            <ul className="help-list">
              {results.map((entry) => (
                <Entry
                  key={entry.id}
                  entry={entry}
                  section={entry.section}
                  // A person searching wants the answer, not another click.
                  open
                  onToggle={() => toggle(entry.id)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        HELP.map((section) => (
          <section className="help-section" key={section.id}>
            <h2>{section.title}</h2>
            <p className="help-blurb">{section.blurb}</p>
            <ul className="help-list">
              {section.entries.map((entry) => (
                <Entry
                  key={entry.id}
                  entry={entry}
                  open={open.has(entry.id)}
                  onToggle={() => toggle(entry.id)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <section className="help-foot">
        <h3>Still stuck?</h3>
        <p>
          Cerberus is open source. If something here is wrong, or an answer is missing, the fastest fix is to say
          so and it gets written.
        </p>
      </section>
    </div>
  );
}

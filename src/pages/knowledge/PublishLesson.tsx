import { type FormEvent, useEffect, useState } from 'react';
import { BookOpenText, Save, Video, X } from 'lucide-react';
import {
  ApiFailure,
  createKnowledgeResource,
  updateKnowledgeResource,
} from '../../app/api';
import {
  KNOWLEDGE_TOPICS,
  type KnowledgeLessonType,
  type KnowledgeResource,
  type KnowledgeTopic,
} from '../../../shared/knowledge';

type Props = {
  resource: KnowledgeResource | null;
  onClose: () => void;
  onSaved: (resource: KnowledgeResource) => void;
};

export default function PublishLesson({ resource, onClose, onSaved }: Props) {
  const [type, setType] = useState<KnowledgeLessonType>(resource?.type ?? 'video');
  const [topic, setTopic] = useState<KnowledgeTopic>(resource?.topic ?? 'foundations');
  const [title, setTitle] = useState(resource?.title ?? '');
  const [summary, setSummary] = useState(resource?.summary ?? '');
  const [body, setBody] = useState(resource?.body ?? '');
  const [sourceUrl, setSourceUrl] = useState(resource?.sourceUrl ?? '');
  const [durationMinutes, setDurationMinutes] = useState(resource?.durationMinutes ?? 5);
  const [published, setPublished] = useState(resource?.published ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});

    const payload = {
      type,
      topic,
      title: title.trim(),
      summary: summary.trim(),
      body: type === 'article' ? body.trim() : '',
      sourceUrl: type === 'video' ? sourceUrl.trim() : '',
      durationMinutes,
      published,
    };

    try {
      const saved = resource
        ? await updateKnowledgeResource(resource.id, payload)
        : await createKnowledgeResource(payload);
      onSaved(saved);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiFailure) {
        setError(caught.message);
        setFields(caught.fields);
      } else {
        setError('Cerberus could not save the lesson.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="panel-scrim" aria-label="Close" onClick={onClose} />
      <form className="kb-publisher" onSubmit={save} role="dialog" aria-modal="true" aria-label="Publish a lesson">
        <header className="kb-publisher-head">
          <div>
            <p className="kb-eyebrow">Knowledge editor</p>
            <h2>{resource ? 'Edit lesson' : 'Add a lesson'}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="kb-publisher-body">
          {error && <p className="auth-error" role="alert">{error}</p>}

          <fieldset className="kb-type-choice">
            <legend>Lesson type</legend>
            <button type="button" className={type === 'video' ? 'active' : ''} onClick={() => setType('video')}>
              <Video size={17} aria-hidden="true" />
              <span><strong>Video</strong><small>Add a YouTube lesson.</small></span>
            </button>
            <button type="button" className={type === 'article' ? 'active' : ''} onClick={() => setType('article')}>
              <BookOpenText size={17} aria-hidden="true" />
              <span><strong>Write-up</strong><small>Publish a short guide.</small></span>
            </button>
          </fieldset>

          <label className="field plain">
            <span>Topic</span>
            <select value={topic} onChange={(event) => setTopic(event.target.value as KnowledgeTopic)}>
              {KNOWLEDGE_TOPICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>

          <label className="field plain">
            <span>Title</span>
            <input
              autoFocus
              value={title}
              maxLength={140}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="How to inspect a suspicious link"
            />
            {fields.title && <small className="field-error">{fields.title}</small>}
          </label>

          <label className="field plain">
            <span>Summary</span>
            <textarea
              rows={3}
              value={summary}
              maxLength={280}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Say what the learner will understand."
            />
            <small className="field-count">{summary.length}/280</small>
            {fields.summary && <small className="field-error">{fields.summary}</small>}
          </label>

          {type === 'video' ? (
            <label className="field plain">
              <span>YouTube link</span>
              <input
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
              />
              {fields.sourceUrl && <small className="field-error">{fields.sourceUrl}</small>}
            </label>
          ) : (
            <label className="field plain">
              <span>Write-up</span>
              <textarea
                className="kb-writeup-input"
                rows={10}
                value={body}
                maxLength={20_000}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Write the lesson in short paragraphs."
              />
              {fields.body && <small className="field-error">{fields.body}</small>}
            </label>
          )}

          <label className="field plain kb-duration-field">
            <span>Study time</span>
            <span className="kb-number-input">
              <input
                type="number"
                min={1}
                max={600}
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
              />
              <em>minutes</em>
            </span>
            {fields.durationMinutes && <small className="field-error">{fields.durationMinutes}</small>}
          </label>

          <label className="kb-publish-toggle">
            <input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} />
            <span><strong>Publish now</strong><small>A draft stays visible only to an editor.</small></span>
          </label>
        </div>

        <footer className="kb-publisher-foot">
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy}>
            <Save size={15} aria-hidden="true" />
            {busy ? 'Saving' : resource ? 'Save lesson' : 'Add lesson'}
          </button>
        </footer>
      </form>
    </>
  );
}

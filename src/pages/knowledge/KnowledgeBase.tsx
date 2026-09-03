import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit3,
  ExternalLink,
  LibraryBig,
  ListTree,
  Play,
  Plus,
  Search,
  Trash2,
  Video,
} from 'lucide-react';
import {
  deleteKnowledgeResource,
  getKnowledgeBase,
  setKnowledgeProgress,
} from '../../app/api';
import { useConfirm } from '../../app/confirm';
import type { Session } from '../../app/session';
import { useToast } from '../../app/toast';
import {
  BUILT_IN_KNOWLEDGE_LESSONS,
  KNOWLEDGE_TOPICS,
  type BuiltInKnowledgeLesson,
  type KnowledgeLessonType,
  type KnowledgeResource,
  type KnowledgeSection,
  type KnowledgeTopic,
} from '../../../shared/knowledge';
import PublishLesson from './PublishLesson';

type DisplayLesson = {
  key: string;
  resourceId: string | null;
  topic: KnowledgeTopic;
  title: string;
  summary: string;
  type: KnowledgeLessonType;
  durationMinutes: number;
  videoId: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  sections: KnowledgeSection[];
  body: string;
  custom: boolean;
  published: boolean;
};

function builtInLesson(lesson: BuiltInKnowledgeLesson): DisplayLesson {
  return {
    key: lesson.key,
    resourceId: null,
    topic: lesson.topic,
    title: lesson.title,
    summary: lesson.summary,
    type: lesson.type,
    durationMinutes: lesson.durationMinutes,
    videoId: lesson.videoId ?? null,
    sourceUrl: lesson.videoId ? `https://www.youtube.com/watch?v=${lesson.videoId}` : null,
    sourceLabel: lesson.sourceLabel ?? null,
    sections: lesson.sections,
    body: '',
    custom: false,
    published: true,
  };
}

function customLesson(resource: KnowledgeResource): DisplayLesson {
  return {
    key: `custom:${resource.id}`,
    resourceId: resource.id,
    topic: resource.topic,
    title: resource.title,
    summary: resource.summary,
    type: resource.type,
    durationMinutes: resource.durationMinutes,
    videoId: resource.videoId,
    sourceUrl: resource.sourceUrl,
    sourceLabel: 'Added in Cerberus',
    sections: [],
    body: resource.body,
    custom: true,
    published: resource.published,
  };
}

function LessonIcon({ type, size = 15 }: { type: KnowledgeLessonType; size?: number }) {
  return type === 'video'
    ? <Video size={size} aria-hidden="true" />
    : <BookOpenText size={size} aria-hidden="true" />;
}

function LessonContent({ lesson }: { lesson: DisplayLesson }) {
  const paragraphs = lesson.body.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);

  return (
    <article className="kb-lesson-content">
      {lesson.type === 'video' && lesson.videoId && (
        <div className="kb-video-frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${lesson.videoId}?rel=0`}
            title={lesson.title}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      )}

      {lesson.custom && lesson.type === 'article' && (
        <section className="kb-prose-section">
          <h2>Lesson</h2>
          {paragraphs.map((paragraph, index) => <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>)}
        </section>
      )}

      {lesson.sections.map((section) => (
        <section className="kb-prose-section" key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.points && (
            <ul>
              {section.points.map((point) => <li key={point}><Check size={15} aria-hidden="true" />{point}</li>)}
            </ul>
          )}
        </section>
      ))}

      {lesson.sourceUrl && (
        <a className="kb-source-link" href={lesson.sourceUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden="true" />
          Open {lesson.sourceLabel ?? 'the source'}
        </a>
      )}
    </article>
  );
}

export default function KnowledgeBase({ session: _session }: { session: Session }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [resources, setResources] = useState<KnowledgeResource[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [canPublish, setCanPublish] = useState(false);
  const [selectedKey, setSelectedKey] = useState(BUILT_IN_KNOWLEDGE_LESSONS[0]?.key ?? '');
  const [view, setView] = useState<'path' | 'videos'>('path');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publisherOpen, setPublisherOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeResource | null>(null);

  useEffect(() => {
    let alive = true;
    getKnowledgeBase()
      .then((payload) => {
        if (!alive) return;
        setResources(payload.resources);
        setCompleted(new Set(payload.completedLessonKeys));
        setCanPublish(payload.canPublish);
        const firstOpen = BUILT_IN_KNOWLEDGE_LESSONS.find((lesson) => !payload.completedLessonKeys.includes(lesson.key));
        if (firstOpen) setSelectedKey(firstOpen.key);
      })
      .catch(() => {
        if (alive) setError('Cerberus could not load the knowledge base.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const lessons = useMemo(
    () => [...BUILT_IN_KNOWLEDGE_LESSONS.map(builtInLesson), ...resources.map(customLesson)],
    [resources],
  );
  const selected = lessons.find((lesson) => lesson.key === selectedKey) ?? lessons[0] ?? null;
  const publishedLessons = lessons.filter((lesson) => lesson.published);
  const completedCount = publishedLessons.filter((lesson) => completed.has(lesson.key)).length;
  const progress = publishedLessons.length > 0 ? Math.round((completedCount / publishedLessons.length) * 100) : 0;
  const selectedIndex = lessons.findIndex((lesson) => lesson.key === selected?.key);
  const videos = lessons.filter((lesson) => lesson.type === 'video' && lesson.videoId && lesson.published);

  const visibleByTopic = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return new Map(KNOWLEDGE_TOPICS.map((topic) => [
      topic.id,
      lessons.filter((lesson) => {
        if (lesson.topic !== topic.id) return false;
        if (!normalized) return true;
        return `${lesson.title} ${lesson.summary}`.toLowerCase().includes(normalized);
      }),
    ]));
  }, [lessons, query]);

  async function toggleComplete() {
    if (!selected || !selected.published) return;
    const nextValue = !completed.has(selected.key);
    setCompleted((current) => {
      const next = new Set(current);
      if (nextValue) next.add(selected.key);
      else next.delete(selected.key);
      return next;
    });

    try {
      await setKnowledgeProgress(selected.key, nextValue);
      toast.done(nextValue ? 'Lesson complete.' : 'Lesson marked as open.');
    } catch {
      setCompleted((current) => {
        const next = new Set(current);
        if (nextValue) next.delete(selected.key);
        else next.add(selected.key);
        return next;
      });
      toast.fail('Cerberus could not save your progress.');
    }
  }

  function openLesson(key: string) {
    setSelectedKey(key);
    setView('path');
  }

  function handleSaved(resource: KnowledgeResource) {
    setResources((current) => {
      const exists = current.some((item) => item.id === resource.id);
      return exists ? current.map((item) => item.id === resource.id ? resource : item) : [...current, resource];
    });
    setSelectedKey(`custom:${resource.id}`);
    setEditing(null);
    setView('path');
    toast.done(resource.published ? 'Lesson published.' : 'Draft saved.');
  }

  function removeResource(resource: KnowledgeResource) {
    confirm.ask({
      title: `Delete ${resource.title}?`,
      body: 'This removes the lesson and its completion records.',
      action: 'Delete lesson',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteKnowledgeResource(resource.id);
          setResources((current) => current.filter((item) => item.id !== resource.id));
          setCompleted((current) => {
            const next = new Set(current);
            next.delete(`custom:${resource.id}`);
            return next;
          });
          if (selectedKey === `custom:${resource.id}`) {
            setSelectedKey(BUILT_IN_KNOWLEDGE_LESSONS[0]?.key ?? '');
          }
          toast.done('Lesson deleted.');
        } catch {
          toast.fail('Cerberus could not delete the lesson.');
        }
      },
    });
  }

  return (
    <div className="page kb-page">
      <section className="kb-command-bar" aria-label="Knowledge controls">
        <div className="segmented kb-view-switch">
          <button type="button" className={view === 'path' ? 'active' : ''} onClick={() => setView('path')}>
            <ListTree size={14} aria-hidden="true" />Learning path
          </button>
          <button type="button" className={view === 'videos' ? 'active' : ''} onClick={() => setView('videos')}>
            <LibraryBig size={14} aria-hidden="true" />Video library
          </button>
        </div>

        <div className="kb-progress-summary" aria-label={`${progress}% complete`}>
          <span><strong>{completedCount}</strong> of {publishedLessons.length} lessons</span>
          <span className="kb-progress-track"><i style={{ width: `${progress}%` }} /></span>
          <b>{progress}%</b>
        </div>

        {canPublish && (
          <button type="button" className="primary-button" onClick={() => { setEditing(null); setPublisherOpen(true); }}>
            <Plus size={15} aria-hidden="true" />Add lesson
          </button>
        )}
      </section>

      {loading && (
        <div className="kb-loading" role="status">
          <span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line" />
        </div>
      )}

      {error && <div className="empty-note"><h3>Knowledge base unavailable</h3><p>{error}</p></div>}

      {!loading && !error && view === 'path' && selected && (
        <div className="kb-study-layout">
          <aside className="kb-outline" aria-label="Learning path">
            <div className="kb-outline-head">
              <div>
                <p className="kb-eyebrow">Beginner path</p>
                <h2>Cybersecurity basics</h2>
              </div>
              <span>{publishedLessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0)} min</span>
            </div>

            <label className="kb-outline-search">
              <Search size={14} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a lesson" />
            </label>

            <div className="kb-outline-scroll">
              {KNOWLEDGE_TOPICS.map((topic, topicIndex) => {
                const topicLessons = visibleByTopic.get(topic.id) ?? [];
                if (topicLessons.length === 0) return null;
                return (
                  <section className="kb-topic" key={topic.id}>
                    <header>
                      <span>{String(topicIndex + 1).padStart(2, '0')}</span>
                      <div><h3>{topic.label}</h3><p>{topic.description}</p></div>
                    </header>
                    <ol>
                      {topicLessons.map((lesson) => (
                        <li key={lesson.key}>
                          <button
                            type="button"
                            className={lesson.key === selected.key ? 'current' : ''}
                            onClick={() => setSelectedKey(lesson.key)}
                          >
                            <span className={completed.has(lesson.key) ? 'kb-step done' : 'kb-step'}>
                              {completed.has(lesson.key) ? <Check size={12} aria-hidden="true" /> : <LessonIcon type={lesson.type} size={13} />}
                            </span>
                            <span className="kb-step-copy"><strong>{lesson.title}</strong><small>{lesson.durationMinutes} min{!lesson.published ? ' · Draft' : ''}</small></span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })}
            </div>
          </aside>

          <main className="kb-reader">
            <header className="kb-reader-head">
              <div className="kb-lesson-meta">
                <span><LessonIcon type={selected.type} />{selected.type === 'video' ? 'Video lesson' : 'Read lesson'}</span>
                <span><Clock3 size={14} aria-hidden="true" />{selected.durationMinutes} minutes</span>
                {!selected.published && <span className="kb-draft-badge">Draft</span>}
              </div>
              <h1>{selected.title}</h1>
              <p>{selected.summary}</p>

              {selected.custom && canPublish && (
                <div className="kb-editor-actions">
                  <button type="button" className="ghost-button" onClick={() => {
                    setEditing(resources.find((item) => item.id === selected.resourceId) ?? null);
                    setPublisherOpen(true);
                  }}><Edit3 size={14} aria-hidden="true" />Edit</button>
                  <button type="button" className="icon-button" title="Delete lesson" aria-label="Delete lesson" onClick={() => {
                    const resource = resources.find((item) => item.id === selected.resourceId);
                    if (resource) removeResource(resource);
                  }}><Trash2 size={15} aria-hidden="true" /></button>
                </div>
              )}
            </header>

            <LessonContent lesson={selected} />

            <footer className="kb-reader-foot">
              <button
                type="button"
                className="ghost-button"
                disabled={selectedIndex <= 0}
                onClick={() => setSelectedKey(lessons[selectedIndex - 1]?.key ?? selected.key)}
              ><ChevronLeft size={15} aria-hidden="true" />Previous</button>

              {selected.published && (
                <button
                  type="button"
                  className={completed.has(selected.key) ? 'kb-complete-button done' : 'kb-complete-button'}
                  onClick={toggleComplete}
                ><CheckCircle2 size={16} aria-hidden="true" />{completed.has(selected.key) ? 'Completed' : 'Mark complete'}</button>
              )}

              <button
                type="button"
                className="ghost-button"
                disabled={selectedIndex >= lessons.length - 1}
                onClick={() => setSelectedKey(lessons[selectedIndex + 1]?.key ?? selected.key)}
              >Next<ChevronRight size={15} aria-hidden="true" /></button>
            </footer>
          </main>
        </div>
      )}

      {!loading && !error && view === 'videos' && (
        <section className="kb-video-library">
          <header className="kb-library-head">
            <div><p className="kb-eyebrow">Watch and learn</p><h2>Video library</h2><p>Short lessons from trusted security and networking teams.</p></div>
            <span>{videos.length} videos</span>
          </header>
          <div className="kb-video-grid">
            {videos.map((lesson) => (
              <article className="kb-video-card" key={lesson.key}>
                <button type="button" className="kb-video-poster" onClick={() => openLesson(lesson.key)} aria-label={`Play ${lesson.title}`}>
                  <img src={`https://i.ytimg.com/vi/${lesson.videoId}/hqdefault.jpg`} alt="" loading="lazy" />
                  <span><Play size={18} fill="currentColor" aria-hidden="true" /></span>
                  <small>{lesson.durationMinutes} min</small>
                </button>
                <div className="kb-video-copy">
                  <p>{KNOWLEDGE_TOPICS.find((topic) => topic.id === lesson.topic)?.label}</p>
                  <h3>{lesson.title}</h3>
                  <span>{lesson.summary}</span>
                  <button type="button" onClick={() => openLesson(lesson.key)}>Open lesson<ChevronRight size={14} aria-hidden="true" /></button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {publisherOpen && (
        <PublishLesson
          resource={editing}
          onClose={() => { setPublisherOpen(false); setEditing(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

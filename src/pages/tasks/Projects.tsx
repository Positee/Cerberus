import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, FolderPlus, ListPlus, Plus, TriangleAlert } from 'lucide-react';
import { ApiFailure, createFolder, createList, createProject, listProjects, type ProjectTree } from '../../app/api';
import { allows, type Session } from '../../app/session';
import { KEY_PATTERN, suggestKey } from '../../../shared/tasks';

/**
 * The structure browser.
 *
 * Projects holds the shape of the work. Tasks holds the work itself. Keeping
 * them apart is what stops one screen doing two jobs.
 */

export default function Projects({ session }: { session: Session }) {
  const editable = allows(session, 'project.create');

  const [projects, setProjects] = useState<ProjectTree[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  /** Set once the person edits the key, so typing a name stops overwriting it. */
  const [keyTouched, setKeyTouched] = useState(false);

  async function load() {
    try {
      const result = await listProjects();
      setProjects(result.projects);
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load the projects.');
      setProjects([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);

    try {
      await createProject({ name: name.trim(), key: proposed.trim().toUpperCase() });
      setName('');
      setKey('');
      setKeyTouched(false);
      setAdding(false);
      setNote('The project is created, with a list called Tasks.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function addChild(projectId: string, kind: 'folder' | 'list') {
    const label = window.prompt(kind === 'folder' ? 'Name the folder' : 'Name the list');
    if (!label?.trim()) return;

    setError(null);
    try {
      if (kind === 'folder') await createFolder({ projectId, name: label.trim() });
      else await createList({ projectId, name: label.trim() });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    }
  }

  const proposed = keyTouched ? key : suggestKey(name);
  const keyValid = KEY_PATTERN.test(proposed.toUpperCase());

  return (
    <div className="page profile-page">
      {error && (
        <p className="auth-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {error}
        </p>
      )}
      {note && !error && (
        <p className="save-note" role="status">
          <Check size={15} aria-hidden="true" />
          {note}
        </p>
      )}

      {editable && (
        <section className="panel">
          <div className="panel-head">
            <h3>New project</h3>
            <p>A project owns its own task numbers. Its key becomes the prefix on every ref.</p>
          </div>

          {adding ? (
            <form className="stack-fields" onSubmit={add}>
              <label className="field plain">
                <span>Name</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Pecunia Web App"
                  maxLength={80}
                />
              </label>

              <label className="field plain">
                <span>Key</span>
                <input
                  value={proposed}
                  onChange={(event) => {
                    setKeyTouched(true);
                    setKey(event.target.value.toUpperCase());
                  }}
                  placeholder="PWA"
                  maxLength={6}
                />
                <small className="field-hint">
                  {keyValid ? `Tasks will read ${proposed.toUpperCase()}-1, ${proposed.toUpperCase()}-2, and so on.` : 'Use two to six letters or digits, starting with a letter.'}
                </small>
              </label>

              <div className="form-actions">
                <button type="button" className="ghost-button" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={busy || !name.trim() || !keyValid}>
                  {busy ? 'Creating' : 'Create project'}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="primary-button" onClick={() => setAdding(true)}>
              <Plus size={15} aria-hidden="true" />
              New project
            </button>
          )}
        </section>
      )}

      {projects === null ? (
        <section className="panel">
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" />
        </section>
      ) : projects.length === 0 ? (
        <section className="empty-note">
          <h3>No projects yet</h3>
          <p>A project holds folders and lists. A list holds the tasks.</p>
        </section>
      ) : (
        projects.map((project) => {
          const loose = project.lists.filter((list) => list.folderId === null);
          return (
            <section className="panel" key={project.id}>
              <div className="panel-head">
                <h3>
                  <span className="project-key">{project.key}</span>
                  {project.name}
                </h3>
                <p>
                  {project.taskCount} open {project.taskCount === 1 ? 'task' : 'tasks'}
                  {project.description ? `. ${project.description}` : ''}
                </p>
              </div>

              <ul className="tree">
                {project.folders.map((folder) => (
                  <li key={folder.id}>
                    <span className="tree-folder">{folder.name}</span>
                    <ul>
                      {project.lists
                        .filter((list) => list.folderId === folder.id)
                        .map((list) => (
                          <li key={list.id}>
                            <Link className="tree-list" to="/tasks">
                              {list.name}
                            </Link>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
                {loose.map((list) => (
                  <li key={list.id}>
                    <Link className="tree-list" to="/tasks">
                      {list.name}
                    </Link>
                  </li>
                ))}
              </ul>

              {editable && (
                <div className="form-actions start">
                  <button type="button" className="ghost-button" onClick={() => void addChild(project.id, 'folder')}>
                    <FolderPlus size={14} aria-hidden="true" />
                    Add folder
                  </button>
                  <button type="button" className="ghost-button" onClick={() => void addChild(project.id, 'list')}>
                    <ListPlus size={14} aria-hidden="true" />
                    Add list
                  </button>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

import React from "react";
import {
  List as ListIcon,
  Link2,
  Users,
  FileText,
  CheckSquare,
  Folder,
} from "lucide-react";
import { Note, Person, Project, Task } from "../../types";

interface Heading {
  level: 1 | 2 | 3;
  text: string;
  // posição (index do bloco) — usado como id ancorável
  index: number;
}

interface NoteSidePanelProps {
  // Estado vivo do editor
  headings: Heading[];
  mentionedPeopleIds: string[]; // ids de @ no conteúdo
  noteTitle: string;
  noteId: string;

  // Contexto do app
  allNotes: Note[];
  allPeople: Person[];
  allProjects: Project[];
  allTasks: Task[];

  // Navegação
  onOpenNote: (id: string) => void;
  onOpenPerson: (id: string) => void;
  onOpenTask: (id: string) => void;
  onOpenProject: (id: string) => void;

  // Scroll to heading
  onJumpToHeading: (index: number) => void;
}

const formatRelative = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  if (days < 30) return `há ${Math.round(days / 7)} sem.`;
  return d.toLocaleDateString("pt-BR");
};

const getInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("");

export const NoteSidePanel: React.FC<NoteSidePanelProps> = ({
  headings,
  mentionedPeopleIds,
  noteTitle,
  noteId,
  allNotes,
  allPeople,
  allProjects,
  allTasks,
  onOpenNote,
  onOpenPerson,
  onOpenTask,
  onOpenProject,
  onJumpToHeading,
}) => {
  // ----- backlinks -----
  // Notas que mencionam esta (por @-mention do título ou referência textual)
  const backlinkNotes = noteTitle
    ? allNotes.filter((n) => {
        if (n.id === noteId) return false;
        const txt = n.content || "";
        // procura o título dentro do JSON do Lexical (cobre menção e texto puro)
        return txt.toLowerCase().includes(noteTitle.toLowerCase());
      })
    : [];

  // Tarefas com mesmo projeto ou com título referenciando
  const backlinkTasks = allTasks
    .filter((t) => t.title && noteTitle && t.title.toLowerCase().includes(noteTitle.toLowerCase()))
    .slice(0, 3);

  // ----- pessoas mencionadas -----
  const mentionedPeople = mentionedPeopleIds
    .map((id) => allPeople.find((p) => p.id === id))
    .filter((p): p is Person => !!p);

  return (
    <div className="note-side-panel">
      {/* TOC */}
      <section className="nsp-section">
        <header className="nsp-h">
          <ListIcon size={14} />
          <span>Conteúdo</span>
        </header>
        {headings.length === 0 ? (
          <div className="nsp-empty">Sem títulos ainda — use h1/h2/h3 para gerar este índice.</div>
        ) : (
          <ul className="nsp-toc">
            {headings.map((h) => (
              <li
                key={`${h.index}-${h.text}`}
                className={`nsp-toc-item lvl-${h.level}`}
                onClick={() => onJumpToHeading(h.index)}
                title={h.text}
              >
                {h.text || "(vazio)"}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Backlinks */}
      <section className="nsp-section">
        <header className="nsp-h">
          <Link2 size={14} />
          <span>Mencionada em</span>
          <span className="nsp-count">{backlinkNotes.length + backlinkTasks.length}</span>
        </header>
        {backlinkNotes.length === 0 && backlinkTasks.length === 0 ? (
          <div className="nsp-empty">Nenhuma referência encontrada.</div>
        ) : (
          <div className="nsp-list">
            {backlinkNotes.slice(0, 5).map((n) => {
              const proj = allProjects.find((p) => p.id === n.projectId);
              return (
                <button
                  key={n.id}
                  className="nsp-card"
                  onClick={() => onOpenNote(n.id)}
                  title={n.title}
                >
                  <div className="nsp-card-title">
                    <FileText size={11} /> {n.title || "Sem título"}
                  </div>
                  <div className="nsp-card-sub">
                    {proj ? (
                      <>
                        <Folder size={10} /> {proj.name}
                      </>
                    ) : (
                      "Nota"
                    )}
                    {" · "}
                    {formatRelative(n.date)}
                  </div>
                </button>
              );
            })}
            {backlinkTasks.map((t) => {
              const proj = allProjects.find((p) => p.id === t.projectId);
              return (
                <button
                  key={t.id}
                  className="nsp-card"
                  onClick={() => onOpenTask(t.id)}
                  title={t.title}
                >
                  <div className="nsp-card-title">
                    <CheckSquare size={11} /> {t.title}
                  </div>
                  <div className="nsp-card-sub">
                    Tarefa
                    {proj && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenProject(proj.id);
                          }}
                          style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit", textDecoration: "underline" }}
                        >
                          {proj.name}
                        </button>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Pessoas mencionadas */}
      <section className="nsp-section">
        <header className="nsp-h">
          <Users size={14} />
          <span>Pessoas mencionadas</span>
          <span className="nsp-count">{mentionedPeople.length}</span>
        </header>
        {mentionedPeople.length === 0 ? (
          <div className="nsp-empty">Use @ para mencionar alguém no conteúdo.</div>
        ) : (
          <div className="nsp-people">
            {mentionedPeople.map((p) => (
              <button
                key={p.id}
                className="nsp-person"
                onClick={() => onOpenPerson(p.id)}
                title={`${p.name} — ${p.role || ""}`}
              >
                {p.avatarUrl ? (
                  <img src={p.avatarUrl} alt={p.name} className="nsp-avatar" />
                ) : (
                  <span className="nsp-avatar">{getInitials(p.name)}</span>
                )}
                <span className="nsp-person-name">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

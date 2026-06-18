import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Database,
  Person,
  Project,
  Note,
  Task,
  Company,
  OllamaSettings,
  SummaryTemplate,
  UserProfile,
  DataRootInfo,
  ImportedHyprnoteSession,
  AudioCleanupResult,
} from "../types";
import { buildImportReport, ImportReport } from "../lib/hyprnoteImport";
import { loadAutoStopSecs } from "../lib/recorderPrefs";

export interface MeetingPrompt {
  appName: string;
  bundleId: string;
}

const DEFAULT_SETTINGS: OllamaSettings = {
  url: "http://localhost:11434",
  model: "llama3.2",
  language: "pt-BR",
};

function extractImageFilenames(content: string): string[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    const found: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "image" && typeof node.filename === "string") {
        found.push(node.filename);
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    if (parsed && parsed.root) walk(parsed.root);
    return found;
  } catch {
    return [];
  }
}

function collectReferencedImages(notes: Note[], excludeId?: string): Set<string> {
  const set = new Set<string>();
  for (const note of notes) {
    if (excludeId && note.id === excludeId) continue;
    for (const filename of extractImageFilenames(note.content)) {
      set.add(filename);
    }
  }
  return set;
}

async function deleteUnreferencedImages(filenames: string[]) {
  if (filenames.length === 0) return;
  try {
    await invoke("delete_images", { filenames });
  } catch (err) {
    console.error("Erro ao remover imagens órfãs:", err);
  }
}

/**
 * Reconstrói `peopleIds` de projetos com base nas notas que pertencem a eles.
 * Aceita lista de ids a recalcular (passe os afetados pela mudança); ids null/empty
 * são ignorados. Garante idempotência: rodar duas vezes dá o mesmo resultado.
 */
function recomputeProjectPeople(
  projects: Project[],
  notes: Note[],
  projectIdsToRecompute: (string | null | undefined)[],
): Project[] {
  const ids = new Set(projectIdsToRecompute.filter((x): x is string => !!x));
  if (ids.size === 0) return projects;
  return projects.map((p) => {
    if (!ids.has(p.id)) return p;
    const set = new Set<string>();
    for (const n of notes) {
      if (n.projectId === p.id) {
        for (const pid of n.peopleIds) set.add(pid);
      }
    }
    return { ...p, peopleIds: Array.from(set) };
  });
}

interface AppContextType {
  db: Database;
  loading: boolean;
  currentView: string;
  setCurrentView: (view: string) => void;
  selectedEntityId: string | null;
  setSelectedEntityId: (id: string | null) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  // Aba a abrir na próxima nota selecionada (ex.: busca casou na transcrição).
  // Consumida e limpa pela NotesView.
  pendingNoteTab: string | null;
  setPendingNoteTab: (tab: string | null) => void;
  // Termo buscado, para rolar/realçar até a ocorrência na aba de destino.
  pendingNoteQuery: string | null;
  setPendingNoteQuery: (q: string | null) => void;

  // Detecção de reunião (app externo usando o microfone)
  meetingPrompt: MeetingPrompt | null;
  acceptMeetingRecording: () => Promise<void>;
  dismissMeetingPrompt: () => void;

  // Database CRUD Actions
  saveDatabase: (mutator: (prev: Database) => Database) => Promise<void>;
  
  addCompany: (company: Omit<Company, "id">) => Promise<string>;
  updateCompany: (company: Company) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;

  addPerson: (person: Omit<Person, "id">) => Promise<string>;
  updatePerson: (person: Person) => Promise<void>;
  deletePerson: (id: string) => Promise<void>;
  
  addProject: (project: Omit<Project, "id">) => Promise<string>;
  updateProject: (project: Project) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  
  addNote: (note: Omit<Note, "id">) => Promise<string>;
  updateNote: (note: Note) => Promise<void>;
  patchNote: (
    id: string,
    fields: Partial<Note> | ((old: Note) => Partial<Note>),
  ) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  
  addTask: (task: Omit<Task, "id">) => Promise<void>;
  updateTask: (task: Task) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  updateSettings: (s: OllamaSettings) => Promise<void>;
  updateTranscriptionMode: (mode: string) => Promise<void>;
  liveTranscribingNoteId: string | null;
  addTemplate: (t: Omit<SummaryTemplate, "id">) => Promise<string>;
  updateTemplate: (t: SummaryTemplate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;

  setHyprnotePath: (path: string) => Promise<void>;
  upsertNotes: (notes: Note[]) => Promise<void>;
  reloadDb: () => Promise<void>;
  updateProfile: (profile: UserProfile) => Promise<void>;
  updateS3Schedule: (schedule: string, lastBackupAt?: string) => Promise<void>;
  updateS3Retention: (retention: number) => Promise<void>;
  updateHyprnoteSchedule: (schedule: string) => Promise<void>;
  runHyprnoteImport: (pathOverride?: string) => Promise<{ report: ImportReport; logPath: string | null }>;
  updateAudioCleanup: (age?: string, schedule?: string) => Promise<void>;
  runAudioCleanup: (ageOverride?: string) => Promise<AudioCleanupResult>;
  dataRoot: DataRootInfo | null;
  refreshDataRoot: () => Promise<void>;
  setDataRoot: (path: string | null, migrate: boolean) => Promise<DataRootInfo>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<Database>({
    people: [],
    projects: [],
    notes: [],
    tasks: [],
    companies: [],
    settings: DEFAULT_SETTINGS,
    templates: [],
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [currentView, setCurrentView] = useState<string>("painel");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [pendingNoteTab, setPendingNoteTab] = useState<string | null>(null);
  const [pendingNoteQuery, setPendingNoteQuery] = useState<string | null>(null);
  // Id da nota sendo transcrita ao vivo (null = nenhuma).
  const [liveTranscribingNoteId, setLiveNoteId] = useState<string | null>(null);
  const [dataRoot, setDataRootState] = useState<DataRootInfo | null>(null);

  // Load database from Rust on mount
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [data, info] = await Promise.all([
          invoke<Database>("load_db"),
          invoke<DataRootInfo>("get_data_root_info").catch(() => null),
        ]);
        setDb(data);
        if (info) setDataRootState(info);
      } catch (err) {
        console.error("Erro ao carregar o banco de dados:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // S3 backup scheduler — checks on mount + every 15 min while app is open.
  // Disabled when s3Schedule === "off" or no creds saved.
  const s3RunningRef = useRef(false);
  useEffect(() => {
    const intervalMs = (() => {
      switch (db.s3Schedule) {
        case "daily":
          return 24 * 60 * 60 * 1000;
        case "weekly":
          return 7 * 24 * 60 * 60 * 1000;
        default:
          return 0;
      }
    })();
    if (!intervalMs) return;

    const tryRun = async () => {
      if (s3RunningRef.current) return;
      const last = db.s3LastBackupAt ? Date.parse(db.s3LastBackupAt) : 0;
      if (Date.now() - last < intervalMs) return;
      s3RunningRef.current = true;
      try {
        const creds = await invoke<unknown>("load_s3_credentials");
        if (!creds) return;
        await invoke("backup_to_s3", { creds, retention: db.s3Retention ?? 3 });
        await saveDatabase((prev) => ({
          ...prev,
          s3LastBackupAt: new Date().toISOString(),
        }));
      } catch (err) {
        console.error("S3 auto-backup falhou:", err);
      } finally {
        s3RunningRef.current = false;
      }
    };

    tryRun();
    const t = setInterval(tryRun, 15 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.s3Schedule, db.s3LastBackupAt]);

  const refreshDataRoot = async () => {
    try {
      const info = await invoke<DataRootInfo>("get_data_root_info");
      setDataRootState(info);
    } catch (err) {
      console.error("Erro ao obter pasta de dados:", err);
    }
  };

  const setDataRoot = async (
    path: string | null,
    migrate: boolean,
  ): Promise<DataRootInfo> => {
    const info = await invoke<DataRootInfo>("set_data_root", { path, migrate });
    setDataRootState(info);
    const data = await invoke<Database>("load_db");
    setDb(data);
    return info;
  };

  // Save database helper — serializa as gravações via fila para evitar
  // que duas invocações concorrentes terminem em ordem trocada no Rust
  // (o que pode "ressuscitar" uma nota deletada).
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveDatabase = async (mutator: (prev: Database) => Database) => {
    let computed!: Database;
    setDb((prev) => {
      computed = mutator(prev);
      return computed;
    });
    const previous = saveQueueRef.current;
    const next = previous
      .catch(() => undefined)
      .then(() => invoke("save_db", { data: computed }))
      .then(() => undefined)
      .catch((err) => {
        console.error("Erro ao salvar o banco de dados:", err);
      });
    saveQueueRef.current = next;
    return next;
  };

  // --- Detecção de reunião: app externo começou/parou de usar o microfone ---
  // O backend (mic_monitor) emite `meeting-started` quando Teams/Zoom/Meet etc.
  // abre o microfone, e `meeting-ended` quando solta. Aqui oferecemos a
  // gravação via banner; o encerramento da gravação em si é feito no backend.
  const [meetingPrompt, setMeetingPrompt] = useState<MeetingPrompt | null>(null);

  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const track = (p: Promise<() => void>) =>
      p.then((u) => {
        if (disposed) u();
        else unlisteners.push(u);
      });
    track(
      listen<MeetingPrompt>("meeting-started", async (e) => {
        // Já gravando? Então não há o que oferecer.
        try {
          const status = await invoke<unknown>("recording_status");
          if (status) return;
        } catch {
          // segue com o prompt mesmo sem status
        }
        setMeetingPrompt(e.payload);
      }),
    );
    track(
      listen<MeetingPrompt>("meeting-ended", () => {
        setMeetingPrompt(null);
      }),
    );
    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
    };
  }, []);

  const dismissMeetingPrompt = () => setMeetingPrompt(null);

  // Aceitar = criar uma nota para a reunião, abrir e começar a gravar nela.
  const acceptMeetingRecording = async () => {
    const prompt = meetingPrompt;
    if (!prompt) return;
    setMeetingPrompt(null);
    const now = new Date();
    const dateOnly = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const id = await addNote({
      title: `Reunião ${prompt.appName} — ${time}`,
      content: "",
      date: dateOnly,
      projectId: null,
      peopleIds: [],
    });
    setSelectedEntityId(id);
    setCurrentView("notas");
    try {
      await invoke("start_recording", {
        noteId: id,
        autoStopSecs: loadAutoStopSecs(),
        systemAudio: true,
        stopOnMeetingEnd: true,
        live: db.transcriptionMode === "realtime",
      });
    } catch (err) {
      console.error("Falha ao iniciar a gravação da reunião:", err);
    }
  };

  // --- Gravação de reunião: fonte única de verdade para anexar o áudio ---
  // O backend emite `recording-finished` tanto no stop manual quanto no
  // auto-stop por silêncio — assim a nota recebe o mp3 mesmo que o usuário
  // esteja em outra tela (ou em outra nota) quando a gravação termina.
  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    listen<{ noteId: string; filename: string; micFilename?: string | null; reason: string }>(
      "recording-finished",
      async (e) => {
        const { noteId, filename, micFilename } = e.payload;
        let oldAudio = "";
        let oldAudioUsedElsewhere = false;
        await saveDatabase((prev) => {
          const target = prev.notes.find((n) => n.id === noteId);
          oldAudio = target?.audioFile || "";
          oldAudioUsedElsewhere = prev.notes.some(
            (n) => n.id !== noteId && n.audioFile === oldAudio,
          );
          return {
            ...prev,
            notes: prev.notes.map((n) =>
              n.id === noteId
                ? {
                    ...n,
                    audioFile: filename,
                    micFile: micFilename || "",
                    updatedAt: new Date().toISOString(),
                  }
                : n,
            ),
          };
        });
        if (oldAudio && oldAudio !== filename && !oldAudioUsedElsewhere) {
          try {
            await invoke("delete_audios", { filenames: [oldAudio] });
          } catch (err) {
            console.error("Erro ao remover áudio antigo:", err);
          }
        }
      },
    ).then((u) => {
      if (disposed) u();
      else unlisteners.push(u);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Transcrição local: persiste o texto mesmo se o usuário trocou de tela
  // enquanto o Parakeet processava o áudio. A UI da nota só reflete o estado.
  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    listen<{ noteId: string; filename: string; text: string; selfText?: string | null }>(
      "transcription-finished",
      async (e) => {
        const { noteId, text, selfText } = e.payload;
        await saveDatabase((prev) => ({
          ...prev,
          notes: prev.notes.map((n) =>
            n.id === noteId
              ? {
                  ...n,
                  transcript: text,
                  updatedAt: new Date().toISOString(),
                  // selfText presente = transcrição por canais; os sidecars já
                  // foram consumidos e apagados no backend, então zera micFile.
                  ...(selfText != null
                    ? { selfTranscript: selfText, micFile: "" }
                    : {}),
                }
              : n,
          ),
        }));
      },
    ).then((u) => {
      if (disposed) u();
      else unlisteners.push(u);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Transcrição ao vivo: o backend emite janelas conforme a reunião acontece.
  // Acumulamos no transcript da nota em tempo real (modo "realtime").
  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const track = (p: Promise<() => void>) =>
      p.then((u) => {
        if (disposed) u();
        else unlisteners.push(u);
      });

    const fmtTs = (secs: number) => {
      const t = Math.max(0, Math.floor(secs));
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      const s = t % 60;
      const p = (n: number) => String(n).padStart(2, "0");
      return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
    };

    track(
      listen<{ noteId: string }>("transcription-live-started", (e) =>
        setLiveNoteId(e.payload.noteId),
      ),
    );
    track(
      listen<{ noteId: string; text: string; start: number }>(
        "transcription-live",
        async (e) => {
          const { noteId, text, start } = e.payload;
          const line = `[${fmtTs(start)}] ${text}`;
          await saveDatabase((prev) => ({
            ...prev,
            notes: prev.notes.map((n) =>
              n.id === noteId
                ? {
                    ...n,
                    transcript: n.transcript ? `${n.transcript}\n\n${line}` : line,
                    updatedAt: new Date().toISOString(),
                  }
                : n,
            ),
          }));
        },
      ),
    );
    track(
      listen<{ noteId: string }>("transcription-live-finished", () =>
        setLiveNoteId(null),
      ),
    );
    track(
      listen<{ noteId: string; message: string }>("transcription-live-error", (e) => {
        console.error("Transcrição ao vivo falhou:", e.payload.message);
        setLiveNoteId(null);
      }),
    );

    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- COMPANIES CRUD ---
  const addCompany = async (data: Omit<Company, "id">): Promise<string> => {
    const id = `company-${Date.now()}`;
    const newCompany: Company = { ...data, id };
    await saveDatabase((prev) => ({
      ...prev,
      companies: [...(prev.companies || []), newCompany],
    }));
    return id;
  };

  const updateCompany = async (c: Company) => {
    await saveDatabase((prev) => ({
      ...prev,
      companies: (prev.companies || []).map((x) => (x.id === c.id ? c : x)),
    }));
  };

  const deleteCompany = async (id: string) => {
    await saveDatabase((prev) => ({
      ...prev,
      companies: (prev.companies || []).filter((x) => x.id !== id),
      people: prev.people.map((p) =>
        p.companyId === id ? { ...p, companyId: null } : p,
      ),
    }));
  };

  // --- PEOPLE CRUD ---
  const addPerson = async (personData: Omit<Person, "id">) => {
    const newPerson: Person = {
      ...personData,
      id: `person-${Date.now()}`,
    };
    await saveDatabase((prev) => ({
      ...prev,
      people: [...prev.people, newPerson],
    }));
    return newPerson.id;
  };

  const updatePerson = async (updatedPerson: Person) => {
    await saveDatabase((prev) => ({
      ...prev,
      people: prev.people.map((p) => (p.id === updatedPerson.id ? updatedPerson : p)),
    }));
  };

  const deletePerson = async (id: string) => {
    await saveDatabase((prev) => ({
      ...prev,
      people: prev.people.filter((p) => p.id !== id).map((p) => (p.managerId === id ? { ...p, managerId: null } : p)),
      projects: prev.projects.map((p) => ({
        ...p,
        peopleIds: p.peopleIds.filter((pid) => pid !== id),
      })),
      notes: prev.notes.map((n) => ({
        ...n,
        peopleIds: n.peopleIds.filter((pid) => pid !== id),
      })),
      tasks: prev.tasks.map((t) => (t.personId === id ? { ...t, personId: null } : t)),
    }));
  };

  // --- PROJECTS CRUD ---
  const addProject = async (projectData: Omit<Project, "id">) => {
    const now = new Date().toISOString();
    const newProject: Project = {
      ...projectData,
      id: `project-${Date.now()}`,
      status: projectData.status || "em-andamento",
      updatedAt: now,
    };
    await saveDatabase((prev) => ({
      ...prev,
      projects: [...prev.projects, newProject],
    }));
    return newProject.id;
  };

  const updateProject = async (updatedProject: Project) => {
    const stamped: Project = { ...updatedProject, updatedAt: new Date().toISOString() };
    await saveDatabase((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => (p.id === stamped.id ? stamped : p)),
    }));
  };

  const deleteProject = async (id: string) => {
    await saveDatabase((prev) => ({
      ...prev,
      projects: prev.projects.filter((p) => p.id !== id),
      notes: prev.notes.map((n) => (n.projectId === id ? { ...n, projectId: null } : n)),
      tasks: prev.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)),
    }));
  };

  // --- NOTES CRUD ---
  const addNote = async (noteData: Omit<Note, "id">): Promise<string> => {
    const id = `note-${Date.now()}`;
    const newNote: Note = { ...noteData, id, updatedAt: new Date().toISOString() };
    await saveDatabase((prev) => {
      const nextNotes = [newNote, ...prev.notes];
      return {
        ...prev,
        notes: nextNotes,
        projects: recomputeProjectPeople(prev.projects, nextNotes, [newNote.projectId]),
      };
    });
    return id;
  };

  const updateNote = async (updatedNote: Note) => {
    let oldNote: Note | undefined;
    let nextNotesSnapshot: Note[] = [];
    const stamped: Note = { ...updatedNote, updatedAt: new Date().toISOString() };
    await saveDatabase((prev) => {
      oldNote = prev.notes.find((n) => n.id === stamped.id);
      const nextNotes = prev.notes.map((n) => (n.id === stamped.id ? stamped : n));
      nextNotesSnapshot = nextNotes;
      const affectedProjects = [oldNote?.projectId, stamped.projectId];
      return {
        ...prev,
        notes: nextNotes,
        projects: recomputeProjectPeople(prev.projects, nextNotes, affectedProjects),
      };
    });

    if (oldNote) {
      const oldImages = new Set(extractImageFilenames(oldNote.content));
      const newImages = new Set(extractImageFilenames(stamped.content));
      const removed = [...oldImages].filter((f) => !newImages.has(f));
      if (removed.length > 0) {
        const referenced = collectReferencedImages(nextNotesSnapshot, stamped.id);
        const toDelete = removed.filter((f) => !referenced.has(f));
        await deleteUnreferencedImages(toDelete);
      }
    }
  };

  // Aplica APENAS os campos informados sobre a versão MAIS FRESCA da nota (dentro
  // do mutator), evitando o clobber de escritas concorrentes — o flush com debounce
  // da NotesView e os eventos (transcrição/gravação) salvam em paralelo, e um
  // snapshot defasado sobrescreveria mudanças recentes. `fields` pode ser uma
  // função (old) => Partial<Note> para derivar do estado atual (ex.: sumários).
  const patchNote = async (
    id: string,
    fields: Partial<Note> | ((old: Note) => Partial<Note>),
  ) => {
    let oldNote: Note | undefined;
    let merged: Note | undefined;
    let nextNotesSnapshot: Note[] = [];
    await saveDatabase((prev) => {
      oldNote = prev.notes.find((n) => n.id === id);
      if (!oldNote) return prev;
      const patch = typeof fields === "function" ? fields(oldNote) : fields;
      merged = { ...oldNote, ...patch, updatedAt: new Date().toISOString() };
      const nextNotes = prev.notes.map((n) => (n.id === id ? merged! : n));
      nextNotesSnapshot = nextNotes;
      const affectedProjects = [oldNote.projectId, merged.projectId];
      return {
        ...prev,
        notes: nextNotes,
        projects: recomputeProjectPeople(prev.projects, nextNotes, affectedProjects),
      };
    });

    // Limpeza de imagens órfãs só quando o conteúdo mudou.
    if (oldNote && merged && merged.content !== oldNote.content) {
      const oldImages = new Set(extractImageFilenames(oldNote.content));
      const newImages = new Set(extractImageFilenames(merged.content));
      const removed = [...oldImages].filter((f) => !newImages.has(f));
      if (removed.length > 0) {
        const referenced = collectReferencedImages(nextNotesSnapshot, id);
        const toDelete = removed.filter((f) => !referenced.has(f));
        await deleteUnreferencedImages(toDelete);
      }
    }
  };

  const deleteNote = async (id: string) => {
    let note: Note | undefined;
    let nextNotesSnapshot: Note[] = [];
    await saveDatabase((prev) => {
      note = prev.notes.find((n) => n.id === id);
      const nextNotes = prev.notes.filter((n) => n.id !== id);
      nextNotesSnapshot = nextNotes;
      return {
        ...prev,
        notes: nextNotes,
        projects: recomputeProjectPeople(prev.projects, nextNotes, [note?.projectId]),
      };
    });

    if (note) {
      const imagesInNote = extractImageFilenames(note.content);
      if (imagesInNote.length > 0) {
        const referenced = collectReferencedImages(nextNotesSnapshot);
        const toDelete = imagesInNote.filter((f) => !referenced.has(f));
        await deleteUnreferencedImages(toDelete);
      }
    }
  };

  // --- TASKS CRUD ---
  const addTask = async (taskData: Omit<Task, "id">) => {
    const newTask: Task = { ...taskData, id: `task-${Date.now()}` };
    await saveDatabase((prev) => ({
      ...prev,
      tasks: [newTask, ...prev.tasks],
    }));
  };

  const updateTask = async (updatedTask: Task) => {
    await saveDatabase((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
    }));
  };

  const deleteTask = async (id: string) => {
    await saveDatabase((prev) => ({
      ...prev,
      tasks: prev.tasks.filter((t) => t.id !== id),
    }));
  };

  // --- SETTINGS / TEMPLATES ---
  const updateSettings = async (s: OllamaSettings) => {
    await saveDatabase((prev) => ({ ...prev, settings: s }));
  };

  const updateTranscriptionMode = async (mode: string) => {
    await saveDatabase((prev) => ({
      ...prev,
      transcriptionMode: mode as Database["transcriptionMode"],
    }));
  };

  const addTemplate = async (data: Omit<SummaryTemplate, "id">): Promise<string> => {
    const id = `tpl-${Date.now()}`;
    const next: SummaryTemplate = { ...data, id };
    await saveDatabase((prev) => ({ ...prev, templates: [...(prev.templates || []), next] }));
    return id;
  };

  const updateTemplate = async (t: SummaryTemplate) => {
    await saveDatabase((prev) => ({
      ...prev,
      templates: (prev.templates || []).map((x) => (x.id === t.id ? t : x)),
    }));
  };

  const deleteTemplate = async (id: string) => {
    await saveDatabase((prev) => ({
      ...prev,
      templates: (prev.templates || []).filter((x) => x.id !== id),
    }));
  };

  const setHyprnotePath = async (path: string) => {
    await saveDatabase((prev) => ({ ...prev, hyprnotePath: path }));
  };

  const updateProfile = async (profile: UserProfile) => {
    await saveDatabase((prev) => ({ ...prev, profile }));
  };

  const updateS3Schedule = async (schedule: string, lastBackupAt?: string) => {
    await saveDatabase((prev) => ({
      ...prev,
      s3Schedule: schedule as Database["s3Schedule"],
      ...(lastBackupAt !== undefined ? { s3LastBackupAt: lastBackupAt } : {}),
    }));
  };

  const updateS3Retention = async (retention: number) => {
    await saveDatabase((prev) => ({ ...prev, s3Retention: retention }));
  };

  const updateHyprnoteSchedule = async (schedule: string) => {
    await saveDatabase((prev) => ({
      ...prev,
      hyprnoteSchedule: schedule as Database["hyprnoteSchedule"],
    }));
  };

  const runHyprnoteImport = async (
    pathOverride?: string,
  ): Promise<{ report: ImportReport; logPath: string | null }> => {
    const path = (pathOverride ?? db.hyprnotePath ?? "").trim();
    if (!path) throw new Error("Configure o caminho do Hyprnote antes de importar.");
    if (pathOverride && pathOverride !== (db.hyprnotePath || "")) {
      await setHyprnotePath(pathOverride);
    }
    const tsStart = new Date();
    try {
      const sessions = await invoke<ImportedHyprnoteSession[]>(
        "scan_hyprnote_sessions",
        { path },
      );
      const report = buildImportReport(sessions, db.notes, path);
      const audioErrors: string[] = [];
      if (report.pendingAudioCopies.length > 0) {
        const noteById = new Map(report.notes.map((n) => [n.id, n]));
        for (const job of report.pendingAudioCopies) {
          try {
            await invoke<string>("import_audio_file", {
              sourcePath: job.sourcePath,
              destFilename: job.destFilename,
            });
          } catch (err: any) {
            audioErrors.push(`[${job.noteId}] áudio: ${err?.message || String(err)}`);
            const n = noteById.get(job.noteId);
            if (n) n.audioFile = "";
          }
        }
      }
      if (audioErrors.length > 0) {
        report.log +=
          `\n--- Falhas ao copiar áudio (${audioErrors.length}) ---\n` +
          audioErrors.map((l) => `  ${l}`).join("\n");
      }
      if (report.notes.length > 0) {
        await upsertNotes(report.notes);
      }
      let logPath: string | null = null;
      try {
        logPath = await invoke<string>("write_import_log", { content: report.log });
      } catch (logErr) {
        console.error("Falha ao gravar import.log:", logErr);
      }
      await saveDatabase((prev) => ({
        ...prev,
        hyprnoteLastImportAt: new Date().toISOString(),
      }));
      return { report, logPath };
    } catch (e: any) {
      const msg = e?.message || String(e);
      try {
        const errLog =
          `[${tsStart.toISOString()}] === Importação Hyprnote ===\n` +
          `[${new Date().toISOString()}] ERROR ${msg}\n`;
        await invoke("write_import_log", { content: errLog });
      } catch {
        /* ignore */
      }
      throw e;
    }
  };

  // Hyprnote auto-import scheduler — checks every minute while app is open.
  const hyprRunningRef = useRef(false);
  useEffect(() => {
    const intervalMs = (() => {
      switch (db.hyprnoteSchedule) {
        case "30m":
          return 30 * 60 * 1000;
        case "1h":
          return 60 * 60 * 1000;
        case "2h":
          return 2 * 60 * 60 * 1000;
        case "4h":
          return 4 * 60 * 60 * 1000;
        default:
          return 0;
      }
    })();
    if (!intervalMs || !db.hyprnotePath) return;

    const tryRun = async () => {
      if (hyprRunningRef.current) return;
      const last = db.hyprnoteLastImportAt ? Date.parse(db.hyprnoteLastImportAt) : 0;
      if (Date.now() - last < intervalMs) return;
      hyprRunningRef.current = true;
      try {
        await runHyprnoteImport();
      } catch (err) {
        console.error("Importação automática do Hyprnote falhou:", err);
      } finally {
        hyprRunningRef.current = false;
      }
    };

    tryRun();
    const t = setInterval(tryRun, 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.hyprnoteSchedule, db.hyprnoteLastImportAt, db.hyprnotePath]);

  const updateAudioCleanup = async (age?: string, schedule?: string) => {
    await saveDatabase((prev) => ({
      ...prev,
      ...(age !== undefined
        ? { audioCleanupAge: age as Database["audioCleanupAge"] }
        : {}),
      ...(schedule !== undefined
        ? { audioCleanupSchedule: schedule as Database["audioCleanupSchedule"] }
        : {}),
    }));
  };

  const runAudioCleanup = async (
    ageOverride?: string,
  ): Promise<AudioCleanupResult> => {
    const age = (ageOverride ?? db.audioCleanupAge ?? "3m") as "1m" | "2m" | "3m";
    const months = age === "1m" ? 1 : age === "2m" ? 2 : 3;
    const result = await invoke<AudioCleanupResult>("cleanup_old_audios", { months });
    if (result.deleted.length > 0) {
      const deletedSet = new Set(result.deleted);
      await saveDatabase((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => {
          const audioGone = n.audioFile && deletedSet.has(n.audioFile);
          const micGone = n.micFile && deletedSet.has(n.micFile);
          if (!audioGone && !micGone) return n;
          return {
            ...n,
            ...(audioGone ? { audioFile: "" } : {}),
            ...(micGone ? { micFile: "", selfTranscript: "" } : {}),
          };
        }),
        audioCleanupLastAt: new Date().toISOString(),
      }));
    } else {
      await saveDatabase((prev) => ({
        ...prev,
        audioCleanupLastAt: new Date().toISOString(),
      }));
    }
    return result;
  };

  // Audio cleanup scheduler — checks every hour while app is open.
  const audioCleanupRunningRef = useRef(false);
  useEffect(() => {
    const intervalMs = (() => {
      switch (db.audioCleanupSchedule) {
        case "daily":
          return 24 * 60 * 60 * 1000;
        case "weekly":
          return 7 * 24 * 60 * 60 * 1000;
        default:
          return 0;
      }
    })();
    if (!intervalMs) return;

    const tryRun = async () => {
      if (audioCleanupRunningRef.current) return;
      const last = db.audioCleanupLastAt ? Date.parse(db.audioCleanupLastAt) : 0;
      if (Date.now() - last < intervalMs) return;
      audioCleanupRunningRef.current = true;
      try {
        await runAudioCleanup();
      } catch (err) {
        console.error("Limpeza automática de áudios falhou:", err);
      } finally {
        audioCleanupRunningRef.current = false;
      }
    };

    tryRun();
    const t = setInterval(tryRun, 60 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.audioCleanupSchedule, db.audioCleanupLastAt, db.audioCleanupAge]);

  const reloadDb = async () => {
    try {
      const data = await invoke<Database>("load_db");
      setDb(data);
    } catch (err) {
      console.error("Erro ao recarregar o banco de dados:", err);
    }
  };

  /**
   * Insere ou atualiza notas em lote (idempotente por id).
   * Mantém ordem: notas existentes preservam posição; novas vão pro topo.
   */
  const upsertNotes = async (incoming: Note[]) => {
    await saveDatabase((prev) => {
      const map = new Map(prev.notes.map((n) => [n.id, n]));
      const affectedProjects = new Set<string>();
      const newOnes: Note[] = [];
      for (const n of incoming) {
        const old = map.get(n.id);
        if (old) {
          if (old.projectId) affectedProjects.add(old.projectId);
          if (n.projectId) affectedProjects.add(n.projectId);
          map.set(n.id, n);
        } else {
          if (n.projectId) affectedProjects.add(n.projectId);
          newOnes.push(n);
        }
      }
      const updatedExisting = prev.notes.map((n) => map.get(n.id) || n);
      const nextNotes = [...newOnes, ...updatedExisting];
      return {
        ...prev,
        notes: nextNotes,
        projects: recomputeProjectPeople(
          prev.projects,
          nextNotes,
          Array.from(affectedProjects),
        ),
      };
    });
  };

  return (
    <AppContext.Provider
      value={{
        db,
        loading,
        currentView,
        setCurrentView,
        meetingPrompt,
        acceptMeetingRecording,
        dismissMeetingPrompt,
        selectedEntityId,
        setSelectedEntityId,
        searchOpen,
        setSearchOpen,
        pendingNoteTab,
        setPendingNoteTab,
        pendingNoteQuery,
        setPendingNoteQuery,
        saveDatabase,
        addCompany,
        updateCompany,
        deleteCompany,
        addPerson,
        updatePerson,
        deletePerson,
        addProject,
        updateProject,
        deleteProject,
        addNote,
        updateNote,
        patchNote,
        deleteNote,
        addTask,
        updateTask,
        deleteTask,
        updateSettings,
        updateTranscriptionMode,
        liveTranscribingNoteId,
        addTemplate,
        updateTemplate,
        deleteTemplate,
        setHyprnotePath,
        upsertNotes,
        reloadDb,
        updateProfile,
        updateS3Schedule,
        updateS3Retention,
        updateHyprnoteSchedule,
        runHyprnoteImport,
        updateAudioCleanup,
        runAudioCleanup,
        dataRoot,
        refreshDataRoot,
        setDataRoot,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp deve ser usado dentro de um AppProvider");
  }
  return context;
};

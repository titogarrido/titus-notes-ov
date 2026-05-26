export interface Person {
  id: string;
  name: string;
  role: string;
  email: string;
  department: string;
  managerId: string | null;
  avatarUrl?: string;
  companyId?: string | null;
  isContact?: boolean;
  aiProfile?: AIPersonProfile;
}

export interface AIPersonProfile {
  content: string;
  generatedAt: string;
  model: string;
  sourceNoteCount: number;
  sourceSummaryCount: number;
}

export type CompanyType =
  | "cliente"
  | "parceiro"
  | "prospect"
  | "fornecedor"
  | "outro";

export type CompanyScope = "global" | "regional" | "local" | "";

export interface Company {
  id: string;
  name: string;
  type: CompanyType;
  sector?: string;
  sizeLabel?: string;
  scope?: CompanyScope;
  subtitle?: string;
}

export type ProjectStatus =
  | "em-andamento"
  | "quase-la"
  | "pausado"
  | "concluido"
  | "ideacao";

export interface Project {
  id: string;
  name: string;
  description: string;
  peopleIds: string[];
  status?: ProjectStatus | string;
  updatedAt?: string;
  aiSummary?: AIProjectSummary;
}

export interface AIProjectSummary {
  content: string;
  generatedAt: string;
  model: string;
  sourceNoteCount: number;
  sourceSummaryCount: number;
  sourceTaskCount: number;
  sourcePeopleCount: number;
}

export interface Summary {
  id: string;
  templateId: string | null;
  templateName: string;
  content: string;
  generatedAt: string;
  model: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  date: string;
  projectId: string | null;
  peopleIds: string[];
  summaries?: Summary[];
  transcript?: string;
  /** Nome do arquivo de áudio em files/audio/ — vazio/ausente quando não há gravação */
  audioFile?: string;
}

export interface OllamaSettings {
  url: string;
  model: string;
  language: string;
}

export interface SummaryTemplate {
  id: string;
  name: string;
  description: string;
  sections: string[];
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  dueDate: string;
  projectId: string | null;
  personId: string | null;
}

export interface UserProfile {
  name: string;
  avatarUrl?: string;
}

export interface DataRootInfo {
  current: string;
  default: string;
  isCustom: boolean;
}

export interface Database {
  people: Person[];
  projects: Project[];
  notes: Note[];
  tasks: Task[];
  companies?: Company[];
  settings?: OllamaSettings;
  templates?: SummaryTemplate[];
  hyprnotePath?: string;
  profile?: UserProfile;
}

export interface ImportedHyprnoteSession {
  folderName: string;
  metaJson: string | null;
  memoMd: string | null;
  transcriptJson: string | null;
  /** [filename, content] dos sumários (.md que não começam com _) */
  summaryFiles: [string, string][];
  /** Caminho absoluto do audio.mp3/wav/... da sessão (vazio se não houver) */
  audioPath: string | null;
  /** Extensão do arquivo de áudio (sem ponto) */
  audioExt: string | null;
}

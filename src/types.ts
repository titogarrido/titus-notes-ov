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
  /** Definido quando o usuário editou manualmente o conteúdo gerado pela IA */
  editedAt?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  /** Data da reunião (yyyy-mm-dd) — usada para agrupar/calendário. */
  date: string;
  /** Timestamp ISO da última edição — usado para "notas recentes". */
  updatedAt?: string;
  projectId: string | null;
  peopleIds: string[];
  summaries?: Summary[];
  transcript?: string;
  /** Transcrição apenas do seu microfone (o que VOCÊ falou) — base para "meus" itens de ação */
  selfTranscript?: string;
  /** Nome do arquivo de áudio em files/audio/ — vazio/ausente quando não há gravação */
  audioFile?: string;
  /** Nome do arquivo de áudio só do microfone (sidecar `*.mic.mp3`), quando houve áudio do sistema */
  micFile?: string;
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
  /** Apelidos/variações de como te chamam nas reuniões (ex.: "Tito", "Garrido") */
  aliases?: string[];
  /** Descrição livre das suas áreas/atividades — desempate para atribuir itens implícitos */
  responsibilities?: string;
}

export interface DataRootInfo {
  current: string;
  default: string;
  isCustom: boolean;
}

export type S3Schedule = "off" | "daily" | "weekly";
export type HyprnoteSchedule = "off" | "30m" | "1h" | "2h" | "4h";
export type AudioCleanupAge = "1m" | "2m" | "3m";
export type AudioCleanupSchedule = "off" | "daily" | "weekly";

export interface AudioCleanupResult {
  deleted: string[];
  bytesFreed: number;
  errors: string[];
}

export interface S3Credentials {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  prefix: string;
  pathStyle: boolean;
}

export interface S3BackupItem {
  key: string;
  size: number;
  lastModified: string;
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
  s3Schedule?: S3Schedule;
  s3LastBackupAt?: string;
  s3Retention?: number;
  hyprnoteSchedule?: HyprnoteSchedule;
  hyprnoteLastImportAt?: string;
  audioCleanupAge?: AudioCleanupAge;
  audioCleanupSchedule?: AudioCleanupSchedule;
  audioCleanupLastAt?: string;
}

export interface TranscriptionModelStatus {
  ready: boolean;
  downloading: boolean;
  modelDir: string;
  bytesOnDisk: number;
  missingFiles: string[];
}

export interface ActiveTranscription {
  noteId: string;
  filename: string;
  /** "decoding" enquanto o áudio vira PCM; "transcribing" durante a inferência */
  phase: "decoding" | "transcribing";
  processedSecs: number;
  totalSecs: number;
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

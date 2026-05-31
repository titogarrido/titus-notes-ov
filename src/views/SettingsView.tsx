import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import {
  Settings,
  Database as DbIcon,
  Info,
  FolderOpen,
  Sparkles,
  Plus,
  Trash2,
  Pencil,
  X,
  GripVertical,
  CheckCircle2,
  AlertCircle,
  Download,
  Upload,
  ArchiveRestore,
  Loader2,
  UserCircle,
  ArrowUpCircle,
  Cloud,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { save as dialogSave, open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { check as checkUpdate, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  OllamaSettings,
  SummaryTemplate,
  UserProfile,
  S3Credentials,
  S3BackupItem,
  S3Schedule,
  HyprnoteSchedule,
  AudioCleanupAge,
  AudioCleanupSchedule,
  AudioCleanupResult,
} from "../types";
import { pingOllama } from "../lib/ollama";
import { ImportReport } from "../lib/hyprnoteImport";

const DEFAULT_SETTINGS: OllamaSettings = {
  url: "http://localhost:11434",
  model: "llama3.2",
  language: "pt-BR",
};

export const SettingsView: React.FC = () => {
  const {
    db,
    updateSettings,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    setHyprnotePath,
    reloadDb,
    updateProfile,
    updateS3Schedule,
    updateS3Retention,
    updateHyprnoteSchedule,
    runHyprnoteImport,
    updateAudioCleanup,
    runAudioCleanup,
    dataRoot,
    setDataRoot,
  } = useApp();

  const settings = db.settings || DEFAULT_SETTINGS;
  const templates = db.templates || [];

  // ---- Profile ----
  const [profileName, setProfileName] = useState(db.profile?.name || "");
  const [profileAvatar, setProfileAvatar] = useState(db.profile?.avatarUrl || "");
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    setProfileName(db.profile?.name || "");
    setProfileAvatar(db.profile?.avatarUrl || "");
  }, [db.profile?.name, db.profile?.avatarUrl]);

  const handleSaveProfile = async () => {
    const profile: UserProfile = {
      name: profileName.trim(),
      avatarUrl: profileAvatar.trim() || undefined,
    };
    await updateProfile(profile);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 1500);
  };

  // Form local controlado para Ollama
  const [url, setUrl] = useState(settings.url);
  const [model, setModel] = useState(settings.model);
  const [language, setLanguage] = useState(settings.language || "pt-BR");
  const [savedHint, setSavedHint] = useState(false);

  useEffect(() => {
    setUrl(settings.url);
    setModel(settings.model);
    setLanguage(settings.language || "pt-BR");
  }, [settings.url, settings.model, settings.language]);

  // Conexão / modelos disponíveis
  const [connStatus, setConnStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; models: string[] }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const handleSaveSettings = async () => {
    await updateSettings({ url: url.trim(), model: model.trim(), language });
    setSavedHint(true);
    setTimeout(() => setSavedHint(false), 1500);
  };

  const handleTestConnection = async () => {
    setConnStatus({ kind: "loading" });
    try {
      const models = await pingOllama({ url: url.trim(), model, language });
      setConnStatus({ kind: "ok", models });
    } catch (e: any) {
      setConnStatus({ kind: "error", message: e?.message || String(e) });
    }
  };

  // Template editor modal
  const [editing, setEditing] = useState<SummaryTemplate | "new" | null>(null);
  const [pendingDeleteTemplateId, setPendingDeleteTemplateId] = useState<string | null>(null);
  const pendingDeleteTpl = pendingDeleteTemplateId
    ? templates.find((t) => t.id === pendingDeleteTemplateId)
    : null;

  const handleSaveTemplate = async (tpl: Omit<SummaryTemplate, "id"> & { id?: string }) => {
    if (tpl.id) {
      await updateTemplate(tpl as SummaryTemplate);
    } else {
      await addTemplate(tpl);
    }
    setEditing(null);
  };

  // ---- Hyprnote import ----
  const [hyprPath, setHyprPath] = useState(db.hyprnotePath || "");
  const [hyprSaved, setHyprSaved] = useState(false);
  const [hyprSchedule, setHyprSchedule] = useState<HyprnoteSchedule>(
    db.hyprnoteSchedule || "off",
  );

  useEffect(() => {
    setHyprSchedule(db.hyprnoteSchedule || "off");
  }, [db.hyprnoteSchedule]);

  const handleHyprScheduleChange = async (v: HyprnoteSchedule) => {
    setHyprSchedule(v);
    await updateHyprnoteSchedule(v);
  };

  // ---- Audio cleanup ----
  const [audioAge, setAudioAge] = useState<AudioCleanupAge>(
    db.audioCleanupAge || "3m",
  );
  const [audioSchedule, setAudioSchedule] = useState<AudioCleanupSchedule>(
    db.audioCleanupSchedule || "off",
  );
  const [audioCleanupStatus, setAudioCleanupStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; result: AudioCleanupResult }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    setAudioAge(db.audioCleanupAge || "3m");
  }, [db.audioCleanupAge]);
  useEffect(() => {
    setAudioSchedule(db.audioCleanupSchedule || "off");
  }, [db.audioCleanupSchedule]);

  const handleAudioAgeChange = async (v: AudioCleanupAge) => {
    setAudioAge(v);
    await updateAudioCleanup(v, undefined);
  };
  const handleAudioScheduleChange = async (v: AudioCleanupSchedule) => {
    setAudioSchedule(v);
    await updateAudioCleanup(undefined, v);
  };
  const handleRunAudioCleanup = async () => {
    setAudioCleanupStatus({ kind: "loading" });
    try {
      const result = await runAudioCleanup(audioAge);
      setAudioCleanupStatus({ kind: "ok", result });
    } catch (e: any) {
      setAudioCleanupStatus({ kind: "error", message: e?.message || String(e) });
    }
  };
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setHyprPath(db.hyprnotePath || "");
  }, [db.hyprnotePath]);

  const handleSaveHyprPath = async () => {
    await setHyprnotePath(hyprPath.trim());
    setHyprSaved(true);
    setTimeout(() => setHyprSaved(false), 1500);
  };

  const [importLogPath, setImportLogPath] = useState<string | null>(null);

  const handleImportHyprnote = async () => {
    setImportError(null);
    setImportReport(null);
    setImportLogPath(null);
    setImporting(true);
    try {
      const { report, logPath } = await runHyprnoteImport(hyprPath.trim());
      setImportReport(report);
      if (logPath) setImportLogPath(logPath);
    } catch (e: any) {
      setImportError(e?.message || String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleRevealImportLog = async () => {
    try {
      let target = importLogPath;
      if (!target) {
        const dir = await invoke<string>("get_db_dir");
        target = `${dir}/import.log`;
      }
      await revealItemInDir(target);
    } catch (e) {
      console.error("Falha ao abrir log:", e);
    }
  };

  // ---- Backup / Restore ----
  const [backupStatus, setBackupStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; path: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const [restoreStatus, setRestoreStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [pendingRestorePath, setPendingRestorePath] = useState<string | null>(null);

  const handleBackup = async () => {
    setBackupStatus({ kind: "loading" });
    try {
      const today = new Date().toISOString().slice(0, 10);
      const dest = await dialogSave({
        defaultPath: `titus-notes-backup-${today}.zip`,
        filters: [{ name: "Backup", extensions: ["zip"] }],
      });
      if (!dest) {
        setBackupStatus({ kind: "idle" });
        return;
      }
      await invoke("create_backup", { destPath: dest });
      setBackupStatus({ kind: "ok", path: dest });
    } catch (e: any) {
      setBackupStatus({ kind: "error", message: e?.message || String(e) });
    }
  };

  const handleRestorePick = async () => {
    const path = await dialogOpen({
      filters: [{ name: "Backup", extensions: ["zip"] }],
      multiple: false,
    });
    if (!path || Array.isArray(path)) return;
    setPendingRestorePath(path);
    setRestoreConfirmOpen(true);
  };

  const handleRestoreConfirm = async () => {
    if (!pendingRestorePath) return;
    setRestoreConfirmOpen(false);
    setRestoreStatus({ kind: "loading" });
    try {
      await invoke("restore_backup", { backupPath: pendingRestorePath });
      await reloadDb();
      setRestoreStatus({ kind: "ok" });
    } catch (e: any) {
      setRestoreStatus({ kind: "error", message: e?.message || String(e) });
    } finally {
      setPendingRestorePath(null);
    }
  };

  const handleRevealInFinder = async () => {
    try {
      const dir = await invoke<string>("get_db_dir");
      await revealItemInDir(dir + "/db.json");
    } catch (err) {
      console.error("Failed to reveal in Finder:", err);
    }
  };

  // ---- Data root (custom DB location) ----
  const [dataRootStatus, setDataRootStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; info: { current: string; isCustom: boolean } }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [pendingNewRoot, setPendingNewRoot] = useState<string | null>(null);
  const [rootMigrate, setRootMigrate] = useState<boolean>(true);
  const [rootConfirmOpen, setRootConfirmOpen] = useState(false);
  const [resetRootConfirmOpen, setResetRootConfirmOpen] = useState(false);

  const handlePickDataRoot = async () => {
    const picked = await dialogOpen({
      directory: true,
      multiple: false,
      title: "Escolher pasta para o banco de dados",
    });
    if (!picked || Array.isArray(picked)) return;
    setPendingNewRoot(picked);
    setRootMigrate(true);
    setRootConfirmOpen(true);
  };

  const handleConfirmChangeRoot = async () => {
    if (!pendingNewRoot) return;
    setRootConfirmOpen(false);
    setDataRootStatus({ kind: "loading" });
    try {
      const info = await setDataRoot(pendingNewRoot, rootMigrate);
      setDataRootStatus({ kind: "ok", info });
      setTimeout(() => setDataRootStatus({ kind: "idle" }), 2500);
    } catch (e: any) {
      setDataRootStatus({ kind: "error", message: e?.message || String(e) });
    } finally {
      setPendingNewRoot(null);
    }
  };

  // ---- S3 remote backup ----
  const DEFAULT_S3: S3Credentials = {
    endpoint: "",
    region: "us-east-1",
    bucket: "",
    accessKey: "",
    secretKey: "",
    prefix: "",
    pathStyle: false,
  };
  const [s3Form, setS3Form] = useState<S3Credentials>(DEFAULT_S3);
  const [s3SaveHint, setS3SaveHint] = useState(false);
  const [s3Conn, setS3Conn] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; count: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [s3Backup, setS3Backup] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; key: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [uploadProgress, setUploadProgress] = useState<{
    phase: "zipping" | "uploading";
    startedAt: number;
    zipProcessed?: number;
    zipTotal?: number;
    zipCurrentFile?: string;
    uploaded?: number;
    total?: number;
    filename?: string;
  } | null>(null);
  const [s3Restore, setS3Restore] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [s3ListOpen, setS3ListOpen] = useState(false);
  const [s3List, setS3List] = useState<S3BackupItem[] | null>(null);
  const [s3ListLoading, setS3ListLoading] = useState(false);
  const [s3ListError, setS3ListError] = useState<string | null>(null);
  const [pendingRestoreKey, setPendingRestoreKey] = useState<string | null>(null);
  const [restoreS3ConfirmOpen, setRestoreS3ConfirmOpen] = useState(false);
  const [schedule, setSchedule] = useState<S3Schedule>(db.s3Schedule || "off");
  const [retention, setRetention] = useState<number>(db.s3Retention ?? 3);

  useEffect(() => {
    setSchedule(db.s3Schedule || "off");
  }, [db.s3Schedule]);

  useEffect(() => {
    setRetention(db.s3Retention ?? 3);
  }, [db.s3Retention]);

  useEffect(() => {
    (async () => {
      try {
        const loaded = await invoke<S3Credentials | null>("load_s3_credentials");
        if (loaded) setS3Form({ ...DEFAULT_S3, ...loaded });
      } catch (err) {
        console.error("load_s3_credentials:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    (async () => {
      const z1 = await listen<{ total: number }>("s3-zip-started", (e) => {
        setUploadProgress({
          phase: "zipping",
          startedAt: Date.now(),
          zipProcessed: 0,
          zipTotal: e.payload.total,
        });
      });
      const z2 = await listen<{ processed: number; total: number; currentFile: string }>(
        "s3-zip-progress",
        (e) => {
          setUploadProgress((prev) =>
            prev && prev.phase === "zipping"
              ? {
                  ...prev,
                  zipProcessed: e.payload.processed,
                  zipTotal: e.payload.total,
                  zipCurrentFile: e.payload.currentFile,
                }
              : prev,
          );
        },
      );
      const u1 = await listen<{ total: number; filename: string; key: string }>(
        "s3-upload-started",
        (e) => {
          setUploadProgress({
            phase: "uploading",
            startedAt: Date.now(),
            uploaded: 0,
            total: e.payload.total,
            filename: e.payload.filename,
          });
        },
      );
      const u2 = await listen<{ uploaded: number; total: number }>(
        "s3-upload-progress",
        (e) => {
          setUploadProgress((prev) =>
            prev && prev.phase === "uploading"
              ? { ...prev, uploaded: e.payload.uploaded, total: e.payload.total }
              : prev,
          );
        },
      );
      const u3 = await listen<{ key: string; total: number }>(
        "s3-upload-finished",
        (e) => {
          setUploadProgress((prev) =>
            prev && prev.phase === "uploading"
              ? { ...prev, uploaded: e.payload.total }
              : prev,
          );
          setTimeout(() => setUploadProgress(null), 1500);
        },
      );
      const u4 = await listen("s3-upload-error", () => {
        setUploadProgress(null);
      });
      unlisteners.push(z1, z2, u1, u2, u3, u4);
    })();
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, []);

  const fmtBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };
  const fmtSpeed = (bytes: number, ms: number) => {
    if (ms <= 0) return "—";
    const bps = (bytes / ms) * 1000;
    return `${fmtBytes(bps)}/s`;
  };

  const updateS3Field = <K extends keyof S3Credentials>(key: K, val: S3Credentials[K]) =>
    setS3Form((f) => ({ ...f, [key]: val }));

  const handleSaveS3Creds = async () => {
    try {
      await invoke("save_s3_credentials", { creds: s3Form });
      setS3SaveHint(true);
      setTimeout(() => setS3SaveHint(false), 1500);
    } catch (e: any) {
      setS3Conn({ kind: "error", message: e?.message || String(e) });
    }
  };

  const handleTestS3 = async () => {
    setS3Conn({ kind: "loading" });
    try {
      const count = await invoke<number>("test_s3_connection", { creds: s3Form });
      setS3Conn({ kind: "ok", count });
    } catch (e: any) {
      setS3Conn({ kind: "error", message: e?.message || String(e) });
    }
  };

  const handleBackupToS3 = async () => {
    setS3Backup({ kind: "loading" });
    try {
      const key = await invoke<string>("backup_to_s3", {
        creds: s3Form,
        retention,
      });
      setS3Backup({ kind: "ok", key });
      await updateS3Schedule(schedule, new Date().toISOString());
    } catch (e: any) {
      setS3Backup({ kind: "error", message: e?.message || String(e) });
    }
  };

  const handleRetentionChange = async (n: number) => {
    const clamped = Math.max(1, Math.min(99, Math.floor(n) || 3));
    setRetention(clamped);
    await updateS3Retention(clamped);
  };

  const handleOpenRestoreList = async () => {
    setS3ListOpen(true);
    setS3ListLoading(true);
    setS3List(null);
    setS3ListError(null);
    try {
      const items = await invoke<S3BackupItem[]>("list_s3_backups", { creds: s3Form });
      setS3List(items);
    } catch (e: any) {
      setS3ListError(e?.message || String(e));
    } finally {
      setS3ListLoading(false);
    }
  };

  const handlePickRestoreKey = (key: string) => {
    setPendingRestoreKey(key);
    setS3ListOpen(false);
    setRestoreS3ConfirmOpen(true);
  };

  const handleRestoreS3Confirm = async () => {
    if (!pendingRestoreKey) return;
    setRestoreS3ConfirmOpen(false);
    setS3Restore({ kind: "loading" });
    try {
      await invoke("restore_from_s3", { creds: s3Form, key: pendingRestoreKey });
      await reloadDb();
      setS3Restore({ kind: "ok" });
    } catch (e: any) {
      setS3Restore({ kind: "error", message: e?.message || String(e) });
    } finally {
      setPendingRestoreKey(null);
    }
  };

  const handleClearS3 = async () => {
    try {
      await invoke("clear_s3_credentials");
      setS3Form(DEFAULT_S3);
      setS3Conn({ kind: "idle" });
    } catch (e: any) {
      setS3Conn({ kind: "error", message: e?.message || String(e) });
    }
  };

  const handleScheduleChange = async (v: S3Schedule) => {
    setSchedule(v);
    await updateS3Schedule(v);
  };

  // ---- Updater ----
  const [appVersion, setAppVersion] = useState<string>("");
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const [updateStatus, setUpdateStatus] = useState<
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "uptodate" }
    | { kind: "available"; version: string; notes?: string; pending: Update }
    | { kind: "downloading"; progress: number; total: number; version: string }
    | { kind: "ready"; version: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const handleCheckUpdate = async () => {
    setUpdateStatus({ kind: "checking" });
    try {
      const update = await checkUpdate();
      if (!update) {
        setUpdateStatus({ kind: "uptodate" });
        return;
      }
      setUpdateStatus({
        kind: "available",
        version: update.version,
        notes: update.body,
        pending: update,
      });
    } catch (e: any) {
      setUpdateStatus({ kind: "error", message: e?.message || String(e) });
    }
  };

  const handleInstallUpdate = async () => {
    if (updateStatus.kind !== "available") return;
    const update = updateStatus.pending;
    let received = 0;
    let total = 0;
    setUpdateStatus({ kind: "downloading", progress: 0, total: 0, version: update.version });
    try {
      await update.downloadAndInstall((evt) => {
        if (evt.event === "Started") {
          total = evt.data.contentLength || 0;
          setUpdateStatus({ kind: "downloading", progress: 0, total, version: update.version });
        } else if (evt.event === "Progress") {
          received += evt.data.chunkLength;
          setUpdateStatus({
            kind: "downloading",
            progress: received,
            total,
            version: update.version,
          });
        } else if (evt.event === "Finished") {
          setUpdateStatus({ kind: "ready", version: update.version });
        }
      });
      await relaunch();
    } catch (e: any) {
      setUpdateStatus({ kind: "error", message: e?.message || String(e) });
    }
  };

  const handleConfirmResetRoot = async () => {
    setResetRootConfirmOpen(false);
    setDataRootStatus({ kind: "loading" });
    try {
      const info = await setDataRoot(null, false);
      setDataRootStatus({ kind: "ok", info });
      setTimeout(() => setDataRootStatus({ kind: "idle" }), 2500);
    } catch (e: any) {
      setDataRootStatus({ kind: "error", message: e?.message || String(e) });
    }
  };

  const navGroups: Array<{ label: string; items: Array<{ id: string; label: string }> }> = [
    {
      label: "Conta",
      items: [{ id: "profile", label: "Perfil" }],
    },
    {
      label: "Inteligência Artificial",
      items: [
        { id: "ollama", label: "Ollama" },
        { id: "templates", label: "Templates de sumário" },
      ],
    },
    {
      label: "Integrações",
      items: [{ id: "hyprnote", label: "Hyprnote (analog)" }],
    },
    {
      label: "Armazenamento",
      items: [
        { id: "database", label: "Banco de dados" },
        { id: "audio-cleanup", label: "Limpeza de áudios" },
        { id: "backup-local", label: "Backup local" },
        { id: "backup-s3", label: "Backup remoto · S3" },
      ],
    },
    {
      label: "Sistema",
      items: [
        { id: "updates", label: "Atualizações" },
        { id: "about", label: "Sobre" },
      ],
    },
  ];
  const navOrder = navGroups.flatMap((g) => g.items.map((i) => i.id));
  const [activeSection, setActiveSection] = useState<string>(navOrder[0]);

  useEffect(() => {
    const targets = navOrder
      .map((id) => document.getElementById(`section-${id}`))
      .filter((el): el is HTMLElement => !!el);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) {
          const id = visible.target.id.replace(/^section-/, "");
          setActiveSection(id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNavClick = (id: string) => {
    const el = document.getElementById(`section-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSection(id);
    }
  };

  return (
    <div className="view-container" style={{ maxWidth: "1100px" }}>
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <h1 className="detail-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Settings size={24} />
          <span>Configurações</span>
        </h1>
        <p className="welcome-subtitle" style={{ marginTop: "4px" }}>
          IA, banco de dados e backups.
        </p>
      </div>

      <div className="settings-layout">
        <aside className="settings-nav" aria-label="Navegação de configurações">
          {navGroups.map((g) => (
            <div key={g.label} className="settings-nav-group">
              <div className="settings-nav-group-label">{g.label}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`settings-nav-link ${activeSection === it.id ? "active" : ""}`}
                  onClick={() => handleNavClick(it.id)}
                >
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <div className="settings-box settings-main">
        {/* Profile */}
        <div id="section-profile" className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <UserCircle size={16} />
            <span>Perfil</span>
          </h2>

          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
            {profileAvatar.trim() ? (
              <img
                src={profileAvatar.trim()}
                alt={profileName || "Unnamed"}
                style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "2px solid var(--border-color)" }}
              />
            ) : (
              <div style={{
                width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
                background: "var(--color-accent, #4f6ef7)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "18px", fontWeight: 700,
              }}>
                {(profileName.trim() || "U")
                  .split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() || "").join("") || "?"}
              </div>
            )}
            <div style={{ fontSize: "13px" }}>
              <div style={{ fontWeight: 600 }}>{profileName.trim() || "Unnamed"}</div>
              <div style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>Exibido na barra lateral</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Nome
              <input
                type="text"
                className="form-input"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Unnamed"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              URL do avatar (opcional)
              <input
                type="text"
                className="form-input"
                value={profileAvatar}
                onChange={(e) => setProfileAvatar(e.target.value)}
                placeholder="https://..."
                spellCheck={false}
              />
            </label>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "14px" }}>
            <button className="btn-primary" onClick={handleSaveProfile}>
              Salvar
            </button>
            {profileSaved && (
              <span style={{ fontSize: "12px", color: "#1f8e3d", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Salvo
              </span>
            )}
          </div>
        </div>

        {/* Ollama */}
        <div id="section-ollama" className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <Sparkles size={16} />
            <span>Integração Ollama</span>
          </h2>
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 0, marginBottom: "16px" }}>
            Configure o servidor Ollama local. O sumário das notas é gerado usando o modelo abaixo.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              URL
              <input
                type="text"
                className="form-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Modelo
              <input
                type="text"
                className="form-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="llama3.2"
                list="ollama-models"
              />
              {connStatus.kind === "ok" && connStatus.models.length > 0 && (
                <datalist id="ollama-models">
                  {connStatus.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Idioma das gerações
              <select
                className="form-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="pt-BR">Português (Brasil)</option>
                <option value="pt">Português</option>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
              </select>
            </label>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={handleSaveSettings}>
              Salvar
            </button>
            <button className="btn-secondary" onClick={handleTestConnection}>
              {connStatus.kind === "loading" ? "Testando..." : "Testar conexão"}
            </button>
            {savedHint && (
              <span style={{ fontSize: "12px", color: "#1f8e3d", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Salvo
              </span>
            )}
            {connStatus.kind === "ok" && (
              <span style={{ fontSize: "12px", color: "#1f8e3d", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Conectado · {connStatus.models.length} modelo(s)
              </span>
            )}
            {connStatus.kind === "error" && (
              <span style={{ fontSize: "12px", color: "#cf222e", display: "flex", alignItems: "center", gap: "4px" }}>
                <AlertCircle size={14} /> {connStatus.message}
              </span>
            )}
          </div>
        </div>

        {/* Templates de sumário */}
        <div id="section-templates" className="settings-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <h2 className="section-title" style={{ fontSize: "15px", margin: 0 }}>
              <Sparkles size={16} />
              <span>Templates de Sumário</span>
            </h2>
            <button
              className="btn-secondary"
              onClick={() => setEditing("new")}
              style={{ display: "flex", alignItems: "center", gap: "4px" }}
            >
              <Plus size={14} />
              <span>Novo template</span>
            </button>
          </div>

          {templates.length === 0 ? (
            <p style={{ fontSize: "12px", color: "var(--color-text-muted)", fontStyle: "italic" }}>
              Nenhum template cadastrado. Crie um para gerar sumários personalizados nas suas notas.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "10px 12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>{tpl.name}</div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                      {tpl.description || "Sem descrição"}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: 4 }}>
                      {tpl.sections.length} seção(ões): {tpl.sections.join(" · ")}
                    </div>
                  </div>
                  <button
                    className="btn-icon"
                    onClick={() => setEditing(tpl)}
                    title="Editar"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => setPendingDeleteTemplateId(tpl.id)}
                    title="Excluir"
                    style={{ color: "#cf222e" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hyprnote import */}
        <div id="section-hyprnote" className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <Download size={16} />
            <span>Importação · Hyprnote (analog)</span>
          </h2>
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 0, marginBottom: "14px" }}>
            Aponte para a pasta <code>sessions/</code> do hyprnote. As notas serão importadas
            usando o id de cada sessão — importações repetidas atualizam ao invés de duplicar.
          </p>

          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
            Caminho da pasta sessions
            <input
              type="text"
              className="form-input"
              value={hyprPath}
              onChange={(e) => setHyprPath(e.target.value)}
              placeholder="/Users/<usuario>/Library/Application Support/hyprnote/sessions/"
              spellCheck={false}
              style={{ fontFamily: "monospace", fontSize: "12px" }}
            />
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={handleSaveHyprPath}>
              Salvar caminho
            </button>
            <button
              className="btn-primary"
              onClick={handleImportHyprnote}
              disabled={importing || !hyprPath.trim()}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              {importing ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              <span>{importing ? "Importando..." : "Importar agora"}</span>
            </button>
            {hyprSaved && (
              <span style={{ fontSize: "12px", color: "#1f8e3d", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Salvo
              </span>
            )}
            <button
              className="btn-secondary"
              onClick={handleRevealImportLog}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
              title="Abrir import.log no Finder"
            >
              <FolderOpen size={14} />
              <span>Ver log</span>
            </button>
          </div>

          <div className="settings-row" style={{ borderTop: "1px solid var(--border-color)", marginTop: 14, paddingTop: 12 }}>
            <div className="settings-text-block">
              <span className="settings-title">Importação automática</span>
              <span className="settings-desc">
                Roda enquanto o app está aberto. Última: {db.hyprnoteLastImportAt ? new Date(db.hyprnoteLastImportAt).toLocaleString("pt-BR") : "—"}.
              </span>
            </div>
            <select
              className="form-select"
              value={hyprSchedule}
              onChange={(e) => handleHyprScheduleChange(e.target.value as HyprnoteSchedule)}
              disabled={!hyprPath.trim()}
              style={{ minWidth: 160 }}
            >
              <option value="off">Desligado</option>
              <option value="30m">A cada 30 min</option>
              <option value="1h">A cada 1 hora</option>
              <option value="2h">A cada 2 horas</option>
              <option value="4h">A cada 4 horas</option>
            </select>
          </div>

          {importError && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px 14px",
                border: "1px solid #f5c2c7",
                background: "#f8d7da",
                color: "#842029",
                borderRadius: "8px",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <AlertCircle size={14} /> {importError}
            </div>
          )}

          {importReport && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px 14px",
                border: "1px solid #b6e0c2",
                background: "#e6f7ec",
                color: "#1f6f3d",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <CheckCircle2 size={14} />
                <strong>Importação concluída.</strong>
              </div>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <span>Total: <strong>{importReport.total}</strong></span>
                <span>Novas: <strong>{importReport.created}</strong></span>
                <span>Atualizadas: <strong>{importReport.updated}</strong></span>
                {importReport.skipped > 0 && <span>Ignoradas: {importReport.skipped}</span>}
                {importReport.pendingAudioCopies.length > 0 && (
                  <span>Áudios: <strong>{importReport.pendingAudioCopies.length}</strong></span>
                )}
                {importReport.errors.length > 0 && <span>Erros: {importReport.errors.length}</span>}
              </div>
              {importReport.errors.length > 0 && (
                <ul style={{ marginTop: "8px", paddingLeft: "18px" }}>
                  {importReport.errors.slice(0, 5).map((e, i) => (
                    <li key={i} style={{ color: "#842029" }}>
                      <code>{e.folder}</code>: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Database Info */}
        <div id="section-database" className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "16px" }}>
            <DbIcon size={16} />
            <span>Banco de Dados Local</span>
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
            <div className="settings-row" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "10px" }}>
              <div className="settings-text-block" style={{ minWidth: 0, flex: 1 }}>
                <span className="settings-title">
                  Localização dos arquivos{dataRoot?.isCustom && " (personalizada)"}:
                </span>
                <span style={{ fontFamily: "monospace", fontSize: "11px", background: "var(--bg-sidebar)", padding: "4px 8px", borderRadius: "4px", wordBreak: "break-all" }}>
                  {dataRoot?.current ? `${dataRoot.current}/db.json` : "—"}
                </span>
                {dataRoot?.isCustom && (
                  <span className="settings-desc" style={{ marginTop: 4 }}>
                    Padrão: <code style={{ fontSize: 11 }}>{dataRoot.default}</code>
                  </span>
                )}
              </div>
              <button className="btn-secondary" onClick={handleRevealInFinder} style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                <FolderOpen size={14} />
                <span>Ver no Finder</span>
              </button>
            </div>

            <div className="settings-row" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "10px" }}>
              <div className="settings-text-block">
                <span className="settings-title">Alterar pasta</span>
                <span className="settings-desc">
                  Escolha uma pasta personalizada (ex: iCloud, Dropbox) para armazenar o banco e os arquivos.
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {dataRoot?.isCustom && (
                  <button
                    className="btn-secondary"
                    onClick={() => setResetRootConfirmOpen(true)}
                    disabled={dataRootStatus.kind === "loading"}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Restaurar padrão
                  </button>
                )}
                <button
                  className="btn-primary"
                  onClick={handlePickDataRoot}
                  disabled={dataRootStatus.kind === "loading"}
                  style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
                >
                  {dataRootStatus.kind === "loading" ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
                  <span>{dataRootStatus.kind === "loading" ? "Aplicando..." : "Escolher pasta..."}</span>
                </button>
              </div>
            </div>

            {dataRootStatus.kind === "ok" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#1f8e3d" }}>
                <CheckCircle2 size={14} /> Pasta atualizada: <code style={{ fontSize: 11 }}>{dataRootStatus.info.current}</code>
              </div>
            )}
            {dataRootStatus.kind === "error" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#cf222e" }}>
                <AlertCircle size={14} /> {dataRootStatus.message}
              </div>
            )}

            <div className="settings-row" style={{ paddingTop: "6px" }}>
              <div className="settings-text-block">
                <span className="settings-title">Métricas de Uso</span>
                <span className="settings-desc">Estatísticas de entidades salvas localmente</span>
              </div>
              <div style={{ display: "flex", gap: "16px", fontWeight: 600 }}>
                <span>{db.people.length} Pessoas</span>
                <span>{db.projects.length} Projetos</span>
                <span>{db.notes.length} Notas</span>
                <span>{db.tasks.length} Tarefas</span>
              </div>
            </div>
          </div>
        </div>

        {/* Audio cleanup */}
        <div id="section-audio-cleanup" className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <Trash2 size={16} />
            <span>Limpeza de áudios antigos</span>
          </h2>
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 0, marginBottom: "14px" }}>
            Apaga arquivos em <code>files/audio/</code> mais antigos que o limite escolhido. Notas que referenciavam
            esses arquivos têm o campo <code>audioFile</code> esvaziado automaticamente — texto e sumários da nota não são afetados.
          </p>

          <div className="settings-row">
            <div className="settings-text-block">
              <span className="settings-title">Manter áudios dos últimos</span>
              <span className="settings-desc">Arquivos mais antigos serão apagados.</span>
            </div>
            <select
              className="form-select"
              value={audioAge}
              onChange={(e) => handleAudioAgeChange(e.target.value as AudioCleanupAge)}
              style={{ minWidth: 140 }}
            >
              <option value="1m">1 mês</option>
              <option value="2m">2 meses</option>
              <option value="3m">3 meses</option>
            </select>
          </div>

          <div className="settings-row" style={{ borderTop: "1px solid var(--border-color)", marginTop: 12, paddingTop: 12 }}>
            <div className="settings-text-block">
              <span className="settings-title">Limpar agora</span>
              <span className="settings-desc">
                Última: {db.audioCleanupLastAt ? new Date(db.audioCleanupLastAt).toLocaleString("pt-BR") : "—"}.
              </span>
            </div>
            <button
              className="btn-primary"
              onClick={handleRunAudioCleanup}
              disabled={audioCleanupStatus.kind === "loading"}
              style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
            >
              {audioCleanupStatus.kind === "loading" ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
              <span>{audioCleanupStatus.kind === "loading" ? "Limpando..." : "Limpar agora"}</span>
            </button>
          </div>

          {audioCleanupStatus.kind === "ok" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#1f8e3d", marginTop: 6 }}>
              <CheckCircle2 size={14} />
              <span>
                {audioCleanupStatus.result.deleted.length} arquivo(s) apagado(s)
                {" · "}
                {(audioCleanupStatus.result.bytesFreed / 1024 / 1024).toFixed(2)} MB liberados
                {audioCleanupStatus.result.errors.length > 0 && ` · ${audioCleanupStatus.result.errors.length} erro(s)`}
              </span>
            </div>
          )}
          {audioCleanupStatus.kind === "error" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#cf222e", marginTop: 6 }}>
              <AlertCircle size={14} /> {audioCleanupStatus.message}
            </div>
          )}

          <div className="settings-row" style={{ borderTop: "1px solid var(--border-color)", marginTop: 12, paddingTop: 12 }}>
            <div className="settings-text-block">
              <span className="settings-title">Limpeza automática</span>
              <span className="settings-desc">Roda enquanto o app está aberto.</span>
            </div>
            <select
              className="form-select"
              value={audioSchedule}
              onChange={(e) => handleAudioScheduleChange(e.target.value as AudioCleanupSchedule)}
              style={{ minWidth: 160 }}
            >
              <option value="off">Desligado</option>
              <option value="daily">Diário</option>
              <option value="weekly">Semanal</option>
            </select>
          </div>
        </div>

        {/* Backup & Restore */}
        <div id="section-backup-local" className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <ArchiveRestore size={16} />
            <span>Backup e Restauração</span>
          </h2>
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 0, marginBottom: "16px" }}>
            O backup inclui o banco de dados e todos os arquivos (imagens e áudios). A restauração sobrescreve os dados locais.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div className="settings-row">
              <div className="settings-text-block">
                <span className="settings-title">Criar Backup</span>
                <span className="settings-desc">Exporta todos os dados para um arquivo .zip</span>
              </div>
              <button
                className="btn-primary"
                onClick={handleBackup}
                disabled={backupStatus.kind === "loading"}
                style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
              >
                {backupStatus.kind === "loading" ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                <span>{backupStatus.kind === "loading" ? "Salvando..." : "Fazer Backup"}</span>
              </button>
            </div>

            {backupStatus.kind === "ok" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#1f8e3d" }}>
                <CheckCircle2 size={14} />
                <span>Backup salvo em <code style={{ fontSize: "11px" }}>{backupStatus.path}</code></span>
              </div>
            )}
            {backupStatus.kind === "error" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#cf222e" }}>
                <AlertCircle size={14} /> {backupStatus.message}
              </div>
            )}

            <div className="settings-row" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "12px" }}>
              <div className="settings-text-block">
                <span className="settings-title">Restaurar Backup</span>
                <span className="settings-desc">Importa um arquivo .zip e substitui os dados atuais</span>
              </div>
              <button
                className="btn-secondary"
                onClick={handleRestorePick}
                disabled={restoreStatus.kind === "loading"}
                style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
              >
                {restoreStatus.kind === "loading" ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                <span>{restoreStatus.kind === "loading" ? "Restaurando..." : "Restaurar"}</span>
              </button>
            </div>

            {restoreStatus.kind === "ok" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#1f8e3d" }}>
                <CheckCircle2 size={14} /> Backup restaurado com sucesso.
              </div>
            )}
            {restoreStatus.kind === "error" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#cf222e" }}>
                <AlertCircle size={14} /> {restoreStatus.message}
              </div>
            )}
          </div>
        </div>

        {/* Remote Backup · S3 */}
        <div id="section-backup-s3" className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <Cloud size={16} />
            <span>Backup Remoto · S3</span>
          </h2>
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 0, marginBottom: "14px" }}>
            Envie backups para um bucket S3 compatível (AWS, MinIO, Cloudflare R2, Backblaze B2, Wasabi).
            Credenciais ficam em <code>.s3-creds</code> dentro da pasta de dados e <strong>não</strong> entram no zip.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Endpoint (vazio = AWS)
              <input
                type="text"
                className="form-input"
                value={s3Form.endpoint}
                onChange={(e) => updateS3Field("endpoint", e.target.value)}
                placeholder="https://s3.amazonaws.com ou https://<account>.r2.cloudflarestorage.com"
                spellCheck={false}
                style={{ fontFamily: "monospace", fontSize: "12px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Região
              <input
                type="text"
                className="form-input"
                value={s3Form.region}
                onChange={(e) => updateS3Field("region", e.target.value)}
                placeholder="us-east-1"
                spellCheck={false}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Bucket
              <input
                type="text"
                className="form-input"
                value={s3Form.bucket}
                onChange={(e) => updateS3Field("bucket", e.target.value)}
                placeholder="meu-bucket"
                spellCheck={false}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Prefixo (opcional)
              <input
                type="text"
                className="form-input"
                value={s3Form.prefix}
                onChange={(e) => updateS3Field("prefix", e.target.value)}
                placeholder="backups/titus-notes"
                spellCheck={false}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Access Key ID
              <input
                type="text"
                className="form-input"
                value={s3Form.accessKey}
                onChange={(e) => updateS3Field("accessKey", e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Secret Access Key
              <input
                type="password"
                className="form-input"
                value={s3Form.secretKey}
                onChange={(e) => updateS3Field("secretKey", e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={s3Form.pathStyle}
              onChange={(e) => updateS3Field("pathStyle", e.target.checked)}
            />
            <span>Usar path-style (necessário p/ MinIO e alguns providers self-hosted)</span>
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={handleSaveS3Creds}>
              Salvar credenciais
            </button>
            <button className="btn-secondary" onClick={handleTestS3}>
              {s3Conn.kind === "loading" ? "Testando..." : "Testar conexão"}
            </button>
            <button className="btn-secondary" onClick={handleClearS3} style={{ color: "#cf222e" }}>
              Apagar credenciais
            </button>
            {s3SaveHint && (
              <span style={{ fontSize: "12px", color: "#1f8e3d", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Salvo
              </span>
            )}
            {s3Conn.kind === "ok" && (
              <span style={{ fontSize: "12px", color: "#1f8e3d", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Conectado · {s3Conn.count} objeto(s) no prefixo
              </span>
            )}
            {s3Conn.kind === "error" && (
              <span style={{ fontSize: "12px", color: "#cf222e", display: "flex", alignItems: "center", gap: "4px" }}>
                <AlertCircle size={14} /> {s3Conn.message}
              </span>
            )}
          </div>

          <div className="settings-row" style={{ borderTop: "1px solid var(--border-color)", marginTop: 16, paddingTop: 12 }}>
            <div className="settings-text-block">
              <span className="settings-title">Enviar backup agora</span>
              <span className="settings-desc">
                Gera o zip e envia para <code>{s3Form.prefix ? `${s3Form.prefix.replace(/\/+$/, "")}/` : ""}titus-notes-backup-*.zip</code>.
              </span>
            </div>
            <button
              className="btn-primary"
              onClick={handleBackupToS3}
              disabled={s3Backup.kind === "loading" || !s3Form.bucket.trim()}
              style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
            >
              {s3Backup.kind === "loading" ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
              <span>{s3Backup.kind === "loading" ? "Enviando..." : "Fazer backup p/ S3"}</span>
            </button>
          </div>
          {uploadProgress && (() => {
            const elapsed = Date.now() - uploadProgress.startedAt;
            if (uploadProgress.phase === "zipping") {
              const proc = uploadProgress.zipProcessed ?? 0;
              const tot = uploadProgress.zipTotal ?? 0;
              const pct = tot > 0 ? Math.min(100, (proc / tot) * 100) : 0;
              return (
                <div style={{ marginTop: 10, padding: "10px 12px", border: "1px solid var(--border-color)", borderRadius: 8, background: "var(--bg-sidebar)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Loader2 size={12} className="spin" />
                      <strong>Compactando arquivos…</strong>
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {tot > 0 ? `${proc} / ${tot}` : "…"}
                    </span>
                  </div>
                  <div style={{ height: 6, background: "rgba(0,0,0,0.08)", borderRadius: 3, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: "var(--color-accent, #4f6ef7)",
                        transition: "width 120ms linear",
                      }}
                    />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {uploadProgress.zipCurrentFile || "Preparando…"}
                  </div>
                </div>
              );
            }
            const uploaded = uploadProgress.uploaded ?? 0;
            const total = uploadProgress.total ?? 0;
            const pct = total > 0 ? Math.min(100, (uploaded / total) * 100) : 0;
            return (
              <div style={{ marginTop: 10, padding: "10px 12px", border: "1px solid var(--border-color)", borderRadius: 8, background: "var(--bg-sidebar)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 12 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Upload size={12} />
                    <strong>Enviando para S3…</strong>
                    {uploadProgress.filename && (
                      <code style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        {uploadProgress.filename}
                      </code>
                    )}
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(1)}%</span>
                </div>
                <div style={{ height: 6, background: "rgba(0,0,0,0.08)", borderRadius: 3, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "var(--color-accent, #4f6ef7)",
                      transition: "width 120ms linear",
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                  <span>{fmtBytes(uploaded)} / {fmtBytes(total)}</span>
                  <span>{fmtSpeed(uploaded, elapsed)}</span>
                </div>
              </div>
            );
          })()}
          {s3Backup.kind === "ok" && !uploadProgress && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#1f8e3d", marginTop: 6 }}>
              <CheckCircle2 size={14} /> Enviado: <code style={{ fontSize: 11 }}>{s3Backup.key}</code>
            </div>
          )}
          {s3Backup.kind === "error" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#cf222e", marginTop: 6 }}>
              <AlertCircle size={14} /> {s3Backup.message}
            </div>
          )}

          <div className="settings-row" style={{ borderTop: "1px solid var(--border-color)", marginTop: 12, paddingTop: 12 }}>
            <div className="settings-text-block">
              <span className="settings-title">Restaurar de um backup remoto</span>
              <span className="settings-desc">Lista os zips no bucket e substitui os dados atuais.</span>
            </div>
            <button
              className="btn-secondary"
              onClick={handleOpenRestoreList}
              disabled={s3Restore.kind === "loading" || !s3Form.bucket.trim()}
              style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
            >
              {s3Restore.kind === "loading" ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              <span>{s3Restore.kind === "loading" ? "Restaurando..." : "Restaurar do S3"}</span>
            </button>
          </div>
          {s3Restore.kind === "ok" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#1f8e3d", marginTop: 6 }}>
              <CheckCircle2 size={14} /> Backup restaurado.
            </div>
          )}
          {s3Restore.kind === "error" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#cf222e", marginTop: 6 }}>
              <AlertCircle size={14} /> {s3Restore.message}
            </div>
          )}

          <div className="settings-row" style={{ borderTop: "1px solid var(--border-color)", marginTop: 12, paddingTop: 12 }}>
            <div className="settings-text-block">
              <span className="settings-title">Reter últimos N backups</span>
              <span className="settings-desc">
                Após cada upload, backups mais antigos no prefixo são apagados. Padrão: 3.
              </span>
            </div>
            <input
              type="number"
              className="form-input"
              min={1}
              max={99}
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
              onBlur={(e) => handleRetentionChange(Number(e.target.value))}
              style={{ width: 80 }}
            />
          </div>

          <div className="settings-row" style={{ borderTop: "1px solid var(--border-color)", marginTop: 12, paddingTop: 12 }}>
            <div className="settings-text-block">
              <span className="settings-title">Backup automático</span>
              <span className="settings-desc">
                Roda quando o app está aberto. Última: {db.s3LastBackupAt ? new Date(db.s3LastBackupAt).toLocaleString("pt-BR") : "—"}.
              </span>
            </div>
            <select
              className="form-select"
              value={schedule}
              onChange={(e) => handleScheduleChange(e.target.value as S3Schedule)}
              style={{ minWidth: 160 }}
            >
              <option value="off">Desligado</option>
              <option value="daily">Diário</option>
              <option value="weekly">Semanal</option>
            </select>
          </div>
        </div>

        {/* Updates */}
        <div id="section-updates" className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <ArrowUpCircle size={16} />
            <span>Atualizações</span>
          </h2>
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 0, marginBottom: "14px" }}>
            Verifique se há uma nova versão publicada no GitHub Releases.
          </p>

          <div className="settings-row">
            <div className="settings-text-block">
              <span className="settings-title">Versão atual: {appVersion || "—"}</span>
              <span className="settings-desc">
                {updateStatus.kind === "idle" && "Clique para verificar."}
                {updateStatus.kind === "checking" && "Verificando..."}
                {updateStatus.kind === "uptodate" && "Você está com a versão mais recente."}
                {updateStatus.kind === "available" && `Nova versão disponível: ${updateStatus.version}`}
                {updateStatus.kind === "downloading" &&
                  (updateStatus.total > 0
                    ? `Baixando ${updateStatus.version}: ${Math.round((updateStatus.progress / updateStatus.total) * 100)}%`
                    : `Baixando ${updateStatus.version}...`)}
                {updateStatus.kind === "ready" && "Instalando e reiniciando..."}
                {updateStatus.kind === "error" && updateStatus.message}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {updateStatus.kind === "available" ? (
                <button
                  className="btn-primary"
                  onClick={handleInstallUpdate}
                  style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
                >
                  <Download size={14} />
                  <span>Baixar e instalar</span>
                </button>
              ) : (
                <button
                  className="btn-secondary"
                  onClick={handleCheckUpdate}
                  disabled={updateStatus.kind === "checking" || updateStatus.kind === "downloading"}
                  style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
                >
                  {(updateStatus.kind === "checking" || updateStatus.kind === "downloading") ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <ArrowUpCircle size={14} />
                  )}
                  <span>Verificar atualizações</span>
                </button>
              )}
            </div>
          </div>

          {updateStatus.kind === "available" && updateStatus.notes && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px 12px",
                background: "var(--bg-sidebar)",
                borderRadius: "8px",
                fontSize: "12px",
                whiteSpace: "pre-wrap",
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {updateStatus.notes}
            </div>
          )}
        </div>

        {/* About */}
        <div id="section-about" className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <Info size={16} />
            <span>Sobre o Titus Notes</span>
          </h2>
          <p style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--color-text-muted)" }}>
            O <strong>Titus Notes</strong> é um organizador pessoal e gerenciador de reuniões profissional, autocontido, mono-usuário e 100% offline.
            Versão <strong>{appVersion || "—"}</strong>. Desenvolvido com <strong>Tauri v2 + Rust</strong> e interface <strong>React</strong>.
          </p>
        </div>

        </div>
      </div>

      {/* Template editor modal */}
      {editing && (
        <TemplateEditorModal
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={handleSaveTemplate}
        />
      )}

      <ConfirmDialog
        open={!!pendingDeleteTpl}
        title="Excluir template?"
        message={
          <>
            O template <strong>{pendingDeleteTpl?.name || ""}</strong> será removido. Sumários já gerados continuam existindo nas notas.
          </>
        }
        confirmLabel="Excluir"
        danger
        onConfirm={async () => {
          if (pendingDeleteTemplateId) {
            const id = pendingDeleteTemplateId;
            setPendingDeleteTemplateId(null);
            await deleteTemplate(id);
          }
        }}
        onCancel={() => setPendingDeleteTemplateId(null)}
      />

      <style>{`
        .spin { animation: spinAnim 1s linear infinite; }
        @keyframes spinAnim { to { transform: rotate(360deg); } }

        .settings-layout {
          display: grid;
          grid-template-columns: 200px 1fr;
          gap: 28px;
          align-items: start;
        }
        .settings-nav {
          position: sticky;
          top: 20px;
          align-self: start;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding-right: 4px;
          max-height: calc(100vh - 60px);
          overflow-y: auto;
        }
        .settings-nav-group {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .settings-nav-group-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-text-muted);
          padding: 4px 8px;
        }
        .settings-nav-link {
          background: transparent;
          border: none;
          text-align: left;
          font-size: 13px;
          color: var(--color-text, inherit);
          padding: 6px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 80ms ease, color 80ms ease;
        }
        .settings-nav-link:hover {
          background: var(--bg-sidebar, rgba(0,0,0,0.04));
        }
        .settings-nav-link.active {
          background: var(--color-accent, #4f6ef7);
          color: #fff;
          font-weight: 600;
        }
        .settings-main {
          min-width: 0;
        }
        @media (max-width: 900px) {
          .settings-layout { grid-template-columns: 1fr; }
          .settings-nav {
            position: static;
            flex-direction: row;
            flex-wrap: wrap;
            max-height: none;
          }
          .settings-nav-group { flex-direction: row; flex-wrap: wrap; gap: 4px; }
          .settings-nav-group-label { width: 100%; }
        }
      `}</style>

      <ConfirmDialog
        open={rootConfirmOpen}
        title="Alterar pasta do banco de dados?"
        message={
          <>
            Nova pasta:
            {pendingNewRoot && (
              <div style={{ marginTop: 6, marginBottom: 10, fontFamily: "monospace", fontSize: "11px", color: "var(--color-text-muted)", wordBreak: "break-all" }}>
                {pendingNewRoot}
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={rootMigrate}
                onChange={(e) => setRootMigrate(e.target.checked)}
              />
              <span>Copiar dados atuais (<code>db.json</code> + <code>files/</code>) para a nova pasta</span>
            </label>
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-text-muted)" }}>
              {rootMigrate
                ? "Se a nova pasta já tiver db.json, ele será sobrescrito."
                : "Os dados atuais permanecem na pasta anterior. Se a nova pasta estiver vazia, dados padrão serão recriados."}
            </div>
          </>
        }
        confirmLabel="Aplicar"
        onConfirm={handleConfirmChangeRoot}
        onCancel={() => { setRootConfirmOpen(false); setPendingNewRoot(null); }}
      />

      <ConfirmDialog
        open={resetRootConfirmOpen}
        title="Restaurar pasta padrão?"
        message={
          <>
            O app voltará a usar a pasta padrão. Os dados na pasta personalizada
            <strong> não serão movidos</strong> — copie manualmente se quiser preservá-los.
            {dataRoot?.default && (
              <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 11, color: "var(--color-text-muted)" }}>
                {dataRoot.default}
              </div>
            )}
          </>
        }
        confirmLabel="Restaurar padrão"
        danger
        onConfirm={handleConfirmResetRoot}
        onCancel={() => setResetRootConfirmOpen(false)}
      />

      <ConfirmDialog
        open={restoreS3ConfirmOpen}
        title="Restaurar backup remoto?"
        message={
          <>
            <strong>Atenção:</strong> os dados locais serão substituídos pelo conteúdo do backup remoto. Esta ação não pode ser desfeita.
            {pendingRestoreKey && (
              <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 11, color: "var(--color-text-muted)", wordBreak: "break-all" }}>
                {pendingRestoreKey}
              </div>
            )}
          </>
        }
        confirmLabel="Restaurar"
        danger
        onConfirm={handleRestoreS3Confirm}
        onCancel={() => { setRestoreS3ConfirmOpen(false); setPendingRestoreKey(null); }}
      />

      {s3ListOpen && (
        <div
          onClick={() => setS3ListOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999, backdropFilter: "blur(2px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              padding: 20, width: 640, maxWidth: "92vw", maxHeight: "80vh",
              display: "flex", flexDirection: "column", gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Backups no S3</h3>
              <button type="button" className="btn-icon" onClick={() => setS3ListOpen(false)} title="Fechar">
                <X size={16} />
              </button>
            </div>
            {s3ListLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-muted)" }}>
                <Loader2 size={14} className="spin" /> Listando...
              </div>
            )}
            {s3ListError && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#cf222e" }}>
                <AlertCircle size={14} /> {s3ListError}
              </div>
            )}
            {!s3ListLoading && s3List && s3List.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--color-text-muted)", fontStyle: "italic" }}>
                Nenhum backup encontrado neste prefixo.
              </div>
            )}
            {!s3ListLoading && s3List && s3List.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
                {s3List.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handlePickRestoreKey(item.key)}
                    style={{
                      textAlign: "left", padding: "10px 12px", border: "1px solid var(--border-color)",
                      borderRadius: 8, background: "white", cursor: "pointer",
                      display: "flex", flexDirection: "column", gap: 2,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{item.key}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                      {(item.size / 1024 / 1024).toFixed(2)} MB · {item.lastModified}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={restoreConfirmOpen}
        title="Restaurar backup?"
        message={
          <>
            <strong>Atenção:</strong> os dados atuais (banco de dados e arquivos) serão substituídos pelo conteúdo do backup. Esta ação não pode ser desfeita.
            {pendingRestorePath && (
              <div style={{ marginTop: "8px", fontFamily: "monospace", fontSize: "11px", color: "var(--color-text-muted)" }}>
                {pendingRestorePath}
              </div>
            )}
          </>
        }
        confirmLabel="Restaurar"
        danger
        onConfirm={handleRestoreConfirm}
        onCancel={() => { setRestoreConfirmOpen(false); setPendingRestorePath(null); }}
      />

    </div>
  );
};
export default SettingsView;

// ---------------- Template editor modal ----------------

interface TemplateEditorModalProps {
  initial: SummaryTemplate | null;
  onCancel: () => void;
  onSave: (tpl: Omit<SummaryTemplate, "id"> & { id?: string }) => Promise<void>;
}

const TemplateEditorModal: React.FC<TemplateEditorModalProps> = ({ initial, onCancel, onSave }) => {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [sections, setSections] = useState<string[]>(initial?.sections.length ? initial.sections : [""]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const updateSection = (i: number, v: string) =>
    setSections((arr) => arr.map((x, idx) => (idx === i ? v : x)));
  const removeSection = (i: number) =>
    setSections((arr) => arr.filter((_, idx) => idx !== i));
  const addSection = () => setSections((arr) => [...arr, ""]);
  const moveSection = (from: number, to: number) => {
    setSections((arr) => {
      const next = [...arr];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sections.map((s) => s.trim()).filter(Boolean);
    if (!name.trim() || cleaned.length === 0) return;
    await onSave({
      id: initial?.id,
      name: name.trim(),
      description: description.trim(),
      sections: cleaned,
    });
  };

  // drag and drop simples por índice
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        backdropFilter: "blur(2px)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: "12px",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.25)",
          padding: "20px",
          width: "640px",
          maxWidth: "92vw",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
            {initial ? "Editar template" : "Novo template"}
          </h3>
          <button type="button" onClick={onCancel} className="btn-icon" title="Fechar">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "var(--color-text-muted)", letterSpacing: "0.06em" }}>
            NOME DO MODELO
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "var(--color-text-muted)", letterSpacing: "0.06em" }}>
            DESCRIPTION
            <input
              type="text"
              className="form-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Sections
          </span>
          <button
            type="button"
            onClick={addSection}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted)",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Plus size={12} /> Add Section
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {sections.map((s, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null && dragIdx !== i) moveSection(dragIdx, i);
                setDragIdx(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "4px 8px",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                background: dragIdx === i ? "#eef4ff" : "white",
              }}
            >
              <GripVertical
                size={14}
                style={{ color: "var(--color-text-muted)", cursor: "grab", flexShrink: 0 }}
              />
              <input
                type="text"
                className="form-input"
                value={s}
                onChange={(e) => updateSection(i, e.target.value)}
                placeholder="Nome da seção"
                style={{ flex: 1, border: "none", padding: "6px 4px" }}
              />
              {sections.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSection(i)}
                  className="btn-icon"
                  style={{ color: "#cf222e" }}
                  title="Remover"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "6px" }}>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary">
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
};

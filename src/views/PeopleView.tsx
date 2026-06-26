import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { Users, Plus, Edit3, Trash2, Mail, ArrowLeft, FolderKanban, FileText, CheckCircle2, Sparkles, RefreshCw, AlertTriangle, Search, X, Star, Building2, ListChecks } from "lucide-react";
import { Person, AIPersonProfile } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { Combobox, ComboboxOption } from "../components/Combobox";
import { generateSummaryWithOllama } from "../lib/ollama";

export const PeopleView: React.FC = () => {
  const {
    db,
    selectedEntityId,
    setSelectedEntityId,
    addPerson,
    updatePerson,
    deletePerson,
    setCurrentView,
    updateTask,
  } = useApp();

  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [generatingProfile, setGeneratingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // List filters
  const [search, setSearch] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState<string>("");
  const [filterDepartment, setFilterDepartment] = useState<string>("");
  const [onlyContacts, setOnlyContacts] = useState(false);
  const [sortMode, setSortMode] = useState<"nome" | "notas" | "tarefas" | "recente">("nome");

  // Form states
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [managerId, setManagerId] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [isContact, setIsContact] = useState(false);

  const handleOpenCreate = () => {
    setName("");
    setRole("");
    setEmail("");
    setDepartment("");
    setManagerId("");
    setAvatarUrl("");
    setCompanyId("");
    setIsContact(false);
    setIsCreating(true);
    setIsEditing(false);
  };

  const handleOpenEdit = (person: Person) => {
    setName(person.name);
    setRole(person.role);
    setEmail(person.email);
    setDepartment(person.department);
    setManagerId(person.managerId || "");
    setAvatarUrl(person.avatarUrl || "");
    setCompanyId(person.companyId || "");
    setIsContact(!!person.isContact);
    setIsEditing(true);
    setIsCreating(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const personData = {
      name: name.trim(),
      role: role.trim(),
      email: email.trim(),
      department: department.trim(),
      managerId: managerId || null,
      avatarUrl: avatarUrl.trim() || undefined,
      companyId: companyId || null,
      isContact,
    };

    if (isCreating) {
      await addPerson(personData);
      setIsCreating(false);
    } else if (isEditing && selectedEntityId) {
      await updatePerson({
        ...personData,
        id: selectedEntityId,
      });
      setIsEditing(false);
    }
  };

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    await deletePerson(id);
    if (selectedEntityId === id) {
      setSelectedEntityId(null);
    }
    setIsEditing(false);
  };

  const pendingDeletePerson = pendingDeleteId
    ? db.people.find((p) => p.id === pendingDeleteId)
    : null;

  const buildProfilePrompt = (
    person: Person,
    sources: { noteTitle: string; date: string; summaryContent: string }[],
  ) => {
    const lang =
      (db.settings?.language && db.settings.language) || "Português do Brasil";
    const blocks = sources
      .map(
        (s, i) =>
          `--- Fonte ${i + 1} · Nota: "${s.noteTitle || "(sem título)"}" · Data: ${s.date || "n/d"} ---\n${s.summaryContent.trim()}`,
      )
      .join("\n\n");

    return `Você é um analista de relacionamento profissional. Sua tarefa é gerar um PERFIL DESCRITIVO de uma pessoa, com base em sumários de reuniões em que ela participou.

Idioma da resposta: ${lang}.
Formate em Markdown, usando cabeçalhos "##" para cada seção e bullet points ("- ") quando fizer sentido. Seja factual, evite suposições e atribua afirmações às fontes quando possível (ex.: "Em 12/03, demonstrou interesse por X").

IMPORTANTE: NÃO use tabelas em Markdown (nada de "|" ou linhas com "---"). Use apenas parágrafos e listas com bullets.

Pessoa: ${person.name}
Cargo: ${person.role || "—"}
Departamento: ${person.department || "—"}
E-mail: ${person.email || "—"}

Seções obrigatórias (use exatamente estes títulos):
## Resumo executivo
## Áreas de interesse e responsabilidades
## Estilo de trabalho e comunicação
## Tópicos recorrentes e prioridades
## Relacionamentos-chave mencionados
## Pontos de atenção / próximos passos sugeridos

Sumários disponíveis (${sources.length} no total, todos provenientes de notas em que esta pessoa participou):

${blocks}

Gere o perfil agora, somente em Markdown, sem comentários adicionais. Se alguma seção não tiver evidências suficientes nas fontes, escreva "Sem evidências suficientes nas notas." em vez de inventar.`;
  };

  const handleGenerateProfile = async () => {
    if (!selectedPerson) return;
    setProfileError(null);

    const notesForPerson = db.notes
      .filter((n) => n.peopleIds.includes(selectedPerson.id))
      .filter((n) => (n.summaries || []).length > 0)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    const sources: { noteTitle: string; date: string; summaryContent: string }[] = [];
    for (const n of notesForPerson) {
      for (const s of n.summaries || []) {
        if (s.content && s.content.trim()) {
          sources.push({
            noteTitle: n.title,
            date: n.date,
            summaryContent: s.content,
          });
        }
      }
    }

    if (sources.length === 0) {
      setProfileError(
        "Esta pessoa ainda não tem sumários gerados em nenhuma nota. Gere sumários nas notas primeiro.",
      );
      return;
    }

    const settings = db.settings || {
      url: "http://localhost:11434",
      model: "llama3.2",
      language: "pt-BR",
    };

    setGeneratingProfile(true);
    try {
      const prompt = buildProfilePrompt(selectedPerson, sources);
      const content = await generateSummaryWithOllama(settings, prompt);
      const aiProfile: AIPersonProfile = {
        content,
        generatedAt: new Date().toISOString(),
        model: settings.model || "llama3.2",
        sourceNoteCount: notesForPerson.length,
        sourceSummaryCount: sources.length,
      };
      await updatePerson({ ...selectedPerson, aiProfile });
    } catch (err: any) {
      console.error("Erro gerando perfil IA:", err);
      setProfileError(err?.message || "Falha ao gerar perfil pela IA.");
    } finally {
      setGeneratingProfile(false);
    }
  };

  const handleClearProfile = async () => {
    if (!selectedPerson) return;
    const { aiProfile, ...rest } = selectedPerson;
    void aiProfile;
    await updatePerson(rest as Person);
  };

  const handleTaskToggle = async (task: any) => {
    await updateTask({
      ...task,
      completed: !task.completed,
    });
  };

  const selectedPerson = db.people.find((p) => p.id === selectedEntityId);

  // Relationships for selected person
  const manager = selectedPerson
    ? db.people.find((p) => p.id === selectedPerson.managerId)
    : null;

  const directReports = selectedPerson
    ? db.people.filter((p) => p.managerId === selectedPerson.id)
    : [];

  const associatedProjects = selectedPerson
    ? db.projects.filter((proj) => proj.peopleIds.includes(selectedPerson.id))
    : [];

  const associatedNotes = selectedPerson
    ? db.notes.filter((n) => n.peopleIds.includes(selectedPerson.id))
    : [];

  const associatedTasks = selectedPerson
    ? db.tasks.filter((t) => t.personId === selectedPerson.id)
    : [];

  // Filter out the current person from potential managers to prevent self-management cycles
  const potentialManagers = db.people.filter((p) => p.id !== selectedEntityId);

  // Opções de empresa para o combobox (com autocomplete).
  const companyOptions: ComboboxOption[] = useMemo(
    () =>
      (db.companies || []).map((c) => ({
        id: c.id,
        label: c.name,
        sub: c.sector || c.subtitle || "",
      })),
    [db.companies],
  );

  // Gestores possíveis, filtrados pela empresa selecionada no formulário. Sem
  // empresa selecionada, mostra todas as pessoas (exceto a própria).
  const managerOptions: ComboboxOption[] = useMemo(() => {
    const base = potentialManagers.filter(
      (p) => !companyId || p.companyId === companyId,
    );
    // Garante que o gestor já selecionado apareça mesmo que seja de outra
    // empresa (dados legados), para o combobox conseguir exibi-lo em vez de
    // ficar em branco mantendo um valor oculto.
    if (managerId && !base.some((p) => p.id === managerId)) {
      const current = potentialManagers.find((p) => p.id === managerId);
      if (current) base.unshift(current);
    }
    return base.map((p) => ({
      id: p.id,
      label: p.name,
      sub: p.role || "Sem cargo",
    }));
  }, [potentialManagers, companyId, managerId]);

  // Ao trocar a empresa, limpa o gestor se ele não pertencer à nova empresa
  // (mantém a coerência: o gestor deve ser alguém da mesma empresa).
  const handleCompanyChange = (newCompanyId: string) => {
    setCompanyId(newCompanyId);
    if (newCompanyId && managerId) {
      const mgr = db.people.find((p) => p.id === managerId);
      if (!mgr || mgr.companyId !== newCompanyId) setManagerId("");
    }
  };

  // ---- UX helpers ----
  const avatarPalette = [
    { bg: "#dbeafe", fg: "#1d4ed8" },
    { bg: "#fce7f3", fg: "#be185d" },
    { bg: "#dcfce7", fg: "#15803d" },
    { bg: "#fef3c7", fg: "#a16207" },
    { bg: "#ede9fe", fg: "#6d28d9" },
    { bg: "#ffedd5", fg: "#c2410c" },
    { bg: "#cffafe", fg: "#0e7490" },
    { bg: "#fee2e2", fg: "#b91c1c" },
  ];
  const avatarColor = (key: string) => {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return avatarPalette[h % avatarPalette.length];
  };
  const initialsOf = (name: string) =>
    name
      .split(" ")
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const relativeFromNow = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return "agora";
    if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `há ${h}h`;
    const d = Math.round(h / 24);
    if (d < 30) return `há ${d}d`;
    const mo = Math.round(d / 30);
    return `há ${mo} mês${mo === 1 ? "" : "es"}`;
  };

  const personStats = (id: string) => ({
    projects: db.projects.filter((p) => p.peopleIds.includes(id)).length,
    notes: db.notes.filter((n) => n.peopleIds.includes(id)).length,
    tasks: db.tasks.filter((t) => t.personId === id && !t.completed).length,
  });

  const departments = useMemo(
    () =>
      Array.from(
        new Set(db.people.map((p) => p.department).filter(Boolean)),
      ).sort(),
    [db.people],
  );

  const departmentOptions: ComboboxOption[] = useMemo(
    () => departments.map((d) => ({ id: d, label: d })),
    [departments],
  );

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = db.people.filter((p) => {
      if (onlyContacts && !p.isContact) return false;
      if (filterCompanyId && p.companyId !== filterCompanyId) return false;
      if (filterDepartment && p.department !== filterDepartment) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.role || "").toLowerCase().includes(q) ||
        (p.email || "").toLowerCase().includes(q) ||
        (p.department || "").toLowerCase().includes(q)
      );
    });

    const noteCount = (id: string) => db.notes.filter((n) => n.peopleIds.includes(id)).length;
    const openTaskCount = (id: string) =>
      db.tasks.filter((t) => t.personId === id && !t.completed).length;
    // O id é gerado como `person-<Date.now()>`, então o timestamp final indica
    // quando a pessoa foi cadastrada. Ids fora desse padrão (ex.: importações)
    // caem para 0 e vão ao fim.
    const createdAt = (id: string) => {
      const m = /-(\d{10,})$/.exec(id);
      return m ? Number(m[1]) : 0;
    };

    return [...list].sort((a, b) => {
      if (sortMode === "notas") {
        const d = noteCount(b.id) - noteCount(a.id);
        if (d !== 0) return d;
      } else if (sortMode === "tarefas") {
        const d = openTaskCount(b.id) - openTaskCount(a.id);
        if (d !== 0) return d;
      } else if (sortMode === "recente") {
        const d = createdAt(b.id) - createdAt(a.id);
        if (d !== 0) return d;
      }
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }, [db.people, db.notes, db.tasks, search, onlyContacts, filterCompanyId, filterDepartment, sortMode]);

  const hasActiveFilter =
    !!search || !!filterCompanyId || !!filterDepartment || onlyContacts;
  const clearFilters = () => {
    setSearch("");
    setFilterCompanyId("");
    setFilterDepartment("");
    setOnlyContacts(false);
  };

  return (
    <div className="view-container">
      {/* List Mode vs Detail/Form Split Mode */}
      {!selectedEntityId && !isCreating ? (
        <div>
          {/* Header */}
          <div className="people-header">
            <div>
              <h1 className="detail-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Users size={24} />
                <span>Pessoas e Perfis</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-muted)" }}>
                  · {db.people.length}
                </span>
              </h1>
              <p className="welcome-subtitle" style={{ marginTop: "4px" }}>
                Cadastre as pessoas de sua organização e gerencie suas alocações em projetos e tarefas.
              </p>
            </div>
            <button className="btn-primary" onClick={handleOpenCreate} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Plus size={14} />
              <span>Novo Perfil</span>
            </button>
          </div>

          {/* Filter bar */}
          {db.people.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
                marginBottom: 16,
                padding: "10px 12px",
                backgroundColor: "var(--bg-sidebar)",
                border: "1px solid var(--border-color)",
                borderRadius: 8,
              }}
            >
              <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
                <Search
                  size={14}
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--color-text-muted)",
                  }}
                />
                <input
                  type="text"
                  className="form-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome, cargo, e-mail ou departamento…"
                  style={{ paddingLeft: 30, height: 34 }}
                />
              </div>

              {(db.companies || []).length > 0 && (
                <div style={{ width: 190, flex: "0 0 auto" }}>
                  <Combobox
                    value={filterCompanyId}
                    options={companyOptions}
                    onChange={setFilterCompanyId}
                    emptyLabel="Todas as empresas"
                    placeholder="Filtrar empresa…"
                    noResultsText="Nenhuma empresa encontrada"
                    compact
                  />
                </div>
              )}

              {departments.length > 0 && (
                <div style={{ width: 190, flex: "0 0 auto" }}>
                  <Combobox
                    value={filterDepartment}
                    options={departmentOptions}
                    onChange={setFilterDepartment}
                    emptyLabel="Todos os departamentos"
                    placeholder="Filtrar departamento…"
                    noResultsText="Nenhum departamento encontrado"
                    compact
                  />
                </div>
              )}

              <select
                className="form-select"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                style={{ height: 34, flex: "0 0 auto" }}
                title="Ordenar pessoas"
              >
                <option value="nome">Ordenar: nome (A–Z)</option>
                <option value="recente">Ordenar: adicionadas recentemente</option>
                <option value="notas">Ordenar: mais notas</option>
                <option value="tarefas">Ordenar: mais tarefas abertas</option>
              </select>

              <button
                type="button"
                onClick={() => setOnlyContacts((v) => !v)}
                className="btn-secondary"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 34,
                  backgroundColor: onlyContacts ? "var(--bg-badge-orange)" : undefined,
                  color: onlyContacts ? "var(--color-badge-orange)" : undefined,
                  borderColor: onlyContacts ? "var(--color-badge-orange)" : undefined,
                  fontWeight: onlyContacts ? 600 : undefined,
                }}
                title="Mostrar apenas contatos diretos"
              >
                <Star size={13} fill={onlyContacts ? "currentColor" : "none"} />
                <span>Contatos</span>
              </button>

              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="btn-secondary"
                  style={{ display: "flex", alignItems: "center", gap: 4, height: 34 }}
                  title="Limpar filtros"
                >
                  <X size={13} />
                  <span>Limpar</span>
                </button>
              )}

              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-muted)" }}>
                {filteredPeople.length} de {db.people.length}
              </span>
            </div>
          )}

          {/* Grid or empty state */}
          {db.people.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "60px 20px",
                border: "1px dashed var(--border-color-dark)",
                borderRadius: 12,
                backgroundColor: "var(--bg-sidebar)",
              }}
            >
              <Users size={36} style={{ color: "var(--color-text-muted)", marginBottom: 12 }} />
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>Nenhuma pessoa cadastrada</h3>
              <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
                Comece adicionando as pessoas da sua organização para vinculá-las a projetos, notas e tarefas.
              </p>
              <button className="btn-primary" onClick={handleOpenCreate} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Plus size={14} />
                <span>Criar primeiro perfil</span>
              </button>
            </div>
          ) : filteredPeople.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                border: "1px dashed var(--border-color)",
                borderRadius: 12,
                color: "var(--color-text-muted)",
              }}
            >
              <Search size={28} style={{ marginBottom: 8 }} />
              <p style={{ fontSize: 13 }}>
                Nenhuma pessoa corresponde aos filtros aplicados.
              </p>
              <button className="btn-secondary" onClick={clearFilters} style={{ marginTop: 10 }}>
                Limpar filtros
              </button>
            </div>
          ) : (
            <div className="people-grid">
              {filteredPeople.map((person) => {
                const initials = initialsOf(person.name);
                const color = avatarColor(person.id || person.name);
                const stats = personStats(person.id);
                const company = person.companyId
                  ? db.companies?.find((x) => x.id === person.companyId)
                  : null;
                return (
                  <div
                    key={person.id}
                    className="people-card"
                    onClick={() => setSelectedEntityId(person.id)}
                  >
                    {person.isContact && (
                      <span
                        title="Contato direto"
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 10,
                          backgroundColor: "var(--bg-badge-orange)",
                          color: "var(--color-badge-orange)",
                        }}
                      >
                        <Star size={9} fill="currentColor" />
                        CONTATO
                      </span>
                    )}
                    {person.aiProfile && (
                      <span
                        title="Perfil gerado por IA"
                        style={{
                          position: "absolute",
                          top: 8,
                          left: 8,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          backgroundColor: "#f3e8ff",
                          color: "#8250df",
                        }}
                      >
                        <Sparkles size={11} />
                      </span>
                    )}
                    {person.avatarUrl ? (
                      <img src={person.avatarUrl} alt={person.name} className="avatar-large" />
                    ) : (
                      <div
                        className="avatar-large"
                        style={{ backgroundColor: color.bg, color: color.fg }}
                      >
                        {initials}
                      </div>
                    )}
                    <h3 className="people-card-name">{person.name}</h3>
                    <p className="people-card-role">{person.role || "Sem cargo"}</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                      {person.department && <span className="people-card-dept">{person.department}</span>}
                      {company && (
                        <span
                          className="people-card-dept"
                          style={{ backgroundColor: "var(--bg-badge-gray)", color: "var(--color-badge-gray)" }}
                        >
                          {company.name}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        marginTop: 4,
                        paddingTop: 10,
                        borderTop: "1px solid var(--border-color)",
                        width: "100%",
                        justifyContent: "center",
                        fontSize: 11,
                        color: "var(--color-text-muted)",
                      }}
                      title={`${stats.projects} projetos · ${stats.notes} notas · ${stats.tasks} tarefas abertas`}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <FolderKanban size={11} /> {stats.projects}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <FileText size={11} /> {stats.notes}
                      </span>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          color: stats.tasks > 0 ? "#bc4c00" : undefined,
                          fontWeight: stats.tasks > 0 ? 600 : undefined,
                        }}
                      >
                        <ListChecks size={11} /> {stats.tasks}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Split Pane Detail Mode */
        <div>
          {/* Back button */}
          <button
            className="btn-secondary"
            style={{ marginBottom: "20px", display: "flex", alignItems: "center", gap: "6px" }}
            onClick={() => {
              setSelectedEntityId(null);
              setIsCreating(false);
              setIsEditing(false);
            }}
          >
            <ArrowLeft size={14} />
            <span>Voltar para Perfis</span>
          </button>

          <div className="pane-layout">
            {/* Left Pane: Detailed Profile OR Form */}
            {isCreating || isEditing ? (
              <div className="pane-card">
                <h2 className="pane-title">{isCreating ? "Criar Novo Perfil" : `Editar Perfil de ${name}`}</h2>
                <form onSubmit={handleSave}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--color-text-muted)", marginBottom: 8 }}>
                    Identidade
                  </div>
                  <div className="form-group">
                    <label>Nome Completo</label>
                    <input
                      type="text"
                      className="form-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="ex. Anderson Silva"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Cargo / Função</label>
                    <input
                      type="text"
                      className="form-input"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      placeholder="ex. Head IT Infrastructure"
                    />
                  </div>

                  <div className="form-group">
                    <label>E-mail</label>
                    <input
                      type="email"
                      className="form-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ex. anderson@company.com"
                    />
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--color-text-muted)", marginTop: 16, marginBottom: 8, paddingTop: 12, borderTop: "1px solid var(--border-color)" }}>
                    <Building2 size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />
                    Organização
                  </div>
                  <div className="form-group">
                    <label>Departamento / Setor</label>
                    <input
                      type="text"
                      className="form-input"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      placeholder="ex. Infraestrutura"
                    />
                  </div>

                  <div className="form-group">
                    <label>Empresa</label>
                    <Combobox
                      value={companyId}
                      options={companyOptions}
                      onChange={handleCompanyChange}
                      emptyLabel="Sem empresa"
                      placeholder={
                        companyOptions.length
                          ? "Buscar empresa…"
                          : "Nenhuma empresa cadastrada"
                      }
                      disabled={companyOptions.length === 0}
                      noResultsText="Nenhuma empresa encontrada"
                    />
                  </div>

                  <div className="form-group">
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={isContact}
                        onChange={(e) => setIsContact(e.target.checked)}
                      />
                      <span>Marcar como meu contato direto nesta empresa</span>
                    </label>
                  </div>

                  <div className="form-group">
                    <label>Gestor Direto</label>
                    <Combobox
                      value={managerId}
                      options={managerOptions}
                      onChange={setManagerId}
                      emptyLabel="Nenhum (Cargo Executivo / Sem gestor)"
                      placeholder={
                        companyId
                          ? "Buscar pessoa desta empresa…"
                          : "Buscar pessoa…"
                      }
                      noResultsText={
                        companyId
                          ? "Nenhuma pessoa nesta empresa"
                          : "Nenhuma pessoa encontrada"
                      }
                    />
                    {companyId && (
                      <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--color-text-muted)" }}>
                        Mostrando apenas pessoas da empresa selecionada.
                      </p>
                    )}
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--color-text-muted)", marginTop: 16, marginBottom: 8, paddingTop: 12, borderTop: "1px solid var(--border-color)" }}>
                    Aparência
                  </div>
                  <div className="form-group">
                    <label>URL do Avatar / Foto (Opcional)</label>
                    <input
                      type="url"
                      className="form-input"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://exemplo.com/foto.jpg"
                    />
                  </div>

                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setIsCreating(false);
                        setIsEditing(false);
                      }}
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="btn-primary">
                      Salvar Perfil
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              /* Profile Details View */
              selectedPerson && (
                <div className="pane-card">
                  <div className="profile-detail-header">
                    {selectedPerson.avatarUrl ? (
                      <img src={selectedPerson.avatarUrl} alt={selectedPerson.name} className="avatar-xl" />
                    ) : (() => {
                      const c = avatarColor(selectedPerson.id || selectedPerson.name);
                      return (
                        <div className="avatar-xl" style={{ backgroundColor: c.bg, color: c.fg }}>
                          {initialsOf(selectedPerson.name)}
                        </div>
                      );
                    })()}
                    <div className="profile-detail-meta">
                      <h2 className="profile-detail-name" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span>{selectedPerson.name}</span>
                        {selectedPerson.isContact && (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 10,
                              backgroundColor: "var(--bg-badge-orange)",
                              color: "var(--color-badge-orange)",
                            }}
                          >
                            <Star size={10} fill="currentColor" /> CONTATO
                          </span>
                        )}
                      </h2>
                      <p className="profile-detail-role">{selectedPerson.role || "Sem cargo"}</p>
                      {selectedPerson.email && (
                        <a href={`mailto:${selectedPerson.email}`} className="profile-detail-email">
                          <Mail size={12} style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }} />
                          {selectedPerson.email}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="profile-sections">
                    {/* Organization hierarchy */}
                    <div className="profile-section-item">
                      <h3 className="profile-section-title">Estrutura Hierárquica</h3>
                      <div className="profile-hierarchy-box">
                        <div>
                          <span style={{ color: "var(--color-text-muted)" }}>Gestor Direto: </span>
                          {manager ? (
                            <button
                              className="profile-badge-link"
                              onClick={() => setSelectedEntityId(manager.id)}
                            >
                              {manager.name} ({manager.role || "Sem cargo"})
                            </button>
                          ) : (
                            <span style={{ fontStyle: "italic" }}>Cargo Executivo / Sem Gestor</span>
                          )}
                        </div>
                        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "8px", marginTop: "8px" }}>
                          <span style={{ color: "var(--color-text-muted)" }}>Subordinados Diretos ({directReports.length}): </span>
                          {directReports.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                              {directReports.map((report) => (
                                <button
                                  key={report.id}
                                  className="profile-badge-link"
                                  style={{ textAlign: "left" }}
                                  onClick={() => setSelectedEntityId(report.id)}
                                >
                                  • {report.name} ({report.role || "Sem cargo"})
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontStyle: "italic", fontSize: "12px" }}>Nenhum subordinado direto</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Company */}
                    {selectedPerson.companyId && (() => {
                      const c = db.companies?.find((x) => x.id === selectedPerson.companyId);
                      return c ? (
                        <div className="profile-section-item">
                          <h3 className="profile-section-title">Empresa</h3>
                          <button
                            className="profile-badge-link"
                            onClick={() => {
                              setSelectedEntityId(c.id);
                              setCurrentView("organograma");
                            }}
                          >
                            {c.name}
                            {selectedPerson.isContact && (
                              <span style={{ marginLeft: "8px", fontSize: "10px", padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--bg-badge-orange)", color: "var(--color-badge-orange)", fontWeight: 600 }}>
                                CONTATO
                              </span>
                            )}
                          </button>
                        </div>
                      ) : null;
                    })()}

                    {/* Department */}
                    {selectedPerson.department && (
                      <div className="profile-section-item">
                        <h3 className="profile-section-title">Departamento</h3>
                        <span className="people-card-dept" style={{ display: "inline-block" }}>
                          {selectedPerson.department}
                        </span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="profile-section-item" style={{ display: "flex", gap: "12px", borderTop: "1px solid var(--border-color)", paddingTop: "20px", alignItems: "center" }}>
                      <button
                        className="btn-primary"
                        onClick={() => handleOpenEdit(selectedPerson)}
                        style={{ display: "flex", alignItems: "center", gap: "6px" }}
                      >
                        <Edit3 size={14} />
                        <span>Editar Perfil</span>
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => handleDelete(selectedPerson.id)}
                        style={{ display: "flex", alignItems: "center", gap: "6px", color: "#cf222e", borderColor: "#cf222e44", marginLeft: "auto" }}
                        title="Excluir perfil"
                      >
                        <Trash2 size={14} />
                        <span>Excluir</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* Right Pane: Relational Work details (Projects, Notes, Tasks) */}
            {!isCreating && selectedPerson && (
              <div className="pane-card">
                <h2 className="pane-title" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "12px" }}>
                  Alocações e Atividades
                </h2>

                <div className="profile-sections">
                  {/* AI Profile */}
                  <div className="profile-section-item" style={{ borderTop: "none", paddingTop: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <h3 className="profile-section-title" style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                        <Sparkles size={14} style={{ color: "#8250df" }} />
                        <span>Perfil IA</span>
                        {selectedPerson.aiProfile && (
                          <span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-muted)" }}>
                            · {selectedPerson.aiProfile.sourceSummaryCount} sumário{selectedPerson.aiProfile.sourceSummaryCount === 1 ? "" : "s"} de {selectedPerson.aiProfile.sourceNoteCount} nota{selectedPerson.aiProfile.sourceNoteCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </h3>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn-secondary"
                          onClick={handleGenerateProfile}
                          disabled={generatingProfile}
                          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: "4px 10px" }}
                          title="Gerar perfil agregando todos os sumários das notas em que essa pessoa participa"
                        >
                          {generatingProfile ? (
                            <>
                              <RefreshCw size={12} className="spin" style={{ animation: "spin 1s linear infinite" }} />
                              <span>Gerando…</span>
                            </>
                          ) : selectedPerson.aiProfile ? (
                            <>
                              <RefreshCw size={12} />
                              <span>Regenerar</span>
                            </>
                          ) : (
                            <>
                              <Sparkles size={12} />
                              <span>Gerar perfil</span>
                            </>
                          )}
                        </button>
                        {selectedPerson.aiProfile && !generatingProfile && (
                          <button
                            className="btn-secondary"
                            onClick={handleClearProfile}
                            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: "4px 10px", color: "#cf222e", borderColor: "#cf222e22" }}
                            title="Remover perfil gerado"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {profileError && (
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                          padding: "8px 10px",
                          borderRadius: 6,
                          backgroundColor: "#fdecea",
                          color: "#cf222e",
                          fontSize: 12,
                          marginBottom: 8,
                        }}
                      >
                        <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span>{profileError}</span>
                      </div>
                    )}

                    {selectedPerson.aiProfile ? (
                      <div
                        style={{
                          padding: "12px 14px",
                          background: "linear-gradient(180deg, #faf7ff 0%, #ffffff 100%)",
                          border: "1px solid #e8defc",
                          borderRadius: 8,
                          fontSize: 13,
                          lineHeight: 1.55,
                          maxHeight: 480,
                          overflowY: "auto",
                        }}
                      >
                        <MarkdownRenderer content={selectedPerson.aiProfile.content} />
                        <div
                          style={{
                            marginTop: 10,
                            paddingTop: 8,
                            borderTop: "1px dashed #e8defc",
                            fontSize: 10,
                            color: "var(--color-text-muted)",
                            display: "flex",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 4,
                          }}
                        >
                          <span title={new Date(selectedPerson.aiProfile.generatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}>
                            Gerado {relativeFromNow(selectedPerson.aiProfile.generatedAt)}
                          </span>
                          <span>modelo: {selectedPerson.aiProfile.model}</span>
                        </div>
                      </div>
                    ) : !generatingProfile && !profileError ? (
                      <div
                        style={{
                          padding: "16px",
                          border: "1px dashed var(--border-color-dark)",
                          borderRadius: 8,
                          background: "var(--bg-sidebar)",
                          fontSize: 12,
                          color: "var(--color-text-muted)",
                          textAlign: "center",
                          lineHeight: 1.5,
                        }}
                      >
                        Gere automaticamente um perfil desta pessoa agregando todos os sumários das notas em que ela participa.
                        {(() => {
                          const total = db.notes
                            .filter((n) => n.peopleIds.includes(selectedPerson.id))
                            .reduce((acc, n) => acc + (n.summaries?.length || 0), 0);
                          return total > 0 ? (
                            <div style={{ marginTop: 4, fontSize: 11 }}>
                              {total} sumário{total === 1 ? "" : "s"} disponíve{total === 1 ? "l" : "is"} como fonte.
                            </div>
                          ) : (
                            <div style={{ marginTop: 4, fontSize: 11, color: "#bc4c00" }}>
                              Nenhum sumário ainda — gere sumários nas notas primeiro.
                            </div>
                          );
                        })()}
                      </div>
                    ) : null}
                  </div>

                  {/* Projects */}
                  <div className="profile-section-item" style={{ borderTop: "none", paddingTop: "0" }}>
                    <h3 className="profile-section-title">Projetos Ativos ({associatedProjects.length})</h3>
                    {associatedProjects.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {associatedProjects.map((p) => (
                          <button
                            key={p.id}
                            className="note-row"
                            style={{ padding: "10px 14px", textAlign: "left", width: "100%" }}
                            onClick={() => {
                              setSelectedEntityId(p.id);
                              setCurrentView("projetos");
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <FolderKanban size={14} className="nav-icon" />
                              <span style={{ fontSize: "13px", fontWeight: 600 }}>{p.name}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontStyle: "italic" }}>
                        Não alocado em nenhum projeto.
                      </span>
                    )}
                  </div>

                  {/* Notes */}
                  <div className="profile-section-item">
                    <h3 className="profile-section-title">Notas de Reunião ({associatedNotes.length})</h3>
                    {associatedNotes.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "200px", overflowY: "auto" }}>
                        {associatedNotes.map((n) => (
                          <button
                            key={n.id}
                            className="note-row"
                            style={{ padding: "10px 14px", textAlign: "left", width: "100%" }}
                            onClick={() => {
                              setSelectedEntityId(n.id);
                              setCurrentView("notas");
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <FileText size={14} className="nav-icon" />
                              <span style={{ fontSize: "13px", fontWeight: 600 }}>{n.title}</span>
                              <span style={{ fontSize: "10px", color: "var(--color-text-muted)", marginLeft: "auto" }}>{n.date}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontStyle: "italic" }}>
                        Nenhum registro de participação em notas de reuniões.
                      </span>
                    )}
                  </div>

                  {/* Tasks */}
                  <div className="profile-section-item">
                    <h3 className="profile-section-title">Ações / Tarefas Designadas ({associatedTasks.length})</h3>
                    {associatedTasks.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {associatedTasks.map((t) => (
                          <div key={t.id} className="task-row" style={{ padding: "6px 8px", backgroundColor: "var(--bg-sidebar)" }}>
                            <div className="task-row-left">
                              <button className="task-checkbox-wrapper" onClick={() => handleTaskToggle(t)}>
                                <div className={`task-checkbox ${t.completed ? "checked" : ""}`}>
                                  {t.completed && <CheckCircle2 className="task-check-icon" />}
                                </div>
                              </button>
                              <span className={`task-title ${t.completed ? "completed" : ""}`} style={{ fontSize: "12px" }}>
                                {t.title}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontStyle: "italic" }}>
                        Nenhuma tarefa pendente atribuída a esta pessoa.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDeletePerson}
        title="Excluir pessoa?"
        message={
          <>
            <strong>{pendingDeletePerson?.name || ""}</strong> será removido(a).
            Todos os vínculos em tarefas, notas e hierarquia serão atualizados
            automaticamente.
          </>
        }
        confirmLabel="Excluir"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
};
export default PeopleView;

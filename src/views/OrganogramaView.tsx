import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import {
  Network,
  Users,
  ArrowUpRight,
  Plus,
  Building2,
  GitBranch,
  LayoutGrid,
  Trash2,
  Edit3,
  Search,
} from "lucide-react";
import { Company, CompanyScope, CompanyType, Person } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";

type ViewMode = "hierarquia" | "area" | "todas";
type PersonFilter = "todos" | "contatos" | "clevel" | "tecnologia";

const C_LEVEL_PATTERNS = [
  /\bC[EFOMTDIPRX]O\b/i,
  /\bChief\b/i,
  /\bHead\b/i,
  /\bDirector\b/i,
  /\bDiretor/i,
  /\bVP\b/i,
  /\bPresident/i,
];

function isCLevel(p: Person): boolean {
  const r = p.role || "";
  return C_LEVEL_PATTERNS.some((re) => re.test(r));
}

function isTech(p: Person): boolean {
  const blob = `${p.department || ""} ${p.role || ""}`.toLowerCase();
  return /tecnolog|tech|engenh|engineer|data|dev|arquitet|infra|cloud|platform|cdo|cto|cio/.test(
    blob,
  );
}

function passesFilter(p: Person, f: PersonFilter): boolean {
  if (f === "todos") return true;
  if (f === "contatos") return !!p.isContact;
  if (f === "clevel") return isCLevel(p);
  if (f === "tecnologia") return isTech(p);
  return true;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function companyTypeLabel(t: CompanyType): string {
  const map: Record<CompanyType, string> = {
    cliente: "CLIENTE",
    parceiro: "PARCEIRO",
    prospect: "PROSPECT",
    fornecedor: "FORNECEDOR",
    outro: "OUTRO",
  };
  return map[t] || "OUTRO";
}

// --- Org tree rendering ---
interface OrgNodeProps {
  person: Person;
  allPeople: Person[];
  highlightId: string | null;
  filter: PersonFilter;
  onClick: (id: string) => void;
}

const OrgNode: React.FC<OrgNodeProps> = ({ person, allPeople, highlightId, filter, onClick }) => {
  const children = allPeople.filter((p) => p.managerId === person.id);
  const dim = !passesFilter(person, filter);

  return (
    <div className="org-node-container">
      <div
        className={`org-node-card ${highlightId === person.id ? "active" : ""}`}
        onClick={() => onClick(person.id)}
        style={{ opacity: dim ? 0.35 : 1, position: "relative" }}
      >
        {person.isContact && (
          <span
            style={{
              position: "absolute",
              top: "-9px",
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: "9px",
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: "4px",
              backgroundColor: "var(--bg-badge-orange)",
              color: "var(--color-badge-orange)",
              letterSpacing: "0.5px",
              border: "1px solid var(--bg-badge-orange)",
            }}
          >
            CONTATO
          </span>
        )}
        {person.avatarUrl ? (
          <img src={person.avatarUrl} alt={person.name} className="org-node-avatar" />
        ) : (
          <div className="org-node-avatar">{initials(person.name)}</div>
        )}
        <div className="org-node-info">
          <span className="org-node-name" title={person.name}>{person.name}</span>
          <span className="org-node-role" title={person.role || "Sem cargo"}>
            {person.role || "Sem cargo"}
          </span>
        </div>
        <ArrowUpRight size={10} style={{ marginLeft: "auto", color: "var(--color-text-muted)", opacity: 0.6 }} />
      </div>

      {children.length > 0 && (
        <div className="org-tree-level">
          <div style={{ position: "absolute", top: "-40px", left: "50%", width: "2px", height: "40px", backgroundColor: "var(--border-color-dark)", zIndex: 1 }} />
          {children.length > 1 && (
            <div style={{ position: "absolute", top: "0px", left: `${100 / children.length / 2}%`, right: `${100 / children.length / 2}%`, height: "2px", backgroundColor: "var(--border-color-dark)", zIndex: 1 }} />
          )}
          {children.map((child) => (
            <div key={child.id} style={{ position: "relative" }}>
              <div style={{ position: "absolute", top: "0px", left: "50%", width: "2px", height: "20px", backgroundColor: "var(--border-color-dark)", zIndex: 1, transform: "translateX(-50%)" }} />
              <div style={{ marginTop: "20px" }}>
                <OrgNode
                  person={child}
                  allPeople={allPeople}
                  highlightId={highlightId}
                  filter={filter}
                  onClick={onClick}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// --- Hierarchy view: tree of people scoped to a company ---
const HierarchyView: React.FC<{
  people: Person[];
  filter: PersonFilter;
  highlightId: string | null;
  onPersonClick: (id: string) => void;
}> = ({ people, filter, highlightId, onPersonClick }) => {
  const ids = new Set(people.map((p) => p.id));
  const roots = people.filter((p) => !p.managerId || !ids.has(p.managerId));
  if (roots.length === 0) {
    return (
      <div className="empty-state" style={{ padding: "64px 0" }}>
        <Users className="empty-icon" />
        <span className="empty-text">Cadastre pessoas para visualizar a hierarquia.</span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "60px", alignItems: "center", marginTop: "40px" }}>
      {roots.map((root) => (
        <OrgNode
          key={root.id}
          person={root}
          allPeople={people}
          highlightId={highlightId}
          filter={filter}
          onClick={onPersonClick}
        />
      ))}
    </div>
  );
};

// --- Area view: grouped by department ---
const AreaView: React.FC<{
  people: Person[];
  filter: PersonFilter;
  onPersonClick: (id: string) => void;
}> = ({ people, filter, onPersonClick }) => {
  const groups = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const p of people) {
      const key = p.department || "Sem departamento";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [people]);

  if (groups.length === 0) {
    return (
      <div className="empty-state" style={{ padding: "64px 0" }}>
        <Users className="empty-icon" />
        <span className="empty-text">Nenhuma pessoa cadastrada.</span>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px", marginTop: "16px" }}>
      {groups.map(([dept, members]) => (
        <div key={dept} className="pane-card" style={{ padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "12px" }}>
            <h3 style={{ fontSize: "14px", fontWeight: 600, margin: 0 }}>{dept}</h3>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              {members.length} {members.length === 1 ? "pessoa" : "pessoas"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {members.map((p) => {
              const dim = !passesFilter(p, filter);
              return (
                <button
                  key={p.id}
                  onClick={() => onPersonClick(p.id)}
                  className="note-row"
                  style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", textAlign: "left", width: "100%", opacity: dim ? 0.4 : 1 }}
                >
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} alt={p.name} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: "50%", backgroundColor: "var(--bg-badge-gray)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>
                      {initials(p.name)}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                      {p.name}
                      {p.isContact && (
                        <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, backgroundColor: "var(--bg-badge-orange)", color: "var(--color-badge-orange)", fontWeight: 700 }}>
                          CONTATO
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{p.role || "Sem cargo"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// --- Company form modal ---
const CompanyForm: React.FC<{
  initial: Company | null;
  onSave: (data: Omit<Company, "id">) => void;
  onCancel: () => void;
}> = ({ initial, onSave, onCancel }) => {
  const [name, setName] = useState(initial?.name || "");
  const [type, setType] = useState<CompanyType>(initial?.type || "cliente");
  const [sector, setSector] = useState(initial?.sector || "");
  const [sizeLabel, setSizeLabel] = useState(initial?.sizeLabel || "");
  const [scope, setScope] = useState<CompanyScope>(initial?.scope || "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle || "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      type,
      sector: sector.trim(),
      sizeLabel: sizeLabel.trim(),
      scope,
      subtitle: subtitle.trim(),
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 className="pane-title" style={{ marginBottom: "16px" }}>
          {initial ? "Editar empresa" : "Nova empresa"}
        </h2>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Nome</label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="ex. IBM Brasil" />
          </div>
          <div className="form-group">
            <label>Tipo</label>
            <select className="form-select" value={type} onChange={(e) => setType(e.target.value as CompanyType)}>
              <option value="cliente">Cliente</option>
              <option value="parceiro">Parceiro</option>
              <option value="prospect">Prospect</option>
              <option value="fornecedor">Fornecedor</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div className="form-group">
            <label>Setor</label>
            <input className="form-input" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="ex. Manufatura, Tecnologia, Financeiro" />
          </div>
          <div className="form-group">
            <label>Porte (label livre)</label>
            <input className="form-input" value={sizeLabel} onChange={(e) => setSizeLabel(e.target.value)} placeholder="ex. ~3.200 colab." />
          </div>
          <div className="form-group">
            <label>Abrangência</label>
            <select className="form-select" value={scope} onChange={(e) => setScope(e.target.value as CompanyScope)}>
              <option value="">—</option>
              <option value="global">Global</option>
              <option value="regional">Regional</option>
              <option value="local">Local</option>
            </select>
          </div>
          <div className="form-group">
            <label>Descrição curta</label>
            <input className="form-input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="ex. Parceiro técnico · watsonx · desde jan/2024" />
          </div>
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>Cancelar</button>
            <button type="submit" className="btn-primary">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Main view ---
export const OrganogramaView: React.FC = () => {
  const {
    db,
    selectedEntityId,
    setSelectedEntityId,
    setCurrentView,
    addCompany,
    updateCompany,
    deleteCompany,
  } = useApp();

  const companies = db.companies || [];

  // If the selected entity is a company, treat it as selected; otherwise leave null.
  const selectedCompanyId =
    selectedEntityId && companies.some((c) => c.id === selectedEntityId)
      ? selectedEntityId
      : null;

  const [viewMode, setViewMode] = useState<ViewMode>(selectedCompanyId ? "hierarquia" : "todas");
  const [filter, setFilter] = useState<PersonFilter>("todos");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Company | null>(null);

  const selectedCompany = selectedCompanyId
    ? companies.find((c) => c.id === selectedCompanyId) || null
    : null;

  const peopleByCompany = (companyId: string | null) =>
    db.people.filter((p) =>
      companyId ? p.companyId === companyId : !p.companyId,
    );

  const counts = (companyId: string) => {
    const list = peopleByCompany(companyId);
    return {
      people: list.length,
      contacts: list.filter((p) => p.isContact).length,
    };
  };

  const handlePersonClick = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("pessoas");
  };

  const handleSelectCompany = (id: string | null) => {
    setSelectedEntityId(id);
    if (id) setViewMode((m) => (m === "todas" ? "hierarquia" : m));
  };

  const visiblePeople = useMemo(() => {
    const base = selectedCompanyId ? peopleByCompany(selectedCompanyId) : db.people;
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.role || "").toLowerCase().includes(q) ||
        (p.department || "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.people, selectedCompanyId, search]);

  const handleSaveCompany = async (data: Omit<Company, "id">) => {
    if (editing) {
      await updateCompany({ ...editing, ...data });
    } else {
      const id = await addCompany(data);
      setSelectedEntityId(id);
      setViewMode("hierarquia");
    }
    setFormOpen(false);
    setEditing(null);
  };

  const totalMapped = db.people.filter((p) => !!p.companyId).length;

  return (
    <div className="view-container" style={{ maxWidth: "1280px" }}>
      {/* Header */}
      <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
        <div>
          <h1 className="detail-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Network size={24} />
            <span>Organograma</span>
          </h1>
          <p className="welcome-subtitle" style={{ marginTop: "4px" }}>
            Pessoas e hierarquias das empresas com as quais você interage. Marque seus contatos diretos.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            {companies.length} empresa{companies.length === 1 ? "" : "s"} · {totalMapped} pessoa{totalMapped === 1 ? "" : "s"} mapeada{totalMapped === 1 ? "" : "s"}
          </span>
          <button className="btn-secondary" onClick={() => { setCurrentView("pessoas"); setSelectedEntityId(null); }} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Users size={14} />
            <span>Nova pessoa</span>
          </button>
          <button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Plus size={14} />
            <span>Nova empresa</span>
          </button>
        </div>
      </div>

      {/* Company cards row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        {companies.map((c) => {
          const { people, contacts } = counts(c.id);
          const isActive = selectedCompanyId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => handleSelectCompany(isActive ? null : c.id)}
              className="pane-card"
              style={{
                padding: "14px",
                textAlign: "left",
                cursor: "pointer",
                border: isActive ? "1.5px solid var(--color-text-main)" : "1px solid var(--border-color)",
                boxShadow: isActive ? "var(--shadow-md)" : undefined,
                background: "var(--bg-card)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: "var(--bg-badge-gray)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>
                  {initials(c.name)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>
                    {[companyTypeLabel(c.type), c.sector?.toUpperCase(), (c.sizeLabel || c.scope || "").toUpperCase()].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px", fontSize: 11, color: "var(--color-text-muted)" }}>
                <span><strong style={{ color: "var(--color-text-main)" }}>{people}</strong> pessoas</span>
                <span><strong style={{ color: "var(--color-text-main)" }}>{contacts}</strong> contatos</span>
              </div>
            </button>
          );
        })}
        <button
          onClick={() => handleSelectCompany(null)}
          className="pane-card"
          style={{
            padding: "14px",
            cursor: "pointer",
            border: selectedCompanyId === null ? "1.5px solid var(--color-text-main)" : "1px dashed var(--border-color-dark)",
            background: selectedCompanyId === null ? "var(--bg-card)" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100%",
          }}
          title="Ver todas as empresas"
        >
          <LayoutGrid size={20} color="var(--color-text-muted)" />
        </button>
      </div>

      {/* Selected company banner */}
      {selectedCompany && (
        <div
          style={{
            padding: "16px 20px",
            borderRadius: "var(--border-radius-lg)",
            background: "var(--bg-sidebar)",
            border: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: "var(--bg-badge-gray)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>
              {initials(selectedCompany.name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{selectedCompany.name}</div>
              {selectedCompany.subtitle && (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{selectedCompany.subtitle}</div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{counts(selectedCompany.id).people}</div>
              <div style={{ fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.5px" }}>PESSOAS</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{counts(selectedCompany.id).contacts}</div>
              <div style={{ fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.5px" }}>MEUS CONTATOS</div>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                className="btn-secondary"
                onClick={() => { setEditing(selectedCompany); setFormOpen(true); }}
                style={{ display: "flex", alignItems: "center", gap: "4px" }}
                title="Editar empresa"
              >
                <Edit3 size={14} />
              </button>
              <button
                className="btn-secondary"
                onClick={() => setPendingDelete(selectedCompany)}
                style={{ display: "flex", alignItems: "center", gap: "4px", color: "#cf222e", borderColor: "#cf222e22" }}
                title="Excluir empresa"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar: view mode + filters + search */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "6px", background: "var(--bg-sidebar)", padding: "4px", borderRadius: "var(--border-radius-md)" }}>
          {selectedCompanyId && (
            <ModeTab active={viewMode === "hierarquia"} onClick={() => setViewMode("hierarquia")} icon={<GitBranch size={12} />} label="Hierarquia" />
          )}
          {selectedCompanyId && (
            <ModeTab active={viewMode === "area"} onClick={() => setViewMode("area")} icon={<Users size={12} />} label="Por área" />
          )}
          <ModeTab active={viewMode === "todas"} onClick={() => setViewMode("todas")} icon={<LayoutGrid size={12} />} label="Todas" />
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <FilterPill active={filter === "todos"} onClick={() => setFilter("todos")} label="Todos" />
          <FilterPill
            active={filter === "contatos"}
            onClick={() => setFilter("contatos")}
            label="Meus contatos"
            badge={db.people.filter((p) => p.isContact).length}
          />
          <FilterPill active={filter === "clevel"} onClick={() => setFilter("clevel")} label="C-level" />
          <FilterPill active={filter === "tecnologia"} onClick={() => setFilter("tecnologia")} label="Tecnologia" />
        </div>

        <div style={{ position: "relative" }}>
          <Search size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-muted)" }} />
          <input
            className="form-input"
            placeholder="Buscar pessoa ou cargo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 28, width: 240, fontSize: 12 }}
          />
        </div>
      </div>

      {/* Body */}
      <div className="org-chart-viewport">
        <div className="org-chart-instructions">
          💡 Clique em qualquer caixinha para visualizar detalhes da pessoa
        </div>

        {viewMode === "todas" ? (
          companies.length === 0 ? (
            <div className="empty-state" style={{ padding: "64px 0" }}>
              <Building2 className="empty-icon" />
              <span className="empty-text">Cadastre sua primeira empresa para começar a mapear contatos!</span>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: "20px", width: "100%", marginTop: "30px" }}>
              {companies.map((c) => {
                const cp = peopleByCompany(c.id).filter((p) => {
                  if (!search.trim()) return true;
                  const q = search.toLowerCase();
                  return (
                    p.name.toLowerCase().includes(q) ||
                    (p.role || "").toLowerCase().includes(q) ||
                    (p.department || "").toLowerCase().includes(q)
                  );
                });
                return (
                  <div key={c.id} className="pane-card" style={{ padding: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: "var(--bg-badge-gray)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                          {initials(c.name)}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                          <div style={{ fontSize: 10, color: "var(--color-text-muted)", textTransform: "uppercase" }}>{companyTypeLabel(c.type)}</div>
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        {counts(c.id).people} pessoas · {counts(c.id).contacts} contatos
                      </span>
                    </div>
                    <div style={{ overflow: "auto", paddingTop: 12 }}>
                      <HierarchyView
                        people={cp}
                        filter={filter}
                        highlightId={null}
                        onPersonClick={handlePersonClick}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : viewMode === "area" ? (
          <div style={{ width: "100%" }}>
            <AreaView people={visiblePeople} filter={filter} onPersonClick={handlePersonClick} />
          </div>
        ) : (
          <HierarchyView
            people={visiblePeople}
            filter={filter}
            highlightId={null}
            onPersonClick={handlePersonClick}
          />
        )}
      </div>

      {formOpen && (
        <CompanyForm
          initial={editing}
          onSave={handleSaveCompany}
          onCancel={() => { setFormOpen(false); setEditing(null); }}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Excluir empresa?"
        message={
          <>
            <strong>{pendingDelete?.name || ""}</strong> será removida. As pessoas continuarão
            cadastradas, apenas sem vínculo a esta empresa.
          </>
        }
        confirmLabel="Excluir"
        danger
        onConfirm={async () => {
          if (!pendingDelete) return;
          const id = pendingDelete.id;
          setPendingDelete(null);
          await deleteCompany(id);
          if (selectedEntityId === id) setSelectedEntityId(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

const ModeTab: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    style={{
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 12px",
      borderRadius: "6px",
      border: "none",
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 500,
      background: active ? "var(--color-text-main)" : "transparent",
      color: active ? "#fff" : "var(--color-text-main)",
    }}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const FilterPill: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}> = ({ active, onClick, label, badge }) => (
  <button
    onClick={onClick}
    style={{
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 12px",
      borderRadius: "999px",
      border: active ? "1px solid var(--color-text-main)" : "1px solid var(--border-color)",
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 500,
      background: active ? "var(--color-text-main)" : "var(--bg-card)",
      color: active ? "#fff" : "var(--color-text-main)",
    }}
  >
    <span>{label}</span>
    {typeof badge === "number" && badge > 0 && (
      <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.8 }}>{badge}</span>
    )}
  </button>
);

export default OrganogramaView;

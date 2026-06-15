import React, { forwardRef, useState, Children, isValidElement } from "react";
import type {
  BeautifulMentionComponentProps,
  BeautifulMentionsMenuItemProps,
  BeautifulMentionsMenuProps,
} from "lexical-beautiful-mentions";
import {
  CornerDownLeft,
  Folder,
  FileText,
  CalendarDays,
  User,
} from "lucide-react";
import { useApp } from "../../context/AppContext";

type EntityKind = "person" | "project" | "note" | "date";

type EntityMentionData = {
  id?: string | number | boolean | null;
  kind?: string | number | boolean | null;
  sub?: string | number | boolean | null;
};

// ----------------------------------------------------------------------------
// Mention inserido (clicável) — comporta-se por kind
// ----------------------------------------------------------------------------
export const PersonMentionComponent = forwardRef<
  HTMLAnchorElement,
  BeautifulMentionComponentProps<EntityMentionData>
>(function PersonMentionComponent(props, ref) {
  const { trigger, value, data, className, ...rest } = props;
  const { setCurrentView, setSelectedEntityId, db } = useApp();

  const kind = (typeof data?.kind === "string" ? data.kind : "person") as EntityKind;
  const id = typeof data?.id === "string" ? data.id : undefined;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!id) return;
    switch (kind) {
      case "person": {
        const person = db.people.find((p) => p.id === id) || db.people.find((p) => p.name === value);
        if (person) {
          setSelectedEntityId(person.id);
          setCurrentView("pessoas");
        }
        break;
      }
      case "project": {
        setSelectedEntityId(id);
        setCurrentView("projetos");
        break;
      }
      case "note": {
        setSelectedEntityId(id);
        setCurrentView("notas");
        break;
      }
      case "date":
        // não navega
        break;
    }
  };

  const cls = ["beautiful-mention", `mention-${kind}`, className || ""].filter(Boolean).join(" ");
  const titleByKind: Record<EntityKind, string> = {
    person: `Abrir perfil de ${value}`,
    project: `Abrir projeto ${value}`,
    note: `Abrir nota ${value}`,
    date: value,
  };

  return (
    <a
      {...rest}
      ref={ref}
      href="#"
      role={kind === "date" ? "none" : "link"}
      onClick={handleClick}
      className={cls}
      title={titleByKind[kind]}
    >
      {trigger}
      {value}
    </a>
  );
});

// ----------------------------------------------------------------------------
// Menu — tabs filtram client-side por data-kind no <li>
// ----------------------------------------------------------------------------
type Tab = "all" | EntityKind;

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: "person", label: "Pessoas" },
  { id: "project", label: "Projetos" },
  { id: "note", label: "Notas" },
  { id: "date", label: "Datas" },
];

export const MentionsMenu = forwardRef<HTMLDivElement, BeautifulMentionsMenuProps>(
  function MentionsMenu(props, ref) {
    const { loading, children, ...rest } = props;
    const [tab, setTab] = useState<Tab>("person");

    // conta resultados por kind a partir dos children
    const counts: Record<EntityKind, number> = { person: 0, project: 0, note: 0, date: 0 };
    Children.forEach(children, (c) => {
      if (!isValidElement(c)) return;
      const k = (c.props as any)?.item?.data?.kind as EntityKind | undefined;
      if (k && counts[k] !== undefined) counts[k] += 1;
    });
    const total = counts.person + counts.project + counts.note + counts.date;
    const visibleCount = counts[tab as EntityKind] ?? total;

    return (
      <div ref={ref} className={`bm-menu tab-${tab}`} role="menu" {...rest}>
        <div className="bm-menu-tabs">
          {TAB_LABELS.map((t) => {
            const c = counts[t.id as EntityKind];
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                // mousedown porque o editor perde foco em click — onMouseDown previne
                onMouseDown={(e) => {
                  e.preventDefault();
                  setTab(t.id);
                }}
                className={`bm-tab ${isActive ? "active" : ""} ${c === 0 ? "empty" : ""}`}
              >
                {t.label}
                {c > 0 && <span className="bm-tab-count">{c}</span>}
              </button>
            );
          })}
        </div>
        <div className="bm-menu-meta">
          <span>@</span>
          <span className="bm-menu-meta-count">
            {loading ? "Buscando..." : `${visibleCount} resultado${visibleCount === 1 ? "" : "s"}`}
          </span>
        </div>
        <ul className="bm-menu-list">
          {loading ? (
            <li className="bm-menu-loading">Buscando...</li>
          ) : visibleCount === 0 ? (
            <li className="bm-menu-empty">Nada para mostrar nesta aba</li>
          ) : (
            children
          )}
        </ul>
      </div>
    );
  },
);

// ----------------------------------------------------------------------------
// Item — renderiza por kind
// ----------------------------------------------------------------------------
export const MentionsMenuItem = forwardRef<
  HTMLLIElement,
  BeautifulMentionsMenuItemProps
>(function MentionsMenuItem(props, ref) {
  const { selected, item, itemValue, label, children, ...rest } = props;
  void children;
  const { db } = useApp();

  const data = (item?.data || {}) as EntityMentionData;
  const kind = (typeof data.kind === "string" ? data.kind : "person") as EntityKind;
  const displayName = (item?.displayValue || itemValue || label || "") as string;
  const subFromData = typeof data.sub === "string" ? data.sub : "";

  // Conteúdo por kind
  let avatar: React.ReactNode = null;
  let sub = subFromData;

  if (kind === "person") {
    const id = typeof data.id === "string" ? data.id : undefined;
    const person = id
      ? db.people.find((p) => p.id === id)
      : db.people.find((p) => p.name === displayName);
    const initials =
      (person?.name || displayName || "?")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => (s[0] || "").toUpperCase())
        .join("") || "?";
    avatar = person?.avatarUrl ? (
      <img src={person.avatarUrl} alt={person.name} />
    ) : (
      <span>{initials}</span>
    );
    if (!sub && person?.role) sub = person.role;
  } else if (kind === "project") {
    avatar = <Folder size={14} />;
  } else if (kind === "note") {
    avatar = <FileText size={14} />;
  } else if (kind === "date") {
    avatar = <CalendarDays size={14} />;
  } else {
    avatar = <User size={14} />;
  }

  return (
    <li
      {...rest}
      ref={ref}
      data-kind={kind}
      className={`bm-item bm-item-${kind} ${selected ? "selected" : ""}`.trim()}
      aria-selected={selected || undefined}
    >
      <span className={`bm-item-avatar bm-item-avatar-${kind}`}>{avatar}</span>
      <span className="bm-item-text">
        <span className="bm-item-name">{displayName}</span>
        {sub && <span className="bm-item-sub">{sub}</span>}
      </span>
      {selected && (
        <span className="bm-item-enter" aria-hidden>
          <CornerDownLeft size={11} />
        </span>
      )}
    </li>
  );
});

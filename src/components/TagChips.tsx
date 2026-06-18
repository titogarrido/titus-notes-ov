import React from "react";
import { Tag as TagIcon } from "lucide-react";
import { tagColor, normalizeTag } from "../lib/tags";

interface TagChipsProps {
  tags?: string[];
  /** Quando definido, os chips viram botões de filtro. */
  onToggle?: (tag: string) => void;
  /** Tags atualmente ativos no filtro (recebem destaque). */
  activeTags?: string[];
  size?: "sm" | "md";
  showIcon?: boolean;
}

export const TagChips: React.FC<TagChipsProps> = ({
  tags,
  onToggle,
  activeTags,
  size = "sm",
  showIcon = false,
}) => {
  if (!tags || tags.length === 0) return null;
  const activeSet = new Set((activeTags || []).map(normalizeTag));
  const pad = size === "sm" ? "1px 7px" : "2px 9px";
  const fontSize = size === "sm" ? 10 : 12;

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {tags.map((t) => {
        const c = tagColor(t);
        const active = activeSet.has(normalizeTag(t));
        const chip = (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: pad,
              borderRadius: 999,
              background: c.bg,
              color: c.fg,
              fontSize,
              fontWeight: 600,
              lineHeight: 1.4,
              border: active ? `1px solid ${c.fg}` : "1px solid transparent",
            }}
          >
            {showIcon && <TagIcon size={fontSize} />}
            {t}
          </span>
        );
        if (!onToggle) return <React.Fragment key={t}>{chip}</React.Fragment>;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            title={active ? `Remover filtro “${t}”` : `Filtrar por “${t}”`}
            style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
          >
            {chip}
          </button>
        );
      })}
    </span>
  );
};
